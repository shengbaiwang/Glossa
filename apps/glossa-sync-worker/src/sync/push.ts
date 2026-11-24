import type { Operation } from '@glossa/sync-contracts/sync';
import { ApiError, type Bindings, type Principal } from '../contracts';
import { hash } from '../db/digest';
import { guard, isGuardFailure, statement } from '../db/batch';
import { sessionGuard } from '../storage/uploads';
import { plan, type Result } from './entities';

const MAX_EVENT = 65536;
type Receipt = { request_digest: string; result_json: string };
type Clock = { head_seq: number; lamport: number; last_lamport: number };
async function apply(env: Bindings, p: Principal, op: Operation) {
  const db = env.DB,
    now = Date.now(),
    digest = await hash(['sync.push', p.device, op]);
  const [receipts, clocks] = await db.batch<Receipt & Clock>([
    statement(
      db,
      'SELECT request_digest,result_json FROM op_receipts WHERE user_id=? AND op_id=?',
      p.user,
      op.op_id,
    ),
    statement(
      db,
      `SELECT s.head_seq,s.lamport,d.last_lamport FROM sync_state s JOIN devices d ON d.user_id=s.user_id
      WHERE s.user_id=? AND d.id=?`,
      p.user,
      p.device,
    ),
  ]);
  const replay = receipts!.results[0];
  if (replay) {
    if (replay.request_digest !== digest) throw new ApiError(409, 'idempotency_mismatch');
    return JSON.parse(replay.result_json) as Result;
  }
  const clock = clocks!.results[0]!;
  const seq = clock.head_seq + 1,
    lt = Math.max(clock.lamport, op.lamport) + 1;
  const change =
    op.lamport <= clock.last_lamport
      ? { result: { status: 'conflict', code: 'lamport_stale' } as Result, changes: [], writes: [] }
      : await plan(env, p, op, seq, now);
  const event = JSON.stringify({ server_seq: seq, lamport: lt, changes: change.changes });
  if (new TextEncoder().encode(event).length > MAX_EVENT) {
    change.result = { status: 'conflict', code: 'scope_too_large' };
    change.changes = [];
    change.writes = [];
  }
  const applied = change.changes.length > 0;
  const result = { op_id: op.op_id, ...change.result, ...(applied ? { server_seq: seq } : {}) };
  const writes = [
    sessionGuard(env, p),
    guard(
      db,
      `EXISTS(SELECT 1 FROM sync_state s JOIN devices d ON d.user_id=s.user_id
      WHERE s.user_id=? AND s.head_seq=? AND d.id=? AND d.last_lamport=?)
      AND NOT EXISTS(SELECT 1 FROM op_receipts WHERE user_id=? AND op_id=?)`,
      p.user,
      clock.head_seq,
      p.device,
      clock.last_lamport,
      p.user,
      op.op_id,
    ),
    ...change.writes,
    statement(
      db,
      'UPDATE devices SET last_lamport=max(last_lamport,?),last_seen_at=? WHERE user_id=? AND id=?',
      op.lamport,
      now,
      p.user,
      p.device,
    ),
  ];
  if (applied)
    writes.push(
      statement(db, 'UPDATE sync_state SET head_seq=?,lamport=? WHERE user_id=?', seq, lt, p.user),
      statement(db, 'INSERT INTO oplog VALUES(?,?,?,?)', p.user, seq, event, now),
    );
  writes.push(
    statement(
      db,
      'INSERT INTO op_receipts VALUES(?,?,?,?,?,?)',
      p.user,
      op.op_id,
      p.device,
      digest,
      JSON.stringify(result),
      now,
    ),
  );
  await db.batch(writes);
  return result;
}
export async function push(env: Bindings, p: Principal, ops: Operation[]) {
  const results: Record<string, unknown>[] = [];
  // Bound D1 round trips even when multiple devices race. Clients resubmit the unprocessed suffix.
  let remainingAttempts = 4,
    stopped = false;
  for (const op of ops) {
    let result: Result | undefined;
    while (!stopped && remainingAttempts > 0) {
      remainingAttempts--;
      try {
        result = await apply(env, p, op);
        break;
      } catch (e) {
        if (!isGuardFailure(e)) throw e;
      }
    }
    if (result?.status === 'conflict' || !result) stopped = true;
    results.push(result ?? { op_id: op.op_id, status: 'unprocessed' });
  }
  const head_seq = await statement(
    env.DB,
    'SELECT head_seq FROM sync_state WHERE user_id=?',
    p.user,
  ).first<number>('head_seq');
  return { results, head_seq };
}
