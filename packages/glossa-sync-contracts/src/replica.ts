// Scoped, dedicated SQLite connection. DatabaseService on the native and Node clients
// provides this transaction boundary. Network calls always happen outside local transactions.
import { z } from 'zod';
import { operation } from './sync.ts';

export interface ReplicaDatabase {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  batch(statements: string[]): Promise<void>;
}
export interface SyncTransport {
  request(path: string, body?: unknown): Promise<unknown>;
}
type OperationInput = z.input<typeof operation>;
export type OfflineEdit<T = OperationInput> = T extends OperationInput ? Omit<T, 'lamport'> : never;
type JsonObject = Record<string, unknown>;
type Counter = { cursor: number; clock: number; version: number };
type Draft = {
  op_id: string;
  payload: string;
  draft: string;
  state: string;
  result: string | null;
};
const sequence = z.int().nonnegative();
const entity = z.enum(['book', 'group', 'annotation']);
const actions = z.enum([
  'book.create',
  'book.patch',
  'book.move',
  'book.progress',
  'book.trash',
  'book.restore',
  'book.purge',
  'group.create',
  'group.rename',
  'group.move',
  'group.dissolve',
  'annotation.create',
  'annotation.patch',
  'annotation.trash',
  'annotation.restore',
  'manifest.published',
]);
const change = z.looseObject({ kind: actions, id: z.uuid(), rev: sequence });
const event = z.strictObject({
  server_seq: sequence,
  lamport: sequence,
  changes: z.array(change).min(1),
});
const page = z.strictObject({
  until: sequence,
  next_cursor: sequence,
  has_more: z.boolean(),
  events: z.array(event),
});
const snapshotPage = z.strictObject({
  head_seq: sequence,
  lamport: sequence,
  next_page_token: z.string().nullable(),
  records: z.array(z.looseObject({ entity, id: z.uuid(), rev: sequence })),
});
const pushReply = z.strictObject({
  head_seq: sequence,
  results: z
    .array(
      z.looseObject({
        op_id: z.uuid(),
        status: z.enum(['applied', 'existing', 'noop', 'conflict', 'unprocessed']),
        server_seq: sequence.optional(),
        existing_book_id: z.uuid().optional(),
      }),
    )
    .length(1),
});
const scalar = (s: string | number) =>
  typeof s === 'number' ? String(s) : "'" + s.replaceAll("'", "''") + "'";
