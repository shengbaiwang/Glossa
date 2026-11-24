import { ApiError, type Bindings, type Principal } from '../contracts';
import { liveSession } from '../auth/sessions';
import { statement, guard, chunkedBatch, isGuardFailure } from '../db/batch';
import { openUpload } from './confirm';
import { objectStorage } from './provider';

const PUT_MS = 300_000;
export const uploadLimits = {
  negotiate_chunks: 128,
  confirm_objects: 25,
  part_size: 128,
  max_chunk_bytes: 16 << 20,
};
export function sessionGuard(env: Bindings, p: Principal) {
  return guard(env.DB, `EXISTS(${liveSession})`, p.user, p.session, p.device, Date.now());
}

export async function createUpload(
  env: Bindings,
  p: Principal,
  book: string,
  op: string,
  base: string | null,
) {
  // The idempotency key is also the upload UUID. This makes retries recover the original lease.
  const db = env.DB;
  const now = Date.now();
  const [target, previous] = await db.batch<Record<string, string | number | null>>([
    statement(db, 'SELECT deleted_at FROM books WHERE user_id=? AND id=?', p.user, book),
    statement(
      db,
      'SELECT book_id,base_manifest_id,device_id,state,expires_at FROM uploads WHERE user_id=? AND id=?',
      p.user,
      op,
    ),
  ]);
  if (!target!.results.length) throw new ApiError(404, 'book_not_found');
  if (target!.results[0]!.deleted_at !== null) throw new ApiError(410, 'book_trashed');
  if (previous!.results.length) {
    const row = previous!.results[0]!;
    if (row.book_id !== book || row.base_manifest_id !== base || row.device_id !== p.device)
      throw new ApiError(409, 'idempotency_mismatch');
    if ((row.expires_at as number) <= now || row.state === 'aborted')
      throw new ApiError(410, 'upload_expired');
    return { upload_id: op, expires_at: row.expires_at, limits: uploadLimits };
  }
  try {
    const results = await db.batch<Record<string, string | number | null>>([
      sessionGuard(env, p),
      guard(
        db,
        `EXISTS(SELECT 1 FROM books WHERE user_id=? AND id=? AND deleted_at IS NULL)
        AND (SELECT manifest_id FROM current_manifests WHERE user_id=? AND book_id=?) IS ?`,
        p.user,
        book,
        p.user,
        book,
        base,
      ),
      statement(
        db,
        `INSERT INTO uploads(user_id,id,book_id,device_id,base_manifest_id,expires_at,state)
        VALUES(?,?,?,?,?,?,'open') ON CONFLICT(user_id,id) DO NOTHING`,
        p.user,
        op,
        book,
        p.device,
        base,
        now + 86400000,
      ),
      guard(
        db,
        'EXISTS(SELECT 1 FROM uploads WHERE user_id=? AND id=? AND book_id=? AND device_id=? AND base_manifest_id IS ?)',
        p.user,
        op,
        book,
        p.device,
        base,
      ),
      statement(db, 'SELECT expires_at FROM uploads WHERE user_id=? AND id=?', p.user, op),
    ]);
    return { upload_id: op, expires_at: results[4]!.results[0]!.expires_at, limits: uploadLimits };
  } catch (error) {
    if (isGuardFailure(error)) throw new ApiError(409, 'upload_precondition_failed');
    throw error;
  }
}

