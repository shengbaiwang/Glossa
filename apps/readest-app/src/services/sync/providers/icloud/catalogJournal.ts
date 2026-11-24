import { z } from 'zod';
import { md5Fingerprint } from '@/utils/md5';
import { useSettingsStore } from '@/store/settingsStore';
import type { DatabaseService } from '@/types/database';
import type { Book } from '@/types/book';
import {
  bookRemovalSchema,
  peerRemovalPatch,
  compareBookRemoval,
} from '@/services/bookRemovalState';
import type { SegmentLog } from './exchangeSegments';

const scalar = z.string().nullable();
const time = z.number().int().nonnegative().nullable();
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const fields = z
  .object({
    icloudAsset: z
      .object({
        vault: z.string().uuid(),
        manifest: z.string().regex(/^[0-9a-f]{64}$/),
        file: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .nullable(),
    title: z.string(),
    author: z.string(),
    format: z.enum(['PDF', 'EPUB', 'MOBI', 'AZW', 'AZW3', 'CBZ', 'FB2', 'FBZ', 'TXT', 'MD']),
    sourceTitle: scalar,
    originalFilename: scalar,
    storedContentFingerprint: hash.nullable(),
    createdAt: time,
    icloudGroup: z
      .object({ vault: z.string().uuid(), id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })
      .nullable(),
    groupId: scalar,
    groupName: scalar,
    tags: z.array(z.string()).nullable(),
    primaryLanguage: scalar,
    readingStatus: z.enum(['unread', 'reading', 'finished', 'abandoned']).nullable(),
    coverHash: scalar,
    deletedAt: time,
    removal: bookRemovalSchema
      .omit({
        cloudScope: true,
        downloadedAt: true,
        releaseAfterDays: true,
        cloudTargets: true,
        failure: true,
      })
      .nullable(),
  })
  .partial()
  .strict();
type Key = keyof typeof fields.shape;
const keys = Object.keys(fields.shape) as Key[];
const clock = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const record = z
  .object({
    schema_version: z.literal(2),
    vault_id: z.string().uuid(),
    actor_id: z.string().uuid(),
    seq: clock.positive(),
    op_id: z.string().uuid(),
    hlc: clock,
    entity_id: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
    fingerprint: hash,
    patch: fields,
    deps: z.record(z.string().uuid(), clock),
  })
  .strict();
type Op = z.infer<typeof record>;
type Stamp = { clock: number; actor: string; seq: number; value: unknown };
type State = { fingerprint: string; fields: Partial<Record<Key, Stamp>> };
const sql = (s: string) => "'" + s.replaceAll("'", "''") + "'";
/** File and delivery receipts belong to the device which performed the action. A peer
 * removes a shelf record reversibly; it cannot purge another device's personal sidecars. */
export function projectVaultBook(previous: Book | undefined, remote: Book): Book {
  const next = {
    ...previous,
    ...remote,
    updatedAt: Math.max(previous?.updatedAt ?? 0, remote.updatedAt),
  };
  if (!remote.removal) return next;
  if (previous && compareBookRemoval(previous, remote) >= 0)
    return { ...next, removal: previous.removal, deletedAt: previous.deletedAt };
  const observed =
    remote.removal.mode === 'purge'
      ? { ...remote, removal: { ...remote.removal, mode: 'trash' as const } }
      : remote;
  const patch = peerRemovalPatch(
    previous ?? { ...remote, removal: undefined, updatedAt: 0 },
    observed,
  );
  return { ...next, ...patch, removal: patch.removal && { ...patch.removal, local: 'complete' } };
}
export class CatalogJournal implements SegmentLog {
  private actor = '';
  constructor(
    private db: DatabaseService,
    private vault: string,
  ) {}
  async init() {
    await this.db.batch([
      'CREATE TABLE IF NOT EXISTS ic_legacy_catalog(vault TEXT,entity TEXT,body TEXT,PRIMARY KEY(vault,entity))',
      'CREATE TABLE IF NOT EXISTS ic_identity(vault TEXT PRIMARY KEY,actor TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS ic_catalog(vault TEXT,entity TEXT,state TEXT NOT NULL,PRIMARY KEY(vault,entity))',
      'CREATE TABLE IF NOT EXISTS ic_catalog_ops(vault TEXT,actor TEXT,seq INTEGER,id TEXT,clock INTEGER,body TEXT,published INTEGER,PRIMARY KEY(vault,actor,seq),UNIQUE(vault,id))',
      'INSERT OR IGNORE INTO ic_identity VALUES(' +
        sql(this.vault) +
        ',' +
        sql(crypto.randomUUID()) +
        ')',
    ]);
    this.actor = (
      await this.db.select<{ actor: string }>('SELECT actor FROM ic_identity WHERE vault=?', [
        this.vault,
      ])
    )[0]!.actor;
  }
  async cursor() {
    const rows = await this.db.select<{ actor: string; seq: number }>(
      'SELECT actor,max(seq) AS seq FROM ic_catalog_ops WHERE vault=? GROUP BY actor',
      [this.vault],
    );
    return Object.fromEntries(rows.map((r) => [r.actor, r.seq]));
  }
  private async state(id: string, fingerprint: string): Promise<State> {
    const [row] = await this.db.select<{ state: string }>(
      'SELECT state FROM ic_catalog WHERE vault=? AND entity=?',
      [this.vault, id],
    );
    const state = row ? (JSON.parse(row.state) as State) : { fingerprint, fields: {} };
    if (state.fingerprint !== fingerprint) throw new Error('Conflicting iCloud book identity');
    return state;
  }
  private write(op: Op, state: State, published: boolean) {
    for (const key of Object.keys(op.patch) as Key[]) {
      const prior = state.fields[key];
      const seen = prior && (op.deps[prior.actor] ?? 0) >= prior.seq;
      if (prior && !seen) {
        // A restore requires causal observation of the tombstone.
        if (key === 'deletedAt' && prior.value && !op.patch.deletedAt) continue;
        if (
          !(key === 'deletedAt' && op.patch.deletedAt && !prior.value) &&
          (prior.clock > op.hlc || (prior.clock === op.hlc && prior.actor >= op.actor_id))
        )
          continue;
      }
      state.fields[key] = { clock: op.hlc, actor: op.actor_id, seq: op.seq, value: op.patch[key] };
    }
    return [
      'INSERT INTO ic_catalog_ops VALUES(' +
        [
          sql(this.vault),
          sql(op.actor_id),
          op.seq,
          sql(op.op_id),
          op.hlc,
          sql(JSON.stringify(op)),
          Number(published),
        ].join(',') +
        ')',
      'INSERT OR REPLACE INTO ic_catalog VALUES(' +
        [this.vault, op.entity_id, JSON.stringify(state)].map(sql).join(',') +
        ')',
    ];
  }
  // The library owner appends these statements to the very batch which saves its rows.
  async stage(changes: { current: Book; previous?: Book }[], baseline = false) {
    const writes: string[] = [];
    const deps = await this.cursor();
    const [last] = await this.db.select<{ clock: number }>(
      'SELECT coalesce(max(clock),0) AS clock FROM ic_catalog_ops WHERE vault=?',
      [this.vault],
    );
    let hlc = Math.max(Date.now() * 1024, last!.clock + 1);
    const known = baseline
      ? new Set(
          (
            await this.db.select<{ entity: string }>(
              'SELECT entity FROM ic_catalog WHERE vault=?',
              [this.vault],
            )
          ).map((r) => r.entity),
        )
      : undefined;
    for (const { current, previous } of changes) {
      if (known?.has(current.hash)) continue;
      if (
        current.glossaCloud ||
        current.duplicateOf ||
        !hash.safeParse(current.contentFingerprint).success
      )
        continue;
      const state = await this.state(current.hash, current.contentFingerprint!);
      if (baseline && Object.keys(state.fields).length) continue;
      const old = previous && Object.keys(state.fields).length ? previous : undefined;
      const patch: Record<string, unknown> = {};
      for (const key of keys) {
        if (key === 'icloudAsset' && current.icloudAsset?.vault !== this.vault) continue;
        let member = current.icloudGroup;
        if (key === 'icloudGroup') {
          const context = useSettingsStore.getState().settings?.icloudFolders;
          const id =
            current.groupName &&
            ((context?.vault === this.vault && context.paths[current.groupName]) ||
              (member?.vault === this.vault &&
                (!previous ||
                  previous.groupName === current.groupName ||
                  previous.icloudGroup?.id !== member.id) &&
                member.id) ||
              md5Fingerprint(current.groupName));
          member = id ? { vault: this.vault, id } : null;
        }
        const value =
          key === 'icloudGroup'
            ? (member ?? null)
            : key === 'removal' && current.removal
              ? fields.shape.removal.parse({ ...current.removal, cloud: 'none' })
              : (current[key] ?? null);
        if (value === null && !state.fields[key]) continue;
        if (old && JSON.stringify(value) === JSON.stringify(old[key] ?? null)) continue;
        if (JSON.stringify(value) !== JSON.stringify(state.fields[key]?.value)) patch[key] = value;
      }
      if (!Object.keys(patch).length) continue;
      const op = record.parse({
        schema_version: 2,
        vault_id: this.vault,
        actor_id: this.actor,
        seq: (deps[this.actor] ?? 0) + 1,
        op_id: crypto.randomUUID(),
        hlc: hlc++,
        entity_id: current.hash,
        fingerprint: current.contentFingerprint,
        patch,
        deps: { ...deps },
      });
      deps[this.actor] = op.seq;
      writes.push(...this.write(op, state, false));
    }
    return writes;
  }
  async importLegacy(book: Book) {
    if (
      !hash.safeParse(book.contentFingerprint).success ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(book.hash)
    )
      return false;
    const [last] = await this.db.select<{ body: string }>(
      'SELECT body FROM ic_legacy_catalog WHERE vault=? AND entity=?',
      [this.vault, book.hash],
    );
    const input = JSON.stringify(book);
    if (last?.body === input) return true;
    const previous = last ? (JSON.parse(last.body) as Book) : undefined;
    if (previous && previous.contentFingerprint !== book.contentFingerprint) return false;
    const state = await this.state(book.hash, book.contentFingerprint!);
    const observed = { ...book };
    for (const key of keys) {
      // An older client edits a whole JSON record. Only adopt a changed field if the
      // new library still has its observed value. The source row remains recoverable.
      const current = state.fields[key];
      if (
        current &&
        (!previous || JSON.stringify(current.value) !== JSON.stringify(previous[key] ?? null))
      )
        Object.assign(observed, { [key]: current.value });
    }
    const writes = await this.stage([{ current: observed, previous }]);
    writes.push(
      'INSERT OR REPLACE INTO ic_legacy_catalog VALUES(' +
        [this.vault, book.hash, input].map(sql).join(',') +
        ')',
    );
    await this.db.batch(writes);
    return true;
  }
  async receive(raw: string) {
    const op = record.parse(JSON.parse(raw));
    if (op.vault_id !== this.vault) throw new Error('Invalid catalog identity');
    const [prior] = await this.db.select<{ body: string }>(
      'SELECT body FROM ic_catalog_ops WHERE vault=? AND actor=? AND seq=?',
      [this.vault, op.actor_id, op.seq],
    );
    if (prior) {
      if (prior.body !== JSON.stringify(op)) throw new Error('Conflicting catalog segment');
      return true;
    }
    const cursor = await this.cursor();
    if (
      (cursor[op.actor_id] ?? 0) + 1 !== op.seq ||
      Object.entries(op.deps).some(([actor, n]) => (cursor[actor] ?? 0) < n)
    )
      return false;
    await this.db.batch(this.write(op, await this.state(op.entity_id, op.fingerprint), true));
    return true;
  }
  async removalSegment(book: Book) {
    const state = await this.state(book.hash, book.contentFingerprint!);
    const version = state.fields.removal;
    return version && (version.value as Book['removal'])?.id === book.removal?.id
      ? { actor: version.actor, seq: version.seq }
      : undefined;
  }
  async books(): Promise<Book[]> {
    const rows = await this.db.select<{ entity: string; state: string }>(
      'SELECT entity,state FROM ic_catalog WHERE vault=?',
      [this.vault],
    );
    return rows.map((r) => {
      const state = JSON.parse(r.state) as State;
      const props = Object.fromEntries(Object.entries(state.fields).map(([k, v]) => [k, v.value]));
      if (
        typeof props['title'] !== 'string' ||
        typeof props['author'] !== 'string' ||
        !props['format']
      )
        throw new Error('Incomplete iCloud catalog record');
      const stamp = (...names: Key[]) =>
        Math.floor(Math.max(0, ...names.map((k) => state.fields[k]?.clock ?? 0)) / 1024);
      const member = state.fields.icloudGroup?.value as Book['icloudGroup'];
      const context = useSettingsStore.getState().settings?.icloudFolders;
      if (member?.vault === this.vault && context?.vault === this.vault) {
        const path = Object.entries(context.paths).find(([, id]) => id === member.id)?.[0];
        if (path) {
          props['groupName'] = path;
          props['groupId'] = md5Fingerprint(path);
        }
      }
      return {
        ...props,
        metadataUpdatedAt: stamp('title', 'author', 'tags', 'primaryLanguage'),
        groupUpdatedAt: stamp('groupId', 'groupName'),
        readingStatusUpdatedAt: stamp('readingStatus'),
        hash: r.entity,
        contentFingerprint: state.fingerprint,
        updatedAt: Math.floor(Math.max(...Object.values(state.fields).map((f) => f.clock)) / 1024),
      } as Book;
    });
  }
  async pending() {
    return (
      await this.db.select<{ body: string }>(
        'SELECT body FROM ic_catalog_ops WHERE vault=? AND published=0 ORDER BY seq LIMIT 128',
        [this.vault],
      )
    ).map((r) => r.body);
  }
  async published(id: string) {
    await this.db.execute(
      'UPDATE ic_catalog_ops SET published=1 WHERE vault=? AND id=? AND actor=?',
      [this.vault, id, this.actor],
    );
  }
}
