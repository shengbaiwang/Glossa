import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BookConfig } from '@/types/book';
import { exchangeSegments } from '@/services/sync/providers/icloud/exchangeSegments';
import { selectVault } from '@/services/sync/providers/icloud/vault';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { expect, it } from 'vitest';
import type { DatabaseService } from '@/types/database';
import { NoteJournal } from '@/services/sync/providers/icloud/noteJournal';
import type { Book, BookNote } from '@/types/book';

function database(db = new DatabaseSync(':memory:')) {
  const store = {
    execute: async (s: string, p: string[] = []) => ({
      rowsAffected: Number(db.prepare(s).run(...p).changes),
    }),
    select: async (s: string, p: string[] = []) => db.prepare(s).all(...p),
    batch: async (sql: string[]) => {
      db.exec('BEGIN');
      try {
        for (const s of sql) db.exec(s);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as DatabaseService;
  return store;
}
function replica(db?: DatabaseSync) {
  return new NoteJournal(database(db), vault, 'book', fingerprint);
}
const vault = '01234567-0000-4000-8000-000000000001';
const fingerprint = 'sha256:' + '1'.repeat(64);
const note: BookNote = {
  id: 'n',
  type: 'annotation',
  cfi: 'epubcfi(/6/2)',
  note: '原始',
  createdAt: 1,
  updatedAt: 1,
};
it('keeps concurrent offline versions, replays idempotently and resolves both parents', async () => {
  const a = replica(),
    b = replica();
  await a.init();
  await b.init();
  await a.save([{ ...note }]);
  const seed = (await a.pending())[0]!;
  await b.receive(seed);
  const [left] = await a.notes(),
    [right] = await b.notes();
  await a.save([{ ...left!, note: 'Mac', updatedAt: 2 }]);
  await b.save([{ ...right!, note: 'iPhone', updatedAt: 3 }]);
  const edits = await a.pending(),
    other = (await b.pending())[0]!;
  await a.receive(other);
  await a.receive(other);
  await b.receive(edits[1]!);
  const [merged] = await a.notes();
  expect(await b.notes()).toEqual([merged]);
  expect(merged!.icloudEdit?.bodies.map((x) => x.text).sort()).toEqual(['Mac', 'iPhone']);
  await a.save([{ ...merged!, note: '合并', updatedAt: 4 }]);
  await b.receive((await a.pending())[2]!);
  expect((await b.notes())[0]!.icloudEdit?.bodies.map((x) => x.text)).toEqual(['合并']);
});

it('reopens the committed queue after process storage closes and rolls back a failed projection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'glossa-note-'));
  try {
    const path = join(root, 'local.db');
    const first = new DatabaseSync(path);
    const a = replica(first);
    await a.init();
    await a.save([{ ...note }]);
    const original = await a.pending();
    first.close();
    const next = new DatabaseSync(path);
    try {
      const b = replica(next);
      await b.init();
      expect(await b.pending()).toEqual(original);
      next.exec(
        "CREATE TRIGGER fail BEFORE INSERT ON annotations BEGIN SELECT RAISE(ABORT,'disk failure'); END",
      );
      await expect(b.save([{ ...(await b.notes())[0]!, note: 'draft' }])).rejects.toThrow(
        'disk failure',
      );
      expect(await b.pending()).toEqual(original);
      expect((await b.notes())[0]!.note).toBe(note.note);
      expect(await b.eventsAfter(0)).toHaveLength(1);
    } finally {
      next.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('retains the tombstone and concurrent text; a restore explicitly observes the deletion', async () => {
  const a = replica(),
    b = replica();
  await a.init();
  await b.init();
  await a.save([{ ...note }]);
  await b.receive((await a.pending())[0]!);
  await a.save([{ ...(await a.notes())[0]!, deletedAt: 50 }]);
  await b.save([{ ...(await b.notes())[0]!, note: '保留' }]);
  await a.receive((await b.pending())[0]!);
  await b.receive((await a.pending())[1]!);
  expect(await a.notes()).toEqual(await b.notes());
  expect((await a.notes())[0]).toMatchObject({ note: '保留', deletedAt: 50 });
  await b.save([{ ...(await b.notes())[0]!, deletedAt: null }]);
  await a.receive((await b.pending())[1]!);
  expect((await a.notes())[0]!.deletedAt).toBeUndefined();
});
it('a stale window on the same device cannot supersede an unseen version', async () => {
  const a = replica();
  await a.init();
  await a.save([{ ...note }]);
  const [x] = await a.notes(),
    [y] = await a.notes();
  await a.save([{ ...x!, note: 'one' }]);
  const draft = { ...y!, note: 'two' };
  await a.save([draft]);
  draft.note = 'three';
  await a.save([draft]);
  const visible = (await a.notes())[0]!;
  expect(visible.icloudEdit!.bodies.map((v) => v.text).sort()).toEqual(['one', 'three']);
  visible.icloudEdit!.resolveBody = true;
  await a.save([visible]);
  expect((await a.notes())[0]!.icloudEdit!.bodies).toHaveLength(1);
});
it('imports a legacy edit once, preserving a concurrent local body and the original anchor', async () => {
  const a = replica();
  await a.init();
  await a.importLegacy([{ ...note }]);
  await a.save([{ ...(await a.notes())[0]!, note: 'new client' }]);
  const old = { ...note, note: 'legacy client' };
  await a.importLegacy([old]);
  await a.importLegacy([old]);
  expect(await a.pending()).toHaveLength(3);
  const merged = (await a.notes())[0]!;
  expect(merged.cfi).toBe(note.cfi);
  expect(merged.icloudEdit!.bodies.map((v) => v.text).sort()).toEqual([
    'legacy client',
    'new client',
  ]);
});
const page = (n: number, base?: BookConfig): BookConfig => ({
  ...base,
  updatedAt: n,
  location: 'page-' + n,
  progress: [n, 100],
});
it('retains divergent snapshots, backward turns, furthest point and delayed old epochs', async () => {
  const a = replica(),
    b = replica();
  await a.init();
  await b.init();
  const p = a.positions,
    q = b.positions;
  const seed = page(5);
  await p.save(seed, 'Mac');
  await q.receive((await p.pending())[0]!);
  await p.save(page(65, seed), 'Mac');
  await q.save(page(42, seed), 'iPhone');
  await p.receive((await q.pending())[0]!);
  await q.receive((await p.pending())[1]!);
  expect((await p.project(seed, 'PDF')).candidate?.page).toBe(42);
  expect((await q.project(seed, 'PDF')).candidate?.page).toBe(65);
  const own = (await p.project(seed, 'PDF')).config;
  await p.save(page(18, own), 'Mac');
  expect((await p.project(seed, 'PDF')).config.progress?.[0]).toBe(18);
  expect(await p.furthest()).toBe(6500);
  const restart = page(1, own);
  await p.save(restart, 'Mac', true);
  await q.save(page(90, (await q.project(seed, 'PDF')).config), 'iPhone');
  await p.receive((await q.pending())[1]!);
  expect((await p.project(seed, 'PDF')).config.progress?.[0]).toBe(1);
  expect(await p.furthest()).toBe(9000);
});
it('imports the same old reading position on two devices once and keeps late positions in the original epoch', async () => {
  const a = replica(),
    b = replica();
  await a.init();
  await b.init();
  const first = {
    schemaVersion: 1,
    writerVersion: 'readest-webdav-1',
    bookHash: 'book',
    writerDeviceId: 'old iPad',
    updatedAt: 800,
    config: { ...page(50), updatedAt: 100, xpointer: 'old-anchor' },
    booknotes: [],
  } as const;
  const legacy = { ...first, booknotes: [] };
  await a.positions.importLegacy(legacy);
  await b.positions.importLegacy(legacy);
  await a.positions.importLegacy({ ...legacy, updatedAt: 900 });
  const pending = await a.positions.pending();
  expect(pending).toHaveLength(1);
  expect(await b.positions.pending()).toEqual(pending);
  await b.positions.receive(pending[0]!);
  const migrated = (await b.positions.project(page(1), 'PDF')).config;
  expect(migrated.xpointer).toBe('old-anchor');
  expect(migrated.progress).toEqual([50, 100]);
  await a.positions.published(JSON.parse(pending[0]!).op_id);
  expect(await a.positions.pending()).toEqual([]);
  await b.positions.save(page(1, migrated), 'Mac', true);
  await b.positions.importLegacy({ ...legacy, config: { ...page(80), updatedAt: 400 } });
  expect((await b.positions.project(migrated, 'PDF')).config.progress).toEqual([1, 100]);
  expect(await b.positions.furthest()).toBe(8000);
});
it('waits at segment gaps and survives publication without a receipt', async () => {
  const a = replica(),
    b = replica();
  await a.init();
  await b.init();
  const files = new Map<string, string>(),
    dirs = new Set<string>();
  const provider = {
    head: async (p: string) => (dirs.has(p) ? {} : null),
    ensureDir: async (paths: string[]) => paths.forEach((p) => dirs.add(p)),
    readText: async (p: string) => files.get(p) ?? null,
    writeText: async (p: string, v: string) => {
      files.set(p, v);
    },
    list: async (p: string) =>
      [...files.keys(), ...dirs]
        .filter((k) => k.slice(0, k.lastIndexOf('/')) === p)
        .map((k) => ({ name: k.slice(p.length + 1), isDirectory: dirs.has(k) })),
  } as unknown as FileSyncProvider;
  const id = await selectVault(provider, true);
  expect(await selectVault(provider, false)).toBe(id);
  await a.save([{ ...note }]);
  await a.save([{ ...(await a.notes())[0]!, note: 'second' }]);
  const dir = '/GlossaSync-v2/' + id + '/test';
  const noReceipt = {
    pending: () => a.pending(),
    published: async () => {
      throw Error('terminated');
    },
    receive: (v: string) => a.receive(v),
    cursor: () => a.cursor(),
  };
  await expect(exchangeSegments(provider, dir, 'push', noReceipt, () => {})).rejects.toThrow(
    'terminated',
  );
  expect(await a.pending()).toHaveLength(2);
  await exchangeSegments(provider, dir, 'push', a, () => {});
  const [path, raw] = [...files.entries()][0]!;
  files.delete(path);
  await exchangeSegments(provider, dir, 'pull', b, () => {});
  expect(await b.cursor()).toEqual({});
  files.set(path, raw);
  await exchangeSegments(provider, dir, 'pull', b, () => {});
  await exchangeSegments(provider, dir, 'pull', b, () => {});
  expect(await a.notes()).toEqual(await b.notes());
  dirs.add('/GlossaSync-v2/00000000-0000-4000-8000-000000000002');
  await expect(selectVault(provider, false)).rejects.toThrow('Multiple');
});

it('keeps independent catalog changes in both arrival orders and rolls back an aborted shelf save', async () => {
  const { CatalogJournal } = await import('@/services/sync/providers/icloud/catalogJournal');
  const left = database(),
    right = database();
  const a = new CatalogJournal(left, vault),
    b = new CatalogJournal(right, vault);
  await a.init();
  await b.init();
  const book = {
    hash: 'original',
    title: '初版',
    author: '作者',
    format: 'EPUB',
    contentFingerprint: fingerprint,
    createdAt: 1,
    updatedAt: 1,
  } as Book;
  await left.batch(await a.stage([{ current: book }]));
  await b.receive((await a.pending())[0]!);
  const title = { ...book, title: '改名' },
    group = { ...book, groupName: '历史', groupId: 'g' };
  const draft = await a.stage([{ current: title, previous: book }]);
  await expect(left.batch([...draft, 'INSERT INTO missing_table VALUES (1)'])).rejects.toThrow();
  expect((await a.books())[0]!.title).toBe('初版');
  await left.batch(draft);
  await right.batch(await b.stage([{ current: group, previous: book }]));
  await a.receive((await b.pending())[0]!);
  await b.receive((await a.pending())[1]!);
  expect(await a.books()).toEqual(await b.books());
  expect((await a.books())[0]).toMatchObject({ title: '改名', groupName: '历史' });
});
it('counts a replicated fifteen-second interval once and rejects a conflicting interval ID', async () => {
  const { StatisticsDb } = await import('@/services/statistics/statisticsDb');
  const { getMigrations } = await import('@/services/database/migrations');
  const { migrate } = await import('@/services/database/migrate');
  const raw = database();
  await migrate(raw, getMigrations('statistics'));
  const db = StatisticsDb.from(raw);
  await db.initICloudDelivery();
  const row = { id: 'i', bookHash: 'book', sessionId: 's', startMs: 50, durationMs: 15000 };
  await db.acknowledgeInterval(vault, row, 'segment');
  await db.acknowledgeInterval(vault, row, 'segment');
  expect((await db.getBookReadingTime('book', 's')).bookMs).toBe(15000);
  await expect(
    db.acknowledgeInterval(vault, { ...row, durationMs: 30000 }, 'other'),
  ).rejects.toThrow('Conflicting');
});
it('verifies a sparse read, deduplicates chunks and gates release on system upload status', async () => {
  const { publishBlob, openVaultBlob, verifyUploadedBlob } = await import(
    '@/services/sync/providers/icloud/blob'
  );
  const { File: DiskFile } = await import('node:buffer');
  const { createHash } = await import('node:crypto');
  const chunk = new Uint8Array(2 * 1024 * 1024).fill(37),
    tail = Uint8Array.of(0, 9);
  const hash =
    'sha256:' + createHash('sha256').update(chunk).update(chunk).update(tail).digest('hex');
  const file = new DiskFile([chunk, chunk, tail], 'original') as unknown as File;
  const text = new Map<string, string>(),
    binary = new Map<string, ArrayBuffer>();
  let reads = 0,
    writes = 0,
    uploaded = false;
  const p = {
    vaultId: vault,
    ensureDir: async () => {},
    readText: async (k: string) => text.get(k) ?? null,
    writeText: async (k: string, v: string) => text.set(k, v),
    readBinary: async (k: string) => {
      reads++;
      return binary.get(k) ?? null;
    },
    writeBinary: async (k: string, v: ArrayBuffer) => {
      writes++;
      binary.set(k, v);
    },
    uploadStatus: async () => (uploaded ? 'uploaded' : 'unconfirmed'),
  } as unknown as FileSyncProvider;
  const check = () => {};
  await expect(publishBlob(p, file, fingerprint, check)).rejects.toThrow('changed');
  expect(text.size).toBe(0);
  const asset = await publishBlob(p, file, hash, check);
  expect(await publishBlob(p, file, hash, check)).toEqual(asset);
  expect(writes).toBe(2);
  reads = 0;
  const opened = await openVaultBlob(p, asset, 'sample', 'application/pdf', check);
  expect(new Uint8Array(await opened.slice(-2).arrayBuffer())).toEqual(tail);
  expect(reads).toBe(1);
  await opened.close();
  await expect(verifyUploadedBlob(p, asset, check)).rejects.toThrow('confirm');
  uploaded = true;
  expect(await verifyUploadedBlob(p, asset, check)).toBe(hash);
  binary.set([...binary.keys()][0]!, tail.buffer);
  await expect(verifyUploadedBlob(p, asset, check)).rejects.toThrow('verify');
});

it('shares font choice while preserving phone type size and resetting a book override', async () => {
  const { TypographyJournal } = await import('@/services/sync/providers/icloud/typography');
  const left = database(),
    right = database();
  await left.batch([TypographyJournal.schema]);
  await right.batch([TypographyJournal.schema]);
  const a = new TypographyJournal(left, vault, 'book', crypto.randomUUID()),
    b = new TypographyJournal(right, vault, 'book', crypto.randomUUID());
  const first = await a.save({ defaultFont: 'Serif', defaultFontSize: 19 }, 'desktop');
  await b.save({ defaultFontSize: 23 }, 'phone');
  for (const raw of await a.pending()) await b.receive(raw);
  for (const raw of await b.pending()) await a.receive(raw);
  expect((await b.project({}, 'phone')).view).toMatchObject({
    defaultFont: 'Serif',
    defaultFontSize: 23,
  });
  expect((await a.project({}, 'desktop')).view.defaultFontSize).toBe(19);
  await a.save({ defaultFont: 'System', defaultFontSize: 19 }, 'desktop', first, {
    defaultFont: 'System',
  });
  for (const raw of await a.pending()) await b.receive(raw);
  expect((await b.project({}, 'phone', { defaultFont: 'Phone default' })).view.defaultFont).toBe(
    'Phone default',
  );
});
it('preserves empty groups and records the same rejected cycle on both replicas', async () => {
  const { GroupJournal } = await import('@/services/sync/providers/icloud/groups');
  const left = database(),
    right = database();
  await left.batch([GroupJournal.schema]);
  await right.batch([GroupJournal.schema]);
  const a = new GroupJournal(left, vault, crypto.randomUUID()),
    b = new GroupJournal(right, vault, crypto.randomUUID());
  const base = await a.save(['A', 'B', 'Empty']);
  await b.receive((await a.pending())[0]!);
  await a.save(['B', 'B/A', 'Empty'], base, new Map([['A', 'B/A']]));
  await b.save(['A', 'A/B', 'Empty'], base, new Map([['B', 'A/B']]));
  await a.receive((await b.pending())[0]!);
  await b.receive((await a.pending())[1]!);
  const groups = await a.project();
  expect(groups).toEqual(await b.project());
  expect(groups.order).toContain('Empty');
  expect(groups.order).toHaveLength(3);
  expect(groups.rejected).toHaveLength(1);
});

it('re-imports old catalog edits without losing a subsequent local title', async () => {
  const { CatalogJournal } = await import('@/services/sync/providers/icloud/catalogJournal');
  const db = database(),
    log = new CatalogJournal(db, vault);
  await log.init();
  const book = {
    hash: 'legacy',
    title: 'Old',
    author: 'A',
    format: 'EPUB',
    contentFingerprint: fingerprint,
  } as Book;
  expect(await log.importLegacy({ ...book, contentFingerprint: undefined })).toBe(false);
  expect(await log.importLegacy(book)).toBe(true);
  await db.batch(
    await log.stage([{ current: { ...book, title: 'Local note title' }, previous: book }]),
  );
  const newer = { ...book, title: 'Another old client title', author: 'B' };
  await log.importLegacy(newer);
  await log.importLegacy(newer);
  expect((await log.books())[0]).toMatchObject({ title: 'Local note title', author: 'B' });
  expect(await log.pending()).toHaveLength(3);
});

it('keeps local deletion receipts and projects a remote purge as recoverable trash', async () => {
  const { projectVaultBook } = await import('@/services/sync/providers/icloud/catalogJournal');
  const book = {
    hash: 'shelf',
    format: 'PDF',
    title: 'T',
    author: 'A',
    updatedAt: 1,
    createdAt: 1,
    contentFingerprint: fingerprint,
  } as Book;
  const removal = {
    version: 1,
    id: 'remove',
    revision: 5,
    requestedAt: 5,
    mode: 'purge',
    local: 'complete',
    cloud: 'none',
  } as const;
  const remote = { ...book, deletedAt: 5, removal };
  expect(projectVaultBook(book, remote).removal?.mode).toBe('trash');
  const own = {
    ...remote,
    removal: {
      ...removal,
      cloud: 'pending' as const,
      cloudTargets: { icloud: 'pending' as const },
    },
  };
  expect(projectVaultBook(own, remote).removal).toEqual(own.removal);
});
