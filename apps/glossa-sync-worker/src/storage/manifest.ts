import { hash } from '../db/digest';
import type { z } from 'zod';
import {
  ApiError,
  type Bindings,
  type Principal,
  type manifestPartInput,
  type manifestInput,
} from '../contracts';
import { chunkedBatch, guard, isGuardFailure, statement } from '../db/batch';
import { sessionGuard } from './uploads';
import { openUpload } from './confirm';

type Part = z.infer<typeof manifestPartInput>;
type Manifest = z.infer<typeof manifestInput>;
const memberOfBook = `EXISTS(${openUpload} AND u.book_id=?)`;
type PartRow = {
  part: number;
  count: number;
  end_byte: number;
  digest: string;
  prefix_digest: string;
};
function validateRanges(input: Part, previousEnd: number) {
  let end = previousEnd;
  for (const chunk of input.chunks) {
    if (chunk.start_byte !== end + 1 || chunk.end_byte < chunk.start_byte)
      throw new ApiError(422, 'invalid_chunk_range');
    end = chunk.end_byte;
  }
  return end;
}

function appendPart(
  db: D1Database,
  user: string,
  upload: string,
  part: number,
  input: Part,
  previousPart: number | null,
  end: number,
  digest: string,
  prefix: string,
) {
  const chunks = input.chunks.map((c, i) => ({ ...c, ordinal: input.first_ordinal + i }));
  return [
    guard(
      db,
      '(SELECT max(part) FROM manifest_parts WHERE user_id=? AND upload_id=?) IS ?',
      user,
      upload,
      previousPart,
    ),
    ...chunkedBatch(
      db,
      chunks,
      [user, upload],
      (c) => [c.ordinal, c.blake3, c.start_byte, c.end_byte],
      (slots) => `WITH scope(uid,upload) AS (VALUES (?,?)),req(ord,hash,start,end) AS (VALUES
        ${slots.map((s) => '(' + s + ')').join(',')}) INSERT INTO manifest_chunks
        SELECT s.uid,s.upload,r.ord,o.id,r.start,r.end FROM scope s,req r
        JOIN objects o ON o.user_id=s.uid AND o.kind='chunk' AND o.blake3=r.hash AND o.state<>'gc'
        JOIN upload_objects u ON (u.user_id,u.upload_id,u.object_id)=(s.uid,s.upload,o.id)
        WHERE o.bytes=r.end-r.start+1`,
    ),
    guard(
      db,
      '(SELECT count(*) FROM manifest_chunks WHERE user_id=? AND manifest_id=? AND ordinal>=?)=?',
      user,
      upload,
      input.first_ordinal,
      chunks.length,
    ),
    statement(
      db,
      'INSERT INTO manifest_parts VALUES(?,?,?,?,?,?,?)',
      user,
      upload,
      part,
      chunks.length,
      end,
      digest,
      prefix,
    ),
  ];
}
export async function putPart(
  env: Bindings,
  p: Principal,
  book: string,
  upload: string,
  part: number,
  input: Part,
) {
  const { DB: db } = env;
  const args = [p.user, upload, p.device, book];
  if (!(await statement(db, 'SELECT 1 WHERE ' + memberOfBook, ...args).first()))
    throw new ApiError(404, 'upload_not_found');
  if (input.first_ordinal !== 128 * part) throw new ApiError(422, 'invalid_ordinal');
  const digest = await hash(input);
  const existing = () =>
    statement(
      db,
      'SELECT * FROM manifest_parts WHERE user_id=? AND upload_id=? AND part=?',
      p.user,
      upload,
      part,
    ).first<PartRow>();
  const response = { part, first_ordinal: input.first_ordinal, count: input.chunks.length };
  function replay(row: PartRow) {
    if (row.digest !== digest) throw new ApiError(409, 'part_conflict');
    return response;
  }
  const prior = await existing();
  if (prior) return replay(prior);
  const last = await statement(
    db,
    'SELECT * FROM manifest_parts WHERE user_id=? AND upload_id=? ORDER BY part DESC LIMIT 1',
    p.user,
    upload,
  ).first<PartRow>();
  if (part !== (last ? last.part + 1 : 0) || (last && last.count !== 128))
    throw new ApiError(409, 'part_out_of_order');
  const end = validateRanges(input, last?.end_byte ?? -1);
  const prefix = await hash([last?.prefix_digest ?? null, digest]);
  try {
    await db.batch([
      sessionGuard(env, p),
      guard(db, memberOfBook, ...args),
      ...appendPart(db, p.user, upload, part, input, last?.part ?? null, end, digest, prefix),
    ]);
  } catch (error) {
    if (!isGuardFailure(error)) throw error;
    const raced = await existing();
    if (raced) return replay(raced);
    throw new ApiError(409, 'part_precondition_failed');
  }
  return response;
}

