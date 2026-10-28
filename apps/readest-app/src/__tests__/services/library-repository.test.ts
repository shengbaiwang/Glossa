import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { getLibraryFilename, getLocalBookFilename } from '@/utils/book';
import { registerBookDownload } from '@/services/bookDownloadIdentity';
import { fingerprintFile } from '@/services/bookIdentity';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import {
  inheritLibraryDatabase,
  isLibraryDatabaseRegistered,
  LIBRARY_DATABASE_FILENAME,
  loadLibraryRows,
  registerLibraryDatabase,
  writeLibraryRows,
} from '@/services/libraryRepository';
import { saveLibraryBooks } from '@/services/libraryService';

const TABLE = 'glossa_library_entries';
const temporaryRoots: string[] = [];
const opened = new Set<NodeDatabaseService>();
const book = (hash: string, overrides: Partial<Book> = {}): Book => ({
  hash,
  title: hash,
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

async function open(path: string) {
  const db = await NodeDatabaseService.open(path);
  opened.add(db);
  return db;
}

async function close(db: NodeDatabaseService) {
  opened.delete(db);
  await db.close();
}

async function fixture(initial?: Book[]) {
  let root = await mkdtemp(join(tmpdir(), 'glossa-library-'));
  temporaryRoots.push(root);
  const fs = {
    getPrefix: async () => root,
    exists: async (name: string, base: string) =>
      access(base === 'None' ? name : join(root, name)).then(
        () => true,
        () => false,
      ),
    readFile: async (name: string, base: string) =>
      readFile(base === 'None' ? name : join(root, name), 'utf8'),
    writeFile: vi.fn(async (name: string, _base: unknown, text: string) => {
      await writeFile(join(root, name), text);
    }),
  } as unknown as FileSystem;
  if (initial) await writeFile(join(root, getLibraryFilename()), JSON.stringify(initial));
  let db: NodeDatabaseService | undefined;
  const connect = async (prefix = root) => {
    db = await open(join(prefix, LIBRARY_DATABASE_FILENAME));
    return db;
  };
  registerLibraryDatabase(fs, connect);
  return {
    fs,
    root: () => root,
    db: () => db!,
    connect,
    useRoot: (path: string) => {
      root = path;
    },
    switchRoot: async () => {
      root = await mkdtemp(join(tmpdir(), 'glossa-library-'));
      temporaryRoots.push(root);
    },
  };
}

afterEach(async () => {
  await Promise.all([...opened].map(close));
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('library repository with a real disk database', () => {
  it('migrates stable identities and historical duplicates once, leaving source and sidecars intact', async () => {
    const identity = `sha256:${'a'.repeat(64)}`;
    const legacy = [
      book('legacy-one', {
        contentFingerprint: identity,
        title: 'Personal title',
        groupId: 'group',
        progress: [7, 10],
      }),
      book('legacy-two', {
        contentFingerprint: identity,
        duplicateOf: 'legacy-one',
        duplicateUpdatedAt: 7,
      }),
    ];
    const f = await fixture(legacy);
    await mkdir(join(f.root(), 'legacy-one'));
    await writeFile(join(f.root(), 'legacy-one', 'config.json'), '{"notes":["keep"]}');
    expect(await loadLibraryRows(f.fs)).toEqual(legacy);
    expect(await readFile(join(f.root(), getLibraryFilename()), 'utf8')).toBe(
      JSON.stringify(legacy),
    );
    expect(f.fs.writeFile).not.toHaveBeenCalled();
    const changed = {
      ...legacy[0]!,
      title: "Bound value: '; DROP TABLE ignored; --",
      updatedAt: 9,
    };
    await writeLibraryRows(f.fs, [changed, legacy[1]!]);
    await close(f.db());
    await writeFile(join(f.root(), getLibraryFilename()), '[]');
    const restarted = { ...f.fs };
    registerLibraryDatabase(restarted, f.connect);
    expect(await loadLibraryRows(restarted)).toEqual([changed, legacy[1]]);
    expect(await readFile(join(f.root(), 'legacy-one', 'config.json'), 'utf8')).toBe(
      '{"notes":["keep"]}',
    );
  });

  it('binds only changed rows and leaves legacy JSON read-only after migration', async () => {
    const initial = Array.from({ length: 80 }, (_, i) => book(`book-${i}`));
    const f = await fixture(initial);
    await loadLibraryRows(f.fs);
    const execute = vi.spyOn(f.db(), 'execute');
    const updated = { ...initial[17]!, title: 'Renamed', metadataUpdatedAt: 2 };
    await saveLibraryBooks(f.fs, [updated]);
    const writes = execute.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(writes).toHaveLength(1);
    const entries = JSON.parse(writes[0]![1]![0] as string);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('book:book-17');
    expect(writes[0]![0]).not.toContain('Renamed');
    expect(await loadLibraryRows(f.fs)).toHaveLength(80);
    expect(await readFile(join(f.root(), getLibraryFilename()), 'utf8')).toBe(
      JSON.stringify(initial),
    );
    expect(f.fs.writeFile).not.toHaveBeenCalled();
  });

  it('does not mark or partially publish a failed migration and safely retries', async () => {
    const legacy = [book('first'), book('reject')];
    const f = await fixture(legacy);
    const seed = await f.connect();
    await seed.execute(
      `CREATE TABLE ${TABLE} (key TEXT PRIMARY KEY CHECK (key != 'book:reject'), payload TEXT, fingerprint TEXT)`,
    );
    await close(seed);
    await expect(loadLibraryRows(f.fs)).rejects.toThrow();
    // The failing connection was closed by the repository; inspect through a new one.
    opened.delete(f.db());
    const check = await f.connect();
    expect(await check.select(`SELECT * FROM ${TABLE}`)).toEqual([]);
    await check.execute(`DROP TABLE ${TABLE}`);
    await close(check);
    expect(await loadLibraryRows(f.fs)).toEqual(legacy);
    expect(await readFile(join(f.root(), getLibraryFilename()), 'utf8')).toBe(
      JSON.stringify(legacy),
    );
  });

  it('rolls back every row when a later row in a commit fails', async () => {
    const f = await fixture([]);
    const seed = await f.connect();
    await seed.execute(
      `CREATE TABLE ${TABLE} (key TEXT PRIMARY KEY CHECK (key != 'book:reject'), payload TEXT, fingerprint TEXT)`,
    );
    await close(seed);
    await loadLibraryRows(f.fs);
    await expect(writeLibraryRows(f.fs, [book('first'), book('reject')])).rejects.toThrow();
    expect(await loadLibraryRows(f.fs)).toEqual([]);
    expect(await f.db().select(`SELECT key FROM ${TABLE}`)).toEqual([{ key: 'meta:version' }]);
    await writeLibraryRows(f.fs, [book('first')]);
    expect(await loadLibraryRows(f.fs)).toEqual([book('first')]);
  });

  it('never falls back to the stale JSON snapshot after database failure', async () => {
    const f = await fixture([book('legacy')]);
    await loadLibraryRows(f.fs);
    await writeLibraryRows(f.fs, [book('current')]);
    vi.spyOn(f.db(), 'select').mockRejectedValue(new Error('database unavailable'));
    await expect(loadLibraryRows(f.fs)).rejects.toThrow('database unavailable');
    await expect(saveLibraryBooks(f.fs, [book('late')])).rejects.toThrow('database unavailable');
    expect(await readFile(join(f.root(), getLibraryFilename()), 'utf8')).toBe(
      JSON.stringify([book('legacy')]),
    );
  });

  it('uses a valid backup for migration but refuses two invalid snapshots', async () => {
    const f = await fixture();
    await writeFile(join(f.root(), getLibraryFilename()), '{broken');
    await writeFile(
      join(f.root(), `${getLibraryFilename()}.bak`),
      JSON.stringify([book('backup')]),
    );
    expect(await loadLibraryRows(f.fs)).toEqual([book('backup')]);
    expect(await readFile(join(f.root(), getLibraryFilename()), 'utf8')).toBe('{broken');
    const invalid = await fixture();
    await writeFile(join(invalid.root(), getLibraryFilename()), '{}');
    await writeFile(join(invalid.root(), `${getLibraryFilename()}.bak`), '{}');
    await expect(loadLibraryRows(invalid.fs)).rejects.toThrow('no valid library snapshot');
    opened.delete(invalid.db());
  });

  it('refuses duplicate storage IDs rather than losing one personal record during migration', async () => {
    const f = await fixture([book('same'), book('same', { title: 'Other personal record' })]);
    await expect(loadLibraryRows(f.fs)).rejects.toThrow('no valid library snapshot');
    opened.delete(f.db());
  });

  it('uses the current root and explicitly inherited IO adapters', async () => {
    const f = await fixture([book('first-root')]);
    expect(await loadLibraryRows(f.fs)).toEqual([book('first-root')]);
    const oldRoot = f.root();
    await f.switchRoot();
    expect(await loadLibraryRows(f.fs)).toEqual([]);
    await writeLibraryRows(f.fs, [book('second-root')]);
    const adapter = { ...f.fs };
    expect(isLibraryDatabaseRegistered(adapter)).toBe(false);
    const connect = vi.fn(f.connect);
    registerLibraryDatabase(f.fs, connect);
    inheritLibraryDatabase(f.fs, adapter);
    expect(isLibraryDatabaseRegistered(adapter)).toBe(true);
    expect(await loadLibraryRows(adapter)).toEqual([book('second-root')]);
    expect(connect).not.toHaveBeenCalled();
    expect(await readFile(join(oldRoot, getLibraryFilename()), 'utf8')).toBe(
      JSON.stringify([book('first-root')]),
    );
  });

  it('binds database and migration snapshots to the sampled root during a directory switch', async () => {
    const original = book('original-root');
    const other = book('other-root');
    const f = await fixture([original]);
    const originalRoot = f.root();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const opening = new Promise<void>((resolve) => {
      started = resolve;
    });
    let first = true;
    const connect = vi.fn(async (prefix: string) => {
      if (first) {
        first = false;
        started();
        await gate;
      }
      return f.connect(prefix);
    });
    registerLibraryDatabase(f.fs, connect);
    const pending = loadLibraryRows(f.fs);
    await opening;
    await f.switchRoot();
    const otherRoot = f.root();
    await writeFile(join(otherRoot, getLibraryFilename()), JSON.stringify([other]));
    release();
    await expect(pending).rejects.toThrow('Library directory changed');
    expect(connect).toHaveBeenNthCalledWith(1, originalRoot);
    expect(await loadLibraryRows(f.fs)).toEqual([other]);
    expect(connect).toHaveBeenNthCalledWith(2, otherRoot);
    f.useRoot(originalRoot);
    expect(await loadLibraryRows(f.fs)).toEqual([original]);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent windows and preserves independently newer personal fields', async () => {
    const current = book('personal', {
      title: 'My title',
      author: 'My author',
      tags: ['my-tag'],
      metadataUpdatedAt: 20,
      updatedAt: 30,
      progress: [8, 10],
      groupId: 'mine',
      groupName: 'My group',
      readingStatus: 'finished',
      readingStatusUpdatedAt: 22,
      coverHash: 'my-cover',
      coverUpdatedAt: 23,
      duplicateOf: 'original',
      duplicateUpdatedAt: 24,
      deletedAt: 25,
      removal: {
        version: 1,
        id: 'remove',
        revision: 25,
        requestedAt: 25,
        mode: 'trash',
        local: 'complete',
        cloud: 'none',
      },
    });
    const f = await fixture([current]);
    const peer = { ...f.fs };
    registerLibraryDatabase(peer, f.connect);
    await Promise.all([
      saveLibraryBooks(f.fs, [
        book('personal', { updatedAt: 2, title: 'Stale', progress: [1, 10] }),
        book('added-one'),
      ]),
      saveLibraryBooks(peer, [book('added-two')]),
    ]);
    const rows = await loadLibraryRows(f.fs);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.hash === 'personal')).toEqual(current);
  });

  it('applies newer metadata separately from newer reading progress', async () => {
    const f = await fixture([
      book('personal', {
        updatedAt: 30,
        progress: [8, 10],
        title: 'Original',
        metadataUpdatedAt: 2,
      }),
    ]);
    await saveLibraryBooks(f.fs, [
      book('personal', {
        updatedAt: 4,
        progress: [1, 10],
        title: 'Renamed',
        metadataUpdatedAt: 40,
      }),
    ]);
    expect((await loadLibraryRows(f.fs))[0]).toMatchObject({
      title: 'Renamed',
      metadataUpdatedAt: 40,
      progress: [8, 10],
      updatedAt: 30,
    });
    await saveLibraryBooks(f.fs, [
      book('personal', { updatedAt: 50, progress: [9, 10], title: 'Stale', metadataUpdatedAt: 2 }),
    ]);
    expect((await loadLibraryRows(f.fs))[0]).toMatchObject({
      title: 'Renamed',
      metadataUpdatedAt: 40,
      progress: [9, 10],
      updatedAt: 50,
    });
  });

  it('keeps persisted metadata when a legacy window has tied or missing clocks', async () => {
    const current = book('personal', { updatedAt: 30, title: 'Latest title', tags: ['mine'] });
    const f = await fixture([current]);
    await saveLibraryBooks(f.fs, [book('personal', { updatedAt: 30, title: 'Old title' })]);
    expect((await loadLibraryRows(f.fs))[0]).toMatchObject({
      title: 'Latest title',
      tags: ['mine'],
    });
    // A deliberate edit carries a newer metadata clock even when the reader
    // has an older progress snapshot.
    await saveLibraryBooks(f.fs, [
      book('personal', { updatedAt: 2, title: 'Explicit rename', metadataUpdatedAt: 40 }),
    ]);
    expect((await loadLibraryRows(f.fs))[0]).toMatchObject({
      title: 'Explicit rename',
      metadataUpdatedAt: 40,
      updatedAt: 30,
    });
  });

  it('keeps an explicit group move while an old reader saves newer progress', async () => {
    const f = await fixture([
      book('personal', { groupId: 'new', groupName: 'New', groupUpdatedAt: 20, updatedAt: 20 }),
    ]);
    await saveLibraryBooks(f.fs, [
      book('personal', { groupId: 'old', groupName: 'Old', updatedAt: 30, progress: [8, 10] }),
    ]);
    expect((await loadLibraryRows(f.fs))[0]).toMatchObject({
      groupId: 'new',
      groupName: 'New',
      groupUpdatedAt: 20,
      updatedAt: 30,
      progress: [8, 10],
    });
    await saveLibraryBooks(f.fs, [book('personal', { groupUpdatedAt: 40, updatedAt: 25 })]);
    const ungrouped = (await loadLibraryRows(f.fs))[0]!;
    expect(ungrouped.groupId).toBeUndefined();
    expect(ungrouped.groupName).toBeUndefined();
    expect(ungrouped.groupUpdatedAt).toBe(40);
    expect(ungrouped.progress).toEqual([8, 10]);
  });

  it('publishes the preserved personal fields when a cloud download completes', async () => {
    const file = new File(['original download fixture'], 'file.epub');
    const fingerprint = await fingerprintFile(file);
    const current = book('download', {
      sourceTitle: 'file',
      title: 'Personal title',
      metadataUpdatedAt: 20,
      groupId: 'new-group',
      groupUpdatedAt: 21,
      contentFingerprint: fingerprint,
    });
    const f = await fixture([current]);
    await mkdir(join(f.root(), current.hash));
    await writeFile(
      join(f.root(), getLocalBookFilename(current)),
      new Uint8Array(await file.arrayBuffer()),
    );
    f.fs.openFile = async (path) => new File([await readFile(join(f.root(), path))], path);
    const stale = {
      ...current,
      title: 'Old title',
      metadataUpdatedAt: 1,
      groupId: 'old-group',
      groupUpdatedAt: 1,
      updatedAt: 30,
      progress: [8, 10] as [number, number],
    };
    const result = await registerBookDownload(f.fs, stale, [stale]);
    expect(result.book).toMatchObject({
      title: 'Personal title',
      metadataUpdatedAt: 20,
      groupId: 'new-group',
      groupUpdatedAt: 21,
      progress: [8, 10],
      updatedAt: 30,
    });
    expect((await loadLibraryRows(f.fs))[0]).toMatchObject({
      title: 'Personal title',
      groupId: 'new-group',
      progress: [8, 10],
    });
  });
});
