import type { z } from 'zod';
import { ApiError, type Bindings, type Principal, type streamInput } from '../contracts';
import { chunkedBatch, guard, isGuardFailure, statement } from '../db/batch';
import { sessionGuard } from './uploads';
import { objectStorage } from './provider';

type Header = {
  manifest_id: string;
  manifest_digest: string;
  book_rev: number;
  status: 'unread' | 'reading' | 'finished';
  finished_at: number | null;
  file_blake3: string;
  file_bytes: number;
  chunk_count: number;
  chunker: string;
  deleted_at: number | null;
};
type Entry = { object_id: string; object_key: string; blake3: string; bytes: number };
type Chunk = Entry & { ordinal: number; start_byte: number; end_byte: number };
type Asset = Entry & { role: string; codec_version: string };
const chunkSql = `SELECT m.ordinal,m.start_byte,m.end_byte,o.blake3,o.id object_id,o.object_key,o.bytes
  FROM manifest_chunks m JOIN objects o ON (o.user_id,o.id)=(m.user_id,m.object_id)
  WHERE m.user_id=? AND m.manifest_id=?`;
const assetSql = `SELECT a.role,a.codec_version,o.blake3,o.id object_id,o.object_key,o.bytes FROM manifest_assets a
  JOIN objects o ON (o.user_id,o.id)=(a.user_id,a.object_id) WHERE a.user_id=? AND a.manifest_id=?`;
async function header(env: Bindings, p: Principal, book: string, wanted?: string) {
  const row = await statement(
    env.DB,
    `SELECT b.deleted_at,b.rev book_rev,b.status,b.finished_at,b.file_hash file_blake3,c.manifest_id,c.manifest_digest,
    c.file_bytes,c.chunk_count,c.profile chunker FROM books b LEFT JOIN current_manifests c
    ON c.user_id=b.user_id AND c.book_id=b.id WHERE b.user_id=? AND b.id=?`,
    p.user,
    book,
  ).first<Header>();
  if (!row) throw new ApiError(404, 'book_not_found');
  if (row.deleted_at !== null) throw new ApiError(410, 'book_trashed');
  if (!row.manifest_id) throw new ApiError(404, 'manifest_not_found');
  if (wanted && row.manifest_id !== wanted) throw new ApiError(409, 'manifest_changed');
  return row;
}
const current = `EXISTS(SELECT 1 FROM current_manifests c JOIN books b ON b.user_id=c.user_id AND b.id=c.book_id
  WHERE b.deleted_at IS NULL AND c.user_id=? AND c.book_id=? AND c.manifest_id=?)`;
async function checkedBatch<T>(
  env: Bindings,
  p: Principal,
  book: string,
  manifest: string,
  steps: D1PreparedStatement[],
) {
  try {
    return (
      await env.DB.batch<T>([
        sessionGuard(env, p),
        guard(env.DB, current, p.user, book, manifest),
        ...steps,
      ])
    ).slice(2);
  } catch (e) {
    if (isGuardFailure(e)) throw new ApiError(409, 'manifest_changed');
    throw e;
  }
}
export async function getManifest(
  env: Bindings,
  p: Principal,
  book: string,
  wanted: string | undefined,
  after: number,
  limit: number,
) {
  const { deleted_at, ...meta } = await header(env, p, book, wanted);
  const scope = [p.user, meta.manifest_id];
  const [, entries, assets] = await checkedBatch<Chunk & Asset>(env, p, book, meta.manifest_id, [
    guard(
      env.DB,
      'EXISTS(SELECT 1 FROM books WHERE user_id=? AND id=? AND rev=?)',
      p.user,
      book,
      meta.book_rev,
    ),
    statement(
      env.DB,
      chunkSql + ' AND m.ordinal>? ORDER BY m.ordinal LIMIT ?',
      ...scope,
      after,
      limit,
    ),
    statement(env.DB, assetSql + ' ORDER BY a.role', ...scope),
  ]);
  const chunks = entries!.results.map(({ ordinal, blake3, start_byte, end_byte }) => ({
    ordinal,
    blake3,
    start_byte,
    end_byte,
  }));
  const last = chunks.at(-1)?.ordinal;
  return {
    ...meta,
    assets: assets!.results,
    chunks,
    next_ordinal: last !== undefined && last + 1 < meta.chunk_count ? last : null,
  };
}
export async function stream(
  env: Bindings,
  p: Principal,
  book: string,
  input: z.infer<typeof streamInput>,
) {
  const db = env.DB;
  const meta = await header(env, p, book, input.manifest_id);
  if (input.ranges.some((r) => r.end_byte >= meta.file_bytes))
    throw new ApiError(422, 'range_outside_file');
  const scope = [p.user, meta.manifest_id];
  const ranges = chunkedBatch(
    db,
    input.ranges,
    scope,
    (r) => [r.start_byte, r.end_byte],
    (slots) =>
      `WITH scope(uid,manifest) AS (VALUES (?,?)), ranges(lo,hi) AS (VALUES ${slots.map((s) => '(' + s + ')').join(',')})
    SELECT DISTINCT m.ordinal,m.start_byte,m.end_byte,o.id object_id,o.object_key,o.bytes,o.blake3
    FROM scope s,ranges r JOIN manifest_chunks m ON m.user_id=s.uid AND m.manifest_id=s.manifest
    AND m.end_byte>=r.lo AND m.start_byte<=r.hi JOIN objects o ON o.user_id=m.user_id AND o.id=m.object_id
    ORDER BY m.ordinal LIMIT 129`,
  );
  const assetReads = chunkedBatch(
    db,
    input.assets,
    scope,
    (r) => [r],
    (slots) => assetSql + ' AND a.role IN (' + slots.join(',') + ')',
  );
  const result = await checkedBatch<Chunk & Asset>(env, p, book, meta.manifest_id, [
    ...ranges,
    ...assetReads,
  ]);
  const chunks = result.slice(0, ranges.length).flatMap((r) => r.results);
  const assets = result.slice(ranges.length).flatMap((r) => r.results);
  if (assets.length !== new Set(input.assets).size) throw new ApiError(404, 'asset_not_found');
  const objects = [...new Map([...chunks, ...assets].map((o) => [o.object_id, o])).values()];
  if (chunks.length > 128 || objects.reduce((n, o) => n + o.bytes, 0) > 128 * 1024 * 1024)
    throw new ApiError(413, 'range_window_too_large');
  const expires = Date.now() + 120_000;
  await checkedBatch(
    env,
    p,
    book,
    meta.manifest_id,
    chunkedBatch(
      db,
      objects,
      [expires, p.user],
      (o) => [o.object_id],
      (slots) =>
        "UPDATE objects SET keep_until=max(keep_until,?) WHERE user_id=? AND state='ready' AND id IN (" +
        slots.join(',') +
        ')',
    ),
  );
  const provider = objectStorage(env);
  const urls = new Map(
    await Promise.all(
      objects.map(
        async (o) =>
          [o.object_id, (await provider.generatePresignedGet(o.object_key, expires)).url] as const,
      ),
    ),
  );
  return {
    manifest_id: meta.manifest_id,
    expires_at: Math.floor(expires / 1000) * 1000,
    chunks: chunks.map(({ ordinal, blake3, start_byte, end_byte, object_id }) => ({
      ordinal,
      blake3,
      start_byte,
      end_byte,
      get_url: urls.get(object_id),
    })),
    assets: assets.map(({ role, blake3, object_id }) => ({
      role,
      blake3,
      get_url: urls.get(object_id),
    })),
  };
}
