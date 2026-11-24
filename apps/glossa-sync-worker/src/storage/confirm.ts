import { objectStorage, type ObjectStorageProvider } from './provider';
import { liveSession } from '../auth/sessions';
import { ApiError, type Bindings, type Principal } from '../contracts';
import { chunkedBatch, guard, isGuardFailure, statement } from '../db/batch';

type Member = {
  id: string;
  object_key: string;
  state: 'ready' | 'reserved';
  verified_at: number | null;
  bytes: number;
  mime: string;
  md5_b64: string;
  etag: string | null;
};
export const openUpload = `SELECT 1 FROM uploads u JOIN books b ON b.user_id=u.user_id AND b.id=u.book_id
  WHERE u.user_id=? AND u.id=? AND u.device_id=? AND u.state='open'
  AND u.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER) AND b.deleted_at IS NULL`;

async function confirmHead(bucket: Pick<ObjectStorageProvider, 'headObject'>, member: Member) {
  if (member.state === 'ready') return { member, etag: member.etag };
  const head = await bucket.headObject(member.object_key);
  if (!head) return null;
  // v1 negotiates single-part PUT. For that representation the R2 ETag is the MD5 hex.
  const expectedHex = [...atob(member.md5_b64)]
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  const md5 = head.md5;
  const matches = md5
    ? btoa(String.fromCharCode(...new Uint8Array(md5))) === member.md5_b64
    : head.etag.toLowerCase() === expectedHex;
  if (head.bytes !== member.bytes || head.contentType !== member.mime || !matches)
    throw new ApiError(409, 'object_identity_conflict');
  return { member, etag: head.etag };
}

export async function confirm(env: Bindings, p: Principal, upload: string, ids: string[]) {
  const db = env.DB;
  const uploadKeys = [p.user, upload, p.device];
  const reads = chunkedBatch(
    db,
    ids,
    [p.user, upload],
    (id) => [id],
    (slots) =>
      `SELECT o.id,o.object_key,o.state,o.bytes,o.mime,o.md5_b64,o.etag,u.verified_at
     FROM upload_objects u JOIN objects o ON o.user_id=u.user_id AND o.id=u.object_id
     WHERE u.user_id=? AND u.upload_id=? AND o.state IN ('ready','reserved')
     AND o.id IN (${slots.join(',')})`,
  );
  // One consistent read batch, and no object-store access until every requested ID is authorized.
  const [session, ...pages] = await db.batch([statement(db, openUpload, ...uploadKeys), ...reads]);
  const members = pages.flatMap((page) => page.results as Member[]);
  if (!session?.results.length || members.length !== ids.length)
    throw new ApiError(404, 'upload_member_not_found');

  const storage = objectStorage(env);
  const checked: { member: Member; etag: string | null }[] = [];
  for (let i = 0; i < members.length; i += 4) {
    const group = await Promise.all(members.slice(i, i + 4).map((m) => confirmHead(storage, m)));
    for (const item of group) if (item) checked.push(item);
  }
  const verified = new Set(checked.map((item) => item.member.id));
  const values = (slots: string[]) => slots.map((slot) => '(' + slot + ')').join(',');
  const writes = [
    ...chunkedBatch(
      db,
      checked,
      [p.user, upload],
      ({ member: m }) => [m.id, m.object_key, m.bytes, m.md5_b64, m.mime],
      (slots) => `WITH scope(user_id,upload_id) AS (VALUES (?,?)),
        expected(id,key,bytes,md5,mime) AS (VALUES ${values(slots)})
        INSERT INTO write_guard(ok) VALUES (NOT EXISTS (
          SELECT 1 FROM expected e CROSS JOIN scope s
          LEFT JOIN upload_objects u ON (u.user_id,u.upload_id,u.object_id)=(s.user_id,s.upload_id,e.id)
          LEFT JOIN objects o ON (o.user_id,o.id)=(u.user_id,u.object_id)
          WHERE o.id IS NULL OR o.state='gc' OR o.object_key<>e.key OR o.bytes<>e.bytes
            OR o.md5_b64<>e.md5 OR o.mime<>e.mime
        )) ON CONFLICT(ok) DO NOTHING`,
    ),
    ...chunkedBatch(
      db,
      checked.filter((item) => item.member.state === 'reserved'),
      [p.user],
      (item) => [item.member.id, item.etag],
      (slots) => `WITH owner(uid) AS (VALUES (?)),
        confirmed(id,etag) AS (VALUES ${values(slots)}) UPDATE objects SET state='ready',
        etag=(SELECT etag FROM confirmed WHERE confirmed.id=objects.id)
        WHERE user_id=(SELECT uid FROM owner) AND state='reserved' AND id IN (SELECT id FROM confirmed)`,
    ),
    ...chunkedBatch(
      db,
      checked.filter((item) => item.member.verified_at === null),
      [Date.now(), p.user, upload],
      (item) => [item.member.id],
      (slots) => `UPDATE upload_objects SET verified_at=?
        WHERE user_id=? AND upload_id=? AND verified_at IS NULL AND object_id IN (${slots.join(',')})`,
    ),
  ];
  try {
    await db.batch([
      guard(
        db,
        `EXISTS(${liveSession}) AND EXISTS(${openUpload})`,
        p.user,
        p.session,
        p.device,
        Date.now(),
        ...uploadKeys,
      ),
      ...writes,
    ]);
  } catch (error) {
    if (isGuardFailure(error)) throw new ApiError(409, 'upload_changed');
    throw error;
  }
  return {
    verified: ids.filter((id) => verified.has(id)),
    pending: ids.filter((id) => !verified.has(id)),
  };
}
