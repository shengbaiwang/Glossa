import type { Bindings } from '../contracts';
import { statement } from '../db/batch';

// High water marks and payloads expire together. Preserve receipts and purge fences.
export async function trimLog(env: Bindings, now = Date.now()) {
  const db = env.DB,
    day = 86_400_000;
  const candidates = await statement(
    db,
    `SELECT DISTINCT l.user_id FROM oplog l
    WHERE l.created_at<=? AND NOT EXISTS(SELECT 1 FROM devices d WHERE d.user_id=l.user_id
      AND d.revoked_at IS NULL AND d.last_seen_at>=? AND d.ack_seq<l.server_seq)
    LIMIT 4`,
    now - 90 * day,
    now - 45 * day,
  ).all<{ user_id: string }>();
  for (const { user_id } of candidates.results) {
    await db.batch([
      statement(
        db,
        `UPDATE sync_state SET floor_seq=max(floor_seq,coalesce((
        SELECT max(server_seq) FROM (SELECT server_seq FROM oplog WHERE user_id=? AND server_seq<=coalesce((
          SELECT min(ack_seq) FROM devices WHERE user_id=? AND revoked_at IS NULL AND last_seen_at>=?
        ),head_seq) AND created_at<=? ORDER BY server_seq LIMIT 256)
      ),floor_seq)) WHERE user_id=?`,
        user_id,
        user_id,
        now - 45 * day,
        now - 90 * day,
        user_id,
      ),
      statement(
        db,
        'DELETE FROM oplog WHERE user_id=? AND server_seq<=(SELECT floor_seq FROM sync_state WHERE user_id=?)',
        user_id,
        user_id,
      ),
    ]);
  }
}

export async function expireTrash(env: Bindings, now = Date.now()) {
  const { purgeExpiredBook } = await import('../library/purge');
  const due = await statement(
    env.DB,
    `SELECT b.user_id,b.id,b.rev FROM books b JOIN trash_policy t ON t.user_id=b.user_id
    WHERE b.deleted_at IS NOT NULL AND b.deleted_at<=?-86400000*t.days ORDER BY b.deleted_at LIMIT 4`,
    now,
  ).all<{ user_id: string; id: string; rev: number }>();
  for (const row of due.results) await purgeExpiredBook(env, row.user_id, row.id, row.rev, now);
}