export async function publish(env: Bindings, p: Principal, book: string, m: Manifest) {
  const db = env.DB;
  const request = await hash(['manifest.publish', p.device, book, m]);
  async function receipt() {
    const row = await statement(
      db,
      `SELECT r.request_digest,r.result_json,b.deleted_at
      FROM op_receipts r LEFT JOIN books b ON b.user_id=r.user_id AND b.id=?
      WHERE r.user_id=? AND r.op_id=?`,
      book,
      p.user,
      m.op_id,
    ).first<{ request_digest: string; result_json: string; deleted_at: number | null }>();
    if (!row) return null;
    if (row.request_digest !== request) throw new ApiError(409, 'idempotency_mismatch');
    if (
      row.deleted_at !== null ||
      !(await statement(db, 'SELECT 1 FROM books WHERE user_id=? AND id=?', p.user, book).first())
    )
      throw new ApiError(410, 'book_removed');
    return JSON.parse(row.result_json);
  }
  const prior = await receipt();
  if (prior) return prior;
  try {
    const upload = m.upload_id;
    let last = await statement(
      db,
      `SELECT part,count,end_byte,digest,prefix_digest FROM manifest_parts
      WHERE user_id=? AND upload_id=? ORDER BY part DESC LIMIT 1`,
      p.user,
      upload,
    ).first<PartRow>();
    const inlineWrites: D1PreparedStatement[] = [];
    if ('chunks' in m) {
      if (
        m.chunks.length !== m.chunk_count ||
        m.chunks.some((c, i) => c.ordinal !== i) ||
        m.chunks.at(-1)!.end_byte !== m.file_bytes - 1
      )
        throw new ApiError(422, 'invalid_manifest');
      const input = { first_ordinal: 0, chunks: m.chunks.map(({ ordinal, ...c }) => c) };
      const end = validateRanges(input, -1);
      const digest = await hash(input);
      if (last) {
        if (last.part !== 0 || last.digest !== digest) throw new ApiError(409, 'part_conflict');
      } else {
        const prefix = await hash([null, digest]);
        inlineWrites.push(...appendPart(db, p.user, upload, 0, input, null, end, digest, prefix));
        last = {
          part: 0,
          count: input.chunks.length,
          end_byte: end,
          digest,
          prefix_digest: prefix,
        };
      }
    }
    if (
      !last ||
      last.part * 128 + last.count !== m.chunk_count ||
      last.end_byte !== m.file_bytes - 1
    )
      throw new ApiError(409, 'incomplete_manifest');
    const assets = m.assets.slice().sort((a, b) => a.role.localeCompare(b.role));
    const descriptors = assets.length
      ? (
          await db.batch<{ blake3: string }>(
            assets.map((a) =>
              statement(
                db,
                `SELECT o.blake3 FROM upload_objects u JOIN objects o ON (o.user_id,o.id)=(u.user_id,u.object_id)
      WHERE u.user_id=? AND u.upload_id=? AND u.object_id=? AND o.kind=? AND u.codec_version=?
      AND o.state='ready' AND u.verified_at IS NOT NULL`,
                p.user,
                upload,
                a.object_id,
                a.role,
                a.codec_version,
              ),
            ),
          )
        ).map((r) => r.results[0]?.blake3)
      : [];
    if (descriptors.some((h) => !h)) throw new ApiError(409, 'asset_unverified');
    const digest = await hash([
      m.chunker,
      m.file_blake3,
      m.file_bytes,
      m.chunk_count,
      last.prefix_digest,
      assets.map((a, i) => [a.role, a.codec_version, descriptors[i]]),
    ]);
    const now = Date.now();
    // Validate and publish entirely in D1. The immutable prefix commits to every earlier part.
    const result = await db.batch<{ result_json: string }>([
      sessionGuard(env, p),
      ...inlineWrites,
      guard(
        db,
        `EXISTS(${openUpload} AND u.book_id=? AND b.file_hash=? AND u.base_manifest_id IS ?)
        AND (SELECT manifest_id FROM current_manifests WHERE user_id=? AND book_id=?) IS ?
        AND (SELECT prefix_digest FROM manifest_parts WHERE user_id=? AND upload_id=? ORDER BY part DESC LIMIT 1)=?`,
        p.user,
        upload,
        p.device,
        book,
        m.file_blake3,
        m.base_manifest_id,
        p.user,
        book,
        m.base_manifest_id,
        p.user,
        upload,
        last.prefix_digest,
      ),
      ...assets.map((a) =>
        statement(
          db,
          'INSERT INTO manifest_assets VALUES(?,?,?,?,?)',
          p.user,
          upload,
          a.role,
          a.object_id,
          a.codec_version,
        ),
      ),
      statement(
        db,
        'UPDATE sync_state SET head_seq=head_seq+1,lamport=lamport+1 WHERE user_id=?',
        p.user,
      ),
      guard(db, 'changes()=1'),
      statement(
        db,
        `INSERT INTO current_manifests
        SELECT user_id,?,?,?,?,?,?,head_seq FROM sync_state WHERE user_id=?
        ON CONFLICT(user_id,book_id) DO UPDATE SET manifest_id=excluded.manifest_id,file_bytes=excluded.file_bytes,
        chunk_count=excluded.chunk_count,profile=excluded.profile,manifest_digest=excluded.manifest_digest,rev=excluded.rev`,
        book,
        upload,
        m.file_bytes,
        m.chunk_count,
        m.chunker,
        digest,
        p.user,
      ),
      statement(
        db,
        `UPDATE uploads SET state='committed',commit_op_id=? WHERE user_id=? AND id=?`,
        m.op_id,
        p.user,
        upload,
      ),
      statement(
        db,
        `UPDATE books SET rev=(SELECT head_seq FROM sync_state WHERE user_id=?) WHERE user_id=? AND id=?`,
        p.user,
        p.user,
        book,
      ),
      statement(
        db,
        `INSERT INTO oplog SELECT user_id,head_seq,json_object('server_seq',head_seq,'lamport',lamport,
        'changes',json_array(json_object('kind','manifest.published','id',?,'manifest_id',?,'rev',head_seq,'file_bytes',?,
        'cover_avif_key',(SELECT cover_avif_key FROM book_covers WHERE user_id=? AND book_id=?)))),?
        FROM sync_state WHERE user_id=?`,
        book,
        upload,
        m.file_bytes,
        p.user,
        book,
        now,
        p.user,
      ),
      statement(
        db,
        `INSERT INTO op_receipts SELECT user_id,?,?,?,json_object('book_id',?,'manifest_id',?,
        'manifest_digest',?,'server_seq',head_seq,'chunk_count',?,'availability','cloud_ready'),?
        FROM sync_state WHERE user_id=?`,
        m.op_id,
        p.device,
        request,
        book,
        upload,
        digest,
        m.chunk_count,
        now,
        p.user,
      ),
      statement(
        db,
        'SELECT result_json FROM op_receipts WHERE user_id=? AND op_id=?',
        p.user,
        m.op_id,
      ),
    ]);
    return JSON.parse(result.at(-1)!.results[0]!.result_json);
  } catch (error) {
    const raced = await receipt();
    if (raced) return raced;
    if (isGuardFailure(error) || String(error).includes('manifest_object_unverified'))
      throw new ApiError(409, 'manifest_precondition_failed');
    throw error;
  }
}
