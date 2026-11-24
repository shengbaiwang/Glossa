import type { Bindings } from '../contracts';
import { statement } from '../db/batch';
import { objectStorage } from './provider';

// Never recycle a physical key. Retain gc rows for delayed PUT reconciliation.
export async function sweep(env: Bindings, now = Date.now()) {
  const db = env.DB;
  const [, , targets] = await db.batch<{ object_key: string }>([
    statement(
      db,
      `DELETE FROM uploads WHERE rowid IN (SELECT u.rowid FROM uploads u
      WHERE u.expires_at<=? AND NOT EXISTS(SELECT 1 FROM current_manifests c
      WHERE c.user_id=u.user_id AND c.book_id=u.book_id AND c.manifest_id=u.id)
      ORDER BY u.expires_at LIMIT 16)`,
      now,
    ),
    statement(
      db,
      `UPDATE objects SET state='gc' WHERE rowid IN (SELECT o.rowid FROM objects o
      WHERE o.state IN ('reserved','ready') AND max(o.put_until,o.keep_until)<?
      AND NOT EXISTS(SELECT 1 FROM manifest_chunks m WHERE m.user_id=o.user_id AND m.object_id=o.id)
      AND NOT EXISTS(SELECT 1 FROM manifest_assets m WHERE m.user_id=o.user_id AND m.object_id=o.id)
      AND NOT EXISTS(SELECT 1 FROM upload_objects u WHERE u.user_id=o.user_id AND u.object_id=o.id)
      LIMIT 32)`,
      now - 60_000,
    ),
    statement(
      db,
      "SELECT object_key FROM objects WHERE state='gc' AND retry_at<=? ORDER BY retry_at,object_key LIMIT 16",
      now,
    ),
  ]);
  if (!targets?.results.length) return;
  const outcomes = await objectStorage(env).deleteObjects(targets.results.map((r) => r.object_key));
  await db.batch(
    outcomes.map((o) =>
      statement(
        db,
        "UPDATE objects SET retry_at=max(retry_at,?) WHERE object_key=? AND state='gc'",
        now + (o.deleted ? 86400000 : 60000),
        o.key,
      ),
    ),
  );
}