const json = (o: unknown) => scalar(JSON.stringify(o));
const kindOf = (k: string) => (k.startsWith('manifest.') ? 'book' : k.split('.')[0]!);
export class SyncHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export function httpTransport(origin: string, accessToken: () => Promise<string>): SyncTransport {
  return {
    async request(path, body) {
      const options = {
        redirect: 'error',
        credentials: 'omit',
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer ' + (await accessToken()),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      } as const;
      const response = await fetch(new URL('/v1' + path, origin), options);
      const value = (await response.json()) as { error?: { code?: string } };
      if (!response.ok)
        throw new SyncHttpError(response.status, value.error?.code ?? 'sync_failed');
      return value;
    },
  };
}
const publishedBook = z.object({
  id: z.uuid(), manifest_id: z.uuid(), file_hash: z.string().regex(/^[0-9a-f]{64}$/),
  thumbhash: z.string().nullable().optional(),
  cover_avif_key: z.string().nullable().optional(),
  finished_at: z.int().nullable().optional(), file_bytes: z.int().positive(), rev: sequence, title: z.string(), authors: z.array(z.string()),
  format: z.enum(['pdf','epub']), language: z.string().nullable(), status: z.enum(['unread','reading','finished']),
});
export type PublishedBook = z.infer<typeof publishedBook>;
export class SqliteReplica {
  private db: ReplicaDatabase;
  private scope: string;
  private constructor(db: ReplicaDatabase, scope: string) {
    this.db = db;
    this.scope = scope;
  }
  static async open(
    db: ReplicaDatabase,
    identity: { issuer: string; user: string; device: string },
  ) {
    const scope = JSON.stringify([identity.issuer, identity.user, identity.device]);
    await db.batch([
      'CREATE TABLE IF NOT EXISTS gs_state(scope TEXT PRIMARY KEY,cursor INTEGER NOT NULL,clock INTEGER NOT NULL,version INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS gs_guard(ok INTEGER PRIMARY KEY CHECK(ok=1))',
      'CREATE TABLE IF NOT EXISTS gs_fact(scope TEXT,entity TEXT,id TEXT,value TEXT NOT NULL,PRIMARY KEY(scope,entity,id))',
      'CREATE TABLE IF NOT EXISTS gs_stage(scope TEXT,run TEXT,entity TEXT,id TEXT,value TEXT NOT NULL,PRIMARY KEY(scope,run,entity,id))',
      'CREATE TABLE IF NOT EXISTS gs_outbox(scope TEXT,op_id TEXT,clock INTEGER NOT NULL,entity TEXT,id TEXT,payload TEXT NOT NULL,draft TEXT NOT NULL,state TEXT NOT NULL,result TEXT,PRIMARY KEY(scope,op_id),UNIQUE(scope,clock))',
      'CREATE TABLE IF NOT EXISTS gs_alias(scope TEXT,local_id TEXT,remote_id TEXT NOT NULL,PRIMARY KEY(scope,local_id))',
      `INSERT INTO gs_state VALUES(${scalar(scope)},0,0,0) ON CONFLICT(scope) DO NOTHING`,
    ]);
    return new SqliteReplica(db, scope);
  }
  private get key() {
    return scalar(this.scope);
  }
  private async state() {
    return (
      await this.db.select<Counter>('SELECT cursor,clock,version FROM gs_state WHERE scope=?', [
        this.scope,
      ])
    )[0]!;
  }
  private async commit(state: Counter, sql: string[], cursor = state.cursor, clock = state.clock) {
    await this.db.batch([
      `INSERT INTO gs_guard VALUES(EXISTS(SELECT 1 FROM gs_state WHERE scope=${this.key} AND version=${state.version})) ON CONFLICT(ok) DO NOTHING`,
      ...sql,
      `UPDATE gs_state SET version=version+1,cursor=${cursor},clock=${clock} WHERE scope=${this.key}`,
    ]);
  }
  async edit(input: OfflineEdit, draft: JsonObject) {
    const s = await this.state();
    const op = operation.parse({ ...input, lamport: s.clock + 1 });
    await this.commit(
      s,
      [
        `INSERT INTO gs_outbox VALUES(${this.key},${scalar(op.op_id)},${op.lamport},
      ${scalar(kindOf(op.kind))},${scalar(op.entity_id)},${json(op)},${json(draft)},'pending',NULL)`,
      ],
      s.cursor,
      op.lamport,
    );
    return op.op_id;
  }
  async inspect(type: 'group' | 'book' | 'annotation', id: string) {
    const [alias] =
      type === 'book'
        ? await this.db.select<{ remote_id: string }>(
            'SELECT remote_id FROM gs_alias WHERE scope=? AND local_id=?',
            [this.scope, id],
          )
        : [];
    const [fact] = await this.db.select<{ value: string }>(
      'SELECT value FROM gs_fact WHERE scope=? AND entity=? AND id=?',
      [this.scope, type, alias?.remote_id ?? id],
    );
    const drafts = await this.db.select<Draft>(
      'SELECT op_id,draft,state,result FROM gs_outbox WHERE scope=? AND entity=? AND id=? ORDER BY clock',
      [this.scope, type, id],
    );
    return {
      confirmed: fact ? JSON.parse(fact.value) : null,
      drafts: drafts.map((d) => ({
        op_id: d.op_id,
        state: d.state,
        value: JSON.parse(d.draft),
        result: d.result ? JSON.parse(d.result) : null,
      })),
    };
  }
  async hasBookDrafts(book: string) {
    const rows = await this.db.select<{ pending: number }>(
      `WITH ids(id) AS (SELECT ? UNION SELECT local_id FROM gs_alias WHERE scope=? AND remote_id=?)
       SELECT EXISTS(SELECT 1 FROM gs_outbox o WHERE o.scope=? AND (
         (o.entity='book' AND o.id IN (SELECT id FROM ids)) OR
         (o.entity='annotation' AND (json_extract(o.payload,'$.data.book_id') IN (SELECT id FROM ids)
           OR EXISTS(SELECT 1 FROM gs_fact f WHERE f.scope=o.scope AND f.entity='annotation'
             AND f.id=o.id AND json_extract(f.value,'$.book_id') IN (SELECT id FROM ids)))))) pending`,
      [book, this.scope, book, this.scope],
    );
    return rows[0]!.pending === 1;
  }
  async publishedBooks() {
    // One SQLite read pins both the scope's watermark and its catalog, including an empty catalog.
    const rows = await this.db.select<{cursor: number; value: string | null}>(
      `SELECT s.cursor,f.value FROM gs_state s LEFT JOIN gs_fact f ON f.scope=s.scope
        AND f.entity='book' AND json_extract(f.value,'$.deleted_at') IS NULL
        AND json_extract(f.value,'$.manifest_id') IS NOT NULL
        WHERE s.scope=? ORDER BY f.id`, [this.scope],
    );
    return { cursor: rows[0]!.cursor, books: rows.flatMap(({value}) => value ? [publishedBook.parse(JSON.parse(value))] : []) };
  }
  async discardConflict(opId: string) {
    await this.db.execute("DELETE FROM gs_outbox WHERE scope=? AND op_id=? AND state='conflict'", [
      this.scope,
      opId,
    ]);
  }
  private async pushNext(api: SyncTransport) {
    const s = await this.state();
    const [d] = await this.db.select<Draft>(
      "SELECT * FROM gs_outbox WHERE scope=? AND state='pending' ORDER BY clock LIMIT 1",
      [this.scope],
    );
    if (!d) return false;
    const op = operation.parse(JSON.parse(d.payload));
    // Reuse the authoritative file identity for subsequent offline operations after deduplication.
    const refs = [op.entity_id, op.kind === 'annotation.create' ? op.data.book_id : null];
    const aliases = await this.db.select<{ local_id: string; remote_id: string }>(
      'SELECT local_id,remote_id FROM gs_alias WHERE scope=? AND local_id IN (?,?)',
      [this.scope, ...refs],
    );
    for (const a of aliases) {
      if (op.entity_id === a.local_id && op.kind.startsWith('book.') && op.kind !== 'book.create')
        op.entity_id = a.remote_id;
      if (op.kind === 'annotation.create' && op.data.book_id === a.local_id)
        op.data.book_id = a.remote_id;
    }
    const reply = pushReply.parse(await api.request('/sync/push', { ops: [op] })).results[0]!;
    if (reply.op_id !== op.op_id) throw new Error('Push receipt ID mismatch');
    if (reply.status === 'unprocessed') throw new Error('Push deferred');
    const where = `scope=${this.key} AND op_id=${scalar(op.op_id)}`;
    const writes = [];
    if (reply.status === 'existing') {
      if (!reply.existing_book_id) throw new Error('Missing book alias');
      writes.push(`INSERT INTO gs_alias VALUES(${this.key},${scalar(op.entity_id)},${scalar(reply.existing_book_id)})
        ON CONFLICT(scope,local_id) DO UPDATE SET remote_id=excluded.remote_id`);
    }
    if (reply.status === 'applied' && reply.server_seq === undefined)
      throw new Error('Missing receipt sequence');
    if (
      reply.status === 'conflict' ||
      (reply.status === 'applied' && reply.server_seq! > s.cursor)
    ) {
      writes.push(
        `UPDATE gs_outbox SET state=${scalar(reply.status === 'conflict' ? 'conflict' : 'waiting')},result=${json(reply)} WHERE ${where}`,
      );
    } else writes.push(`DELETE FROM gs_outbox WHERE ${where}`);
    await this.commit(s, writes);
    return reply.status !== 'conflict';
  }
  private retire(cursor: number) {
    return `DELETE FROM gs_outbox WHERE scope=${this.key} AND state='waiting' AND json_extract(result,'$.server_seq')<=${cursor}`;
  }
  private async bootstrap(api: SyncTransport) {
    const run = Date.now() + ':' + crypto.randomUUID(),
      s = await this.state();
    await this.db.execute('DELETE FROM gs_stage WHERE scope=? AND CAST(run AS INTEGER)<?', [
      this.scope,
      Date.now() - 86400000,
    ]);
    let count = 0;
    let token: string | null = null,
      head: number | undefined,
      clock = s.clock;
    try {
      do {
        const r = snapshotPage.parse(
          await api.request(
            '/sync/snapshot' + (token ? '?page_token=' + encodeURIComponent(token) : ''),
          ),
        );
        if (head !== undefined && head !== r.head_seq)
          throw new Error('Snapshot changed during transfer');
        head = r.head_seq;
        clock = Math.max(clock, r.lamport);
        count += r.records.length;
        if (r.records.length)
          await this.db.batch(
            r.records.map(
              ({ entity, ...record }) =>
                `INSERT INTO gs_stage VALUES(${this.key},${scalar(run)},${scalar(entity)},${scalar(record.id)},${json(record)})`,
            ),
          );
        token = r.next_page_token;
      } while (token);
      await this.commit(
        s,
        [
          `INSERT INTO gs_guard VALUES((SELECT count(*) FROM gs_stage WHERE scope=${this.key} AND run=${scalar(run)})=${count}) ON CONFLICT(ok) DO NOTHING`,
          `DELETE FROM gs_fact WHERE scope=${this.key}`,
          `INSERT INTO gs_fact SELECT scope,entity,id,value FROM gs_stage WHERE scope=${this.key} AND run=${scalar(run)}`,
          this.retire(head!),
        ],
        head!,
        Math.max(clock, head!),
      );
    } finally {
      await this.db.execute('DELETE FROM gs_stage WHERE scope=? AND run=?', [this.scope, run]);
    }
  }
  private async pullAll(api: SyncTransport) {
    let until: number | undefined;
    for (;;) {
      const s = await this.state();
      let r: z.infer<typeof page>;
      try {
        r = page.parse(
          await api.request(
            '/sync/pull?after=' + s.cursor + (until === undefined ? '' : '&until=' + until),
          ),
        );
      } catch (e) {
        if (!(e instanceof SyncHttpError) || e.code !== 'cursor_expired') throw e;
        await this.bootstrap(api);
        until = undefined;
        continue;
      }
      if ((until !== undefined && until !== r.until) || r.until < s.cursor)
        throw new Error('Invalid pull watermark');
      let cursor = s.cursor,
        clock = s.clock;
      const writes: string[] = [];
      const staged = new Map<string, JsonObject | null>();
      for (const event of r.events) {
        if (event.server_seq !== cursor + 1) throw new Error('Discontinuous event page');
        cursor = event.server_seq;
        clock = Math.max(clock, event.lamport);
        for (const { kind, id, rev, ...fields } of event.changes) {
          if (rev !== cursor) throw new Error('Change revision mismatch');
          const entity = kindOf(kind),
            key = entity + ':' + id;
          const where = `scope=${this.key} AND entity=${scalar(entity)} AND id=${scalar(id)}`;
          if (kind === 'book.purge') {
            writes.push(
              `DELETE FROM gs_fact WHERE ${where}`,
              `DELETE FROM gs_fact WHERE scope=${this.key}
              AND entity='annotation' AND json_extract(value,'$.book_id')=${scalar(id)}`,
            );
            staged.set(key, null);
            continue;
          }
          let prior = staged.get(key);
          if (prior === undefined) {
            const [row] = await this.db.select<{ value: string }>(
              'SELECT value FROM gs_fact WHERE scope=? AND entity=? AND id=?',
              [this.scope, entity, id],
            );
            prior = row ? JSON.parse(row.value) : null;
          }
          if (!prior && !kind.endsWith('.create')) throw new Error('Missing base record');
          const record = { ...prior, ...fields, id, rev };
          staged.set(key, record);
          writes.push(`INSERT INTO gs_fact VALUES(${this.key},${scalar(entity)},${scalar(id)},${json(record)})
            ON CONFLICT(scope,entity,id) DO UPDATE SET value=excluded.value`);
        }
      }
      if (
        cursor !== r.next_cursor ||
        r.has_more !== cursor < r.until ||
        (r.has_more && !r.events.length)
      )
        throw new Error('Inconsistent event page');
      if (r.events.length) await this.commit(s, [...writes, this.retire(cursor)], cursor, clock);
      await api.request('/sync/ack', { cursor });
      if (!r.has_more) return;
      until = r.until;
    }
  }
  async synchronize(api: SyncTransport) {
    await this.pullAll(api);
    let pushed = false;
    while (await this.pushNext(api)) pushed = true;
    if (pushed) await this.pullAll(api);
  }
}