type Descriptor = {
  blake3: string;
  bytes: number;
  md5_b64: string;
  role?: string;
  mime?: string;
  codec_version?: string;
};
type Match = {
  id: string;
  blake3: string;
  kind: string;
  object_key: string;
  state: string;
  mime: string;
  md5_b64: string;
};
const tuples = (slots: string[]) => slots.map((s) => '(' + s + ')').join(',');
export async function negotiate(env: Bindings, p: Principal, upload: string, items: Descriptor[]) {
  const db = env.DB;
  const scope = [p.user, upload, p.device];
  if (!(await statement(db, openUpload, ...scope).first()))
    throw new ApiError(404, 'upload_not_found');
  const unique = new Map<string, Descriptor>();
  for (const d of items) {
    const key = (d.role ?? 'chunk') + '/' + d.blake3;
    const prior = unique.get(key);
    if (
      prior &&
      (prior.bytes !== d.bytes ||
        prior.md5_b64 !== d.md5_b64 ||
        prior.mime !== d.mime ||
        prior.codec_version !== d.codec_version)
    )
      throw new ApiError(409, 'object_identity_conflict');
    unique.set(key, d);
  }
  const expiry = Date.now() + PUT_MS;
  const rows = [...unique.values()].map((d) => ({
    ...d,
    id: crypto.randomUUID(),
    kind: d.role ?? 'chunk',
    mime: d.mime ?? 'application/octet-stream',
  }));
  const writes = [
    sessionGuard(env, p),
    guard(db, `EXISTS(${openUpload})`, ...scope),
    ...chunkedBatch(
      db,
      rows,
      [],
      (d) => [
        p.user,
        d.id,
        'u/' + p.user + '/o/' + d.id,
        d.kind,
        d.blake3,
        d.bytes,
        d.md5_b64,
        d.mime,
        expiry,
      ],
      (
        slots,
      ) => `INSERT INTO objects(user_id,id,object_key,kind,blake3,bytes,md5_b64,mime,put_until,state) VALUES
        ${slots.map((s) => '(' + s + ",'reserved')").join(',')} ON CONFLICT(user_id,kind,blake3) WHERE state<>'gc'
        DO UPDATE SET put_until=max(objects.put_until,excluded.put_until)`,
    ),
    ...chunkedBatch(
      db,
      rows,
      [p.user],
      (d) => [d.kind, d.blake3, d.bytes, d.md5_b64, d.mime],
      (
        slots,
      ) => `WITH owner(uid) AS (VALUES (?)), req(kind,hash,bytes,md5,mime) AS (VALUES ${tuples(slots)})
        INSERT INTO write_guard VALUES(NOT EXISTS(SELECT 1 FROM req r JOIN objects o
        ON o.user_id=(SELECT uid FROM owner) AND (o.kind,o.blake3)=(r.kind,r.hash) AND o.state<>'gc'
        WHERE (o.bytes,o.md5_b64,o.mime)<>(r.bytes,r.md5,r.mime))) ON CONFLICT(ok) DO NOTHING`,
    ),
    ...chunkedBatch(
      db,
      rows,
      [p.user, upload, Date.now()],
      (d) => [d.kind, d.blake3, d.codec_version ?? null],
      (
        slots,
      ) => `WITH scope(uid,upload,now) AS (VALUES (?,?,?)), req(kind,hash,codec) AS (VALUES ${tuples(slots)})
        INSERT INTO upload_objects(user_id,upload_id,object_id,verified_at,codec_version)
        SELECT s.uid,s.upload,o.id,CASE WHEN o.state='ready' THEN s.now END,r.codec FROM scope s,req r
        JOIN objects o ON o.user_id=s.uid AND (o.kind,o.blake3)=(r.kind,r.hash) WHERE o.state<>'gc'
        ON CONFLICT(user_id,upload_id,object_id) DO UPDATE SET verified_at=coalesce(upload_objects.verified_at,excluded.verified_at)`,
    ),
    ...chunkedBatch(
      db,
      rows,
      [p.user, upload],
      (d) => [d.kind, d.blake3, d.codec_version ?? null],
      (
        slots,
      ) => `WITH scope(uid,upload) AS (VALUES (?,?)),req(kind,hash,codec) AS (VALUES ${tuples(slots)})
        INSERT INTO write_guard VALUES(NOT EXISTS(SELECT 1 FROM req r,scope s
        JOIN objects o ON o.user_id=s.uid AND (o.kind,o.blake3)=(r.kind,r.hash) AND o.state<>'gc'
        JOIN upload_objects u ON (u.user_id,u.upload_id,u.object_id)=(s.uid,s.upload,o.id)
        WHERE u.codec_version IS NOT r.codec)) ON CONFLICT(ok) DO NOTHING`,
    ),
  ];
  const reads = chunkedBatch(
    db,
    rows,
    [p.user],
    (d) => [d.kind, d.blake3],
    (slots) =>
      `SELECT id,blake3,kind,object_key,state,mime,md5_b64 FROM objects WHERE user_id=? AND state<>'gc'
     AND (kind,blake3) IN (VALUES ${tuples(slots)})`,
  );
  let matches: Match[];
  try {
    matches = (await db.batch<Match>([...writes, ...reads]))
      .slice(writes.length)
      .flatMap((r) => r.results);
  } catch (error) {
    if (isGuardFailure(error)) throw new ApiError(409, 'negotiation_conflict');
    throw error;
  }
  const provider = objectStorage(env);
  const present = [],
    missing = [];
  for (const m of matches) {
    const item = {
      blake3: m.blake3,
      object_id: m.id,
      ...(m.kind === 'chunk' ? {} : { role: m.kind }),
    };
    if (m.state === 'ready') present.push(item);
    else {
      const signed = await provider.generatePresignedPut(m.object_key, m.mime, m.md5_b64, expiry);
      missing.push({
        ...item,
        put_url: signed.url,
        headers: signed.headers,
        expires_at: signed.expires_at,
      });
    }
  }
  return { present, missing };
}

export async function uploadStatus(env: Bindings, p: Principal, book: string, upload: string) {
  const row = await statement(
    env.DB,
    `SELECT u.state,u.last_error,r.result_json,u.expires_at
    FROM uploads u JOIN books b ON (b.user_id,b.id)=(u.user_id,u.book_id)
    LEFT JOIN op_receipts r ON (r.user_id,r.op_id)=(u.user_id,u.commit_op_id)
    WHERE u.user_id=? AND u.book_id=? AND u.id=? AND u.device_id=? AND b.deleted_at IS NULL`,
    p.user,
    book,
    upload,
    p.device,
  ).first<{
    state: string;
    last_error: string | null;
    result_json: string | null;
    expires_at: number;
  }>();
  if (!row) throw new ApiError(404, 'upload_not_found');
  if (row.state === 'open' && row.expires_at <= Date.now())
    throw new ApiError(410, 'upload_expired');
  return {
    state: row.state,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    error: row.last_error,
  };
}
