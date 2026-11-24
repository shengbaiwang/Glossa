import { ApiError, type Bindings, type Principal } from '../contracts';
import { guard, isGuardFailure, statement } from '../db/batch';
import { hash } from '../db/digest';
import { sessionGuard } from '../storage/uploads';

export async function purgeBook(
  env: Bindings,
  p: Principal,
  book: string,
  op: string,
  rev: number,
) {
  return purge(env, p.user, p, book, op, rev, Date.now());
}
export async function purgeExpiredBook(
  env: Bindings,
  user: string,
  book: string,
  rev: number,
  now: number,
) {
  try {
    return await purge(env, user, null, book, 'retention:' + book + ':' + rev, rev, now);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'trash_revision_changed') return;
    throw e;
  }
}
async function purge(
  env: Bindings,
  user: string,
  p: Principal | null,
  book: string,
  op: string,
  rev: number,
  now: number,
) {
  const db = env.DB;
  const digest = await hash(['book.purge', p?.device ?? null, book, rev]);
  async function replay() {
    const row = await statement(
      db,
      'SELECT request_digest,result_json FROM op_receipts WHERE user_id=? AND op_id=?',
      user,
      op,
    ).first<{ request_digest: string; result_json: string }>();
    if (!row) return null;
    if (row.request_digest !== digest) throw new ApiError(409, 'idempotency_mismatch');
    return JSON.parse(row.result_json) as { purge_seq: number };
  }
  const previous = await replay();
  if (previous) return previous;
  try {
    const results = await db.batch<{ result_json: string }>([
      p
        ? sessionGuard(env, p)
        : guard(
            db,
            `EXISTS(SELECT 1 FROM trash_policy t JOIN books b ON b.user_id=t.user_id
        WHERE b.user_id=? AND b.id=? AND b.deleted_at<=?-86400000*t.days)`,
            user,
            book,
            now,
          ),
      guard(
        db,
        'EXISTS(SELECT 1 FROM books WHERE user_id=? AND id=? AND deleted_at IS NOT NULL AND rev=?)',
        user,
        book,
        rev,
      ),
      statement(
        db,
        'UPDATE sync_state SET floor_seq=head_seq,head_seq=head_seq+1,lamport=lamport+1 WHERE user_id=?',
        user,
      ),
      guard(db, 'changes()=1'),
      statement(
        db,
        "INSERT INTO purge_fences SELECT user_id,'book',?,head_seq FROM sync_state WHERE user_id=?",
        book,
        user,
      ),
      statement(
        db,
        `INSERT INTO purge_fences SELECT a.user_id,'annotation',a.id,s.head_seq FROM annotations a
        JOIN sync_state s ON s.user_id=a.user_id WHERE a.user_id=? AND a.book_id=?`,
        user,
        book,
      ),
      statement(db, 'DELETE FROM books WHERE user_id=? AND id=?', user, book),
      statement(
        db,
        'DELETE FROM oplog WHERE user_id=? AND server_seq<=(SELECT floor_seq FROM sync_state WHERE user_id=?)',
        user,
        user,
      ),
      statement(
        db,
        `INSERT INTO oplog SELECT user_id,head_seq,json_object('server_seq',head_seq,'lamport',lamport,'changes',
        json_array(json_object('kind','book.purge','id',?,'rev',head_seq))),? FROM sync_state WHERE user_id=?`,
        book,
        now,
        user,
      ),
      statement(
        db,
        `INSERT INTO op_receipts SELECT user_id,?,?,?,json_object('purge_seq',head_seq),? FROM sync_state WHERE user_id=?`,
        op,
        p?.device ?? null,
        digest,
        now,
        user,
      ),
      statement(db, 'SELECT result_json FROM op_receipts WHERE user_id=? AND op_id=?', user, op),
    ]);
    return JSON.parse(results.at(-1)!.results[0]!.result_json) as { purge_seq: number };
  } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    if (isGuardFailure(error)) throw new ApiError(409, 'trash_revision_changed');
    throw error;
  }
}
