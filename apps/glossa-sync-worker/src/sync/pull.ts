import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { ApiError, type Bindings, type Principal } from '../contracts';
import { guard, statement, isGuardFailure } from '../db/batch';
import { sessionGuard } from '../storage/uploads';

const seq = z.int().nonnegative();
const entityTypes = ['group', 'book', 'annotation'] as const;
const cursor = z.object({
  head: seq,
  section: z.int().min(0).max(2),
  after: z.string().max(64),
  did: z.uuid(),
});
const bytes = (s: string) => new TextEncoder().encode(s).length;
async function horizon(env: Bindings, p: Principal) {
  return (await statement(
    env.DB,
    'SELECT s.head_seq,s.floor_seq,max(s.lamport,d.last_lamport) lamport,d.delivered_seq FROM sync_state s JOIN devices d ON d.user_id=s.user_id WHERE s.user_id=? AND d.id=?',
    p.user,
    p.device,
  ).first<{ head_seq: number; floor_seq: number; delivered_seq: number; lamport: number }>())!;
}
export async function pull(
  env: Bindings,
  p: Principal,
  after: number,
  limit: number,
  fixed?: number,
) {
  const state = await horizon(env, p);
  const until = fixed ?? state.head_seq;
  if (after < state.floor_seq) throw new ApiError(410, 'cursor_expired');
  if (after > until || after > state.delivered_seq || until > state.head_seq)
    throw new ApiError(422, 'invalid_cursor');
  const rows = await statement(
    env.DB,
    `SELECT server_seq,event_json FROM oplog
    WHERE user_id=? AND server_seq>? AND server_seq<=? ORDER BY server_seq LIMIT ?`,
    p.user,
    after,
    until,
    limit,
  ).all<{ server_seq: number; event_json: string }>();
  let next = after,
    size = 0;
  const events = [];
  for (const r of rows.results) {
    size += bytes(r.event_json);
    if (events.length && size > 256 * 1024) break;
    if (r.server_seq !== next + 1) throw new ApiError(410, 'cursor_expired');
    events.push(JSON.parse(r.event_json));
    next = r.server_seq;
  }
  try {
    await env.DB.batch([
      sessionGuard(env, p),
      guard(env.DB, '(SELECT floor_seq FROM sync_state WHERE user_id=?)<=?', p.user, after),
      statement(
        env.DB,
        'UPDATE devices SET delivered_seq=max(delivered_seq,?) WHERE user_id=? AND id=?',
        next,
        p.user,
        p.device,
      ),
    ]);
  } catch (e) {
    if (isGuardFailure(e)) throw new ApiError(410, 'cursor_expired');
    throw e;
  }
  return { until, next_cursor: next, has_more: next < until, events };
}
export async function ack(env: Bindings, p: Principal, value: number) {
  const result = await statement(
    env.DB,
    `UPDATE devices SET ack_seq=max(ack_seq,?),last_seen_at=?
    WHERE user_id=? AND id=? AND revoked_at IS NULL AND delivered_seq>=? RETURNING ack_seq`,
    value,
    Date.now(),
    p.user,
    p.device,
    value,
  ).first<{ ack_seq: number }>();
  if (!result) throw new ApiError(409, 'cursor_not_delivered');
  return result;
}
const projections = [
  'SELECT id,parent_id,name,sort_key,rev,placement_rev,deleted_at FROM groups WHERE user_id=? AND id>? ORDER BY id LIMIT 32',
  `SELECT b.id,b.file_hash,b.title,b.format,b.language,b.authors_json,b.thumbhash,b.group_id,b.status,b.progress_bp,b.furthest_bp,
    b.position_rev,b.position_epoch,b.anchor_json,b.rev,b.deleted_at,b.finished_at,c.manifest_id,c.file_bytes,v.cover_avif_key
    FROM books b LEFT JOIN current_manifests c ON (c.user_id,c.book_id)=(b.user_id,b.id)
    LEFT JOIN book_covers v ON (v.user_id,v.book_id)=(b.user_id,b.id) WHERE b.user_id=? AND b.id>? ORDER BY b.id LIMIT 32`,
  `SELECT id,book_id,kind annotation_kind,page_index,cfi,rects_json,text_fingerprint,anchor_version,note,style_json,rev,deleted_at
    FROM annotations WHERE user_id=? AND id>? ORDER BY id LIMIT 32`,
];
export async function snapshot(env: Bindings, p: Principal, token?: string) {
  const key = new TextEncoder().encode(env.ACCESS_SECRET);
  const { head_seq, lamport } = await horizon(env, p);
  let section = 0,
    after = '';
  if (token) {
    let decoded: z.infer<typeof cursor>;
    try {
      const verified = await jwtVerify(token, key, {
        issuer: env.TOKEN_ISSUER,
        audience: 'glossa:snapshot',
        subject: p.user,
        algorithms: ['HS256'],
        requiredClaims: ['exp'],
      });
      decoded = cursor.parse(verified.payload);
    } catch {
      throw new ApiError(410, 'snapshot_token_expired');
    }
    if (decoded.did !== p.device) throw new ApiError(422, 'invalid_cursor');
    if (decoded.head !== head_seq) throw new ApiError(409, 'snapshot_changed');
    section = decoded.section;
    after = decoded.after;
  }
  const page = await statement(env.DB, projections[section]!, p.user, after).all<
    Record<string, string | number | null>
  >();
  let size = 0;
  const records = [];
  for (const raw of page.results) {
    const row: Record<string, unknown> = { entity: entityTypes[section], ...raw };
    for (const name of ['authors', 'anchor', 'rects', 'style']) {
      const k = name + '_json';
      if (k in row) {
        row[name] = raw[k] ? JSON.parse(String(raw[k])) : null;
        delete row[k];
      }
    }
    size += bytes(JSON.stringify(row));
    if (records.length && size > 256 * 1024) break;
    records.push(row);
    after = String(raw.id);
  }
  if (records.length === page.results.length && page.results.length < 32) {
    section++;
    after = '';
  }
  const last = section === entityTypes.length;
  try {
    const steps = [
      sessionGuard(env, p),
      guard(env.DB, '(SELECT head_seq FROM sync_state WHERE user_id=?)=?', p.user, head_seq),
    ];
    if (last)
      steps.push(
        statement(
          env.DB,
          'UPDATE devices SET delivered_seq=max(delivered_seq,?) WHERE user_id=? AND id=?',
          head_seq,
          p.user,
          p.device,
        ),
      );
    await env.DB.batch(steps);
  } catch (e) {
    if (isGuardFailure(e)) throw new ApiError(409, 'snapshot_changed');
    throw e;
  }
  const next_page_token = last
    ? null
    : await new SignJWT({ head: head_seq, section, after, did: p.device })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(env.TOKEN_ISSUER)
        .setAudience('glossa:snapshot')
        .setSubject(p.user)
        .setExpirationTime('10m')
        .sign(key);
  return { records, head_seq, lamport, next_page_token };
}
