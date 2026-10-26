import { describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { RemoteLibraryIndex } from '@/services/sync/file/wire';

/**
 * #4860: WebDAV deletions must propagate. Three behaviours are exercised here:
 *   1. a peer's tombstone deletes the book locally (edit-wins-over-delete guard),
 *   2. the deleted book's remote hash directory is GC'd off the server,
 *   3. a tombstone for a book this device never had survives the index re-push
 *      (otherwise the deletion would silently vanish from library.json).
 */

const makeBook = (hash: string, overrides: Partial<Book> = {}): Book => ({
  hash,
  format: 'EPUB',
  title: `Book ${hash}`,
  sourceTitle: `Book ${hash}`,
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

type Captured = { writes: { path: string; body: string }[]; deletedDirs: string[] };

const fakeProvider = (
  opts: Partial<FileSyncProvider> & { captured?: Captured } = {},
): FileSyncProvider => ({
  rootPath: '/',
  readText: opts.readText ?? (async () => null),
  readBinary: opts.readBinary ?? (async () => null),
  head: opts.head ?? (async () => null),
  list: opts.list ?? (async () => []),
  writeText:
    opts.writeText ??
    (async (path: string, body: string) => {
      opts.captured?.writes.push({ path, body });
    }),
  writeBinary: opts.writeBinary ?? (async () => {}),
  ensureDir: opts.ensureDir ?? (async () => {}),
  deleteDir:
    opts.deleteDir ??
    (async (path: string) => {
      opts.captured?.deletedDirs.push(path);
    }),
  uploadStream: opts.uploadStream,
  downloadStream: opts.downloadStream,
});

const fakeStore = (opts: Partial<LocalStore> = {}): LocalStore => ({
  withBookFileWrite: opts.withBookFileWrite,
  acknowledgeRemoval: opts.acknowledgeRemoval,
  withCurrentRemoval: opts.withCurrentRemoval,
  getCurrentBook: opts.getCurrentBook,
  loadConfig: opts.loadConfig ?? (async () => null),
  saveBookConfig: opts.saveBookConfig ?? (async () => {}),
  loadBookFile: opts.loadBookFile ?? (async () => null),
  resolveLocalBookPath: opts.resolveLocalBookPath ?? (async () => null),
  saveBookFile: opts.saveBookFile ?? (async () => {}),
  prepareLocalBookPath: opts.prepareLocalBookPath ?? (async () => '/local/dst'),
  loadBookCover: opts.loadBookCover ?? (async () => null),
  saveBookCover: opts.saveBookCover ?? (async () => {}),
  addBookToLibrary: opts.addBookToLibrary ?? (async () => {}),
  updateBookMetadata: opts.updateBookMetadata ?? (async () => {}),
  deleteBookLocally: opts.deleteBookLocally ?? (async () => {}),
  markBooksUploaded: opts.markBooksUploaded ?? (async () => {}),
});

const makeIndex = (books: Book[]): RemoteLibraryIndex => ({
  schemaVersion: 1,
  updatedAt: 1,
  books,
});

const libraryWrite = (captured: Captured) =>
  captured.writes.find((w) => w.path.endsWith('library.json'));

describe('download recovery selects the verified book directory', () => {
  test('ignores unrelated sidecars and chooses the same deterministic book file as clearing verification', async () => {
    const readBinary = vi.fn(async (_path: string) => new ArrayBuffer(1));
    const provider = fakeProvider({
      readBinary,
      list: async () => [
        { name: 'readme.txt', path: '/Readest/books/h1/readme.txt', isDirectory: false },
        { name: 'z.epub', path: '/Readest/books/h1/z.epub', isDirectory: false },
        { name: 'a.epub', path: '/Readest/books/h1/a.epub', isDirectory: false },
      ],
    });
    await new FileSyncEngine(provider, fakeStore()).downloadBookFile(makeBook('h1'));
    expect(readBinary.mock.calls[0]?.[0]).toBe('/Readest/books/h1/a.epub');
  });
  test('never follows a listed book outside its fixed hash directory', async () => {
    const readBinary = vi.fn();
    const provider = fakeProvider({
      readBinary,
      list: async () => [
        { name: 'a.epub', path: '/Readest/books/other/a.epub', isDirectory: false },
      ],
    });
    expect(await new FileSyncEngine(provider, fakeStore()).downloadBookFile(makeBook('h1'))).toBe(
      false,
    );
    expect(readBinary).not.toHaveBeenCalled();
  });
});

describe('FileSyncEngine.syncLibrary — deletion propagation (#4860)', () => {
  test('deletes a book locally when a peer tombstoned it', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100, deletedAt: 200 })]))
          : null,
      captured,
    });
    const deleteBookLocally = vi.fn<(b: Book) => Promise<void>>(async () => {});
    const store = fakeStore({ deleteBookLocally });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'd' },
    );

    expect(deleteBookLocally).toHaveBeenCalledTimes(1);
    expect(deleteBookLocally.mock.calls[0]![0].hash).toBe('h1');
    expect(deleteBookLocally.mock.calls[0]![0].deletedAt).toBe(200);
    expect(res.booksDeleted).toBe(1);

    // The tombstone must be carried into the re-pushed index.
    const idx = libraryWrite(captured);
    expect(idx).toBeDefined();
    const parsed = JSON.parse(idx!.body) as RemoteLibraryIndex;
    const h1 = parsed.books.find((b) => b.hash === 'h1');
    expect(h1?.deletedAt).toBe(200);
  });

  test('does not re-push the config of a book it just peer-deleted', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100, deletedAt: 200 })]))
          : p.endsWith('config.json')
            ? JSON.stringify({ schemaVersion: 1, bookHash: 'h1', config: {}, booknotes: [] })
            : null,
      captured,
    });
    // The book file is still on disk after a 'local' delete removes the copy, so
    // loadConfig returns a real config — the push loop must still skip it.
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      loadBookFile: async () => ({ bytes: new ArrayBuffer(8), size: 8 }),
    });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'silent', syncBooks: true, deviceId: 'd' },
    );

    expect(res.booksDeleted).toBe(1);
    expect(res.configsUploaded).toBe(0);
    expect(res.filesUploaded).toBe(0);
    expect(captured.writes.filter((w) => w.path.endsWith('config.json'))).toHaveLength(0);
  });

  test('does not delete locally when the local copy was edited after the deletion', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 50, deletedAt: 100 })]))
          : null,
      captured,
    });
    const deleteBookLocally = vi.fn<(b: Book) => Promise<void>>(async () => {});
    const store = fakeStore({ deleteBookLocally });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      // Local edit (updatedAt 200) is newer than the remote deletion (100).
      [makeBook('h1', { updatedAt: 200 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'd' },
    );

    expect(deleteBookLocally).not.toHaveBeenCalled();
    expect(res.booksDeleted).toBe(0);
  });

  test('GCs the remote hash directory of a locally-deleted book', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async () => null, // fresh remote index
      list: async (path: string) =>
        path.endsWith('/books')
          ? [{ name: 'h1', path: '/Readest/books/h1', isDirectory: true }]
          : [],
      captured,
    });
    const store = fakeStore();

    await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, deletedAt: 100 })],
      { strategy: 'silent', syncBooks: true, deviceId: 'd' },
    );

    expect(captured.deletedDirs).toContain('/Readest/books/h1');
  });

  test('does not GC a hash dir that is no longer on the server', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async () => null,
      list: async () => [], // the books dir is empty — nothing to GC
      captured,
    });
    const store = fakeStore();

    await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, deletedAt: 100 })],
      { strategy: 'silent', syncBooks: true, deviceId: 'd' },
    );

    expect(captured.deletedDirs).toHaveLength(0);
  });

  test('preserves a remote tombstone for a book this device never had', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(
              makeIndex([
                makeBook('h1', { updatedAt: 100 }),
                makeBook('h2', { updatedAt: 100, deletedAt: 300 }),
              ]),
            )
          : null,
      captured,
    });
    const store = fakeStore();

    // Local library only has h1; it has never seen h2. h1 is locally newer so
    // the run is dirty and the index gets re-pushed — the union must carry
    // h2's tombstone even though this device never materialised the book.
    await new FileSyncEngine(provider, store).syncLibrary([makeBook('h1', { updatedAt: 200 })], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'd',
    });

    const idx = libraryWrite(captured);
    expect(idx).toBeDefined();
    const parsed = JSON.parse(idx!.body) as RemoteLibraryIndex;
    const h2 = parsed.books.find((b) => b.hash === 'h2');
    expect(h2?.deletedAt).toBe(300);
  });
});

const removal = (
  mode: 'trash' | 'restore' | 'purge',
  revision = 200,
): NonNullable<Book['removal']> => ({
  version: 1,
  id: `job-${revision}`,
  revision,
  requestedAt: revision,
  mode,
  local: 'complete',
  cloud: 'pending',
});

describe('recoverable removal sync', () => {
  test('preserves remote files for ordinary trash on the origin and the peer', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const remote = makeBook('h1', { updatedAt: 100, deletedAt: 200, removal: removal('trash') });
    const provider = fakeProvider({
      captured,
      readText: async (p) =>
        p.endsWith('library.json') ? JSON.stringify(makeIndex([remote])) : null,
      list: async (p) =>
        p.endsWith('/books') ? [{ name: 'h1', path: '/Readest/books/h1', isDirectory: true }] : [],
    });
    const store = fakeStore({ deleteBookLocally: vi.fn(async () => {}) });
    await new FileSyncEngine(provider, store).syncLibrary([makeBook('h1', { updatedAt: 100 })], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'd',
    });
    expect(captured.deletedDirs).toEqual([]);
    expect(store.deleteBookLocally).toHaveBeenCalledWith(
      expect.objectContaining({ removal: expect.objectContaining({ mode: 'trash' }) }),
    );
  });
  test('propagates explicit restore even when an unrelated page-turn clock is newer', async () => {
    const remote = makeBook('h1', {
      updatedAt: 100,
      deletedAt: null,
      removal: removal('restore', 300),
    });
    const updateBookMetadata = vi.fn(async () => {});
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json') ? JSON.stringify(makeIndex([remote])) : null,
    });
    await new FileSyncEngine(provider, fakeStore({ updateBookMetadata })).syncLibrary(
      [makeBook('h1', { updatedAt: 500, deletedAt: 200, removal: removal('trash') })],
      { strategy: 'silent', syncBooks: false, deviceId: 'd' },
    );
    expect(updateBookMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: null,
        removal: expect.objectContaining({ mode: 'restore' }),
        updatedAt: 500,
      }),
    );
  });
  test('preserves newer edits as a visible conflict and does not purge them silently', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const remote = makeBook('h1', { updatedAt: 100, deletedAt: 200, removal: removal('purge') });
    const deleteBookLocally = vi.fn(async () => {}),
      updateBookMetadata = vi.fn(async () => {});
    const provider = fakeProvider({
      captured,
      readText: async (p) =>
        p.endsWith('library.json') ? JSON.stringify(makeIndex([remote])) : null,
    });
    await new FileSyncEngine(
      provider,
      fakeStore({ deleteBookLocally, updateBookMetadata }),
    ).syncLibrary([makeBook('h1', { updatedAt: 500, title: 'New personal title' })], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'd',
    });
    expect(deleteBookLocally).not.toHaveBeenCalled();
    expect(updateBookMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New personal title',
        removal: expect.objectContaining({ conflict: true }),
      }),
    );
  });
});

describe('removal sync receipts and fresh-state guards', () => {
  test('guards a streaming download before opening a destination for a permanently deleted book', async () => {
    const downloadStream = vi.fn(async () => true),
      prepareLocalBookPath = vi.fn(async () => '/books/h1/Book.epub');
    const provider = fakeProvider({
      downloadStream,
      list: async () => [
        { name: 'Book.epub', path: '/Readest/books/h1/Book.epub', isDirectory: false },
      ],
    });
    const store = fakeStore({
      prepareLocalBookPath,
      withBookFileWrite: async () => {
        throw new Error('permanently deleted');
      },
    });
    await expect(
      new FileSyncEngine(provider, store).downloadBookFile(makeBook('h1')),
    ).rejects.toThrow('permanently deleted');
    expect(prepareLocalBookPath).not.toHaveBeenCalled();
    expect(downloadStream).not.toHaveBeenCalled();
  });
  test('reports remote cleanup failure and never marks cloud completion', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const acknowledgeRemoval = vi.fn(async () => {});
    const row = makeBook('h1', { deletedAt: 200, removal: removal('purge') });
    const provider = fakeProvider({
      captured,
      deleteDir: async () => {
        throw new Error('offline');
      },
    });
    const result = await new FileSyncEngine(
      provider,
      fakeStore({ acknowledgeRemoval }),
    ).syncLibrary([row], {
      strategy: 'send',
      syncBooks: false,
      deviceId: 'd',
      removalBackend: 'webdav',
    });
    expect(result.failedBooks).toContainEqual(
      expect.objectContaining({ hash: 'h1', phase: 'delete' }),
    );
    expect(acknowledgeRemoval).toHaveBeenCalledWith(
      expect.objectContaining({ hash: 'h1' }),
      'webdav',
      'failed',
    );
    expect(acknowledgeRemoval).not.toHaveBeenCalledWith(expect.anything(), 'webdav', 'complete');
  });
  test('does not GC when a newer persisted restore replaced the sync snapshot', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const row = makeBook('h1', { deletedAt: 200, removal: removal('purge') });
    const restored = makeBook('h1', { deletedAt: null, removal: removal('restore', 300) });
    const store = fakeStore({ getCurrentBook: async () => restored });
    await new FileSyncEngine(fakeProvider({ captured }), store).syncLibrary([row], {
      strategy: 'send',
      syncBooks: false,
      deviceId: 'd',
    });
    expect(captured.deletedDirs).toEqual([]);
    const index = JSON.parse(libraryWrite(captured)!.body) as RemoteLibraryIndex;
    expect(index.books[0]?.removal?.mode).toBe('restore');
  });
  test('does not rediscover or download the retained directory of a trashed book absent locally', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const remote = makeBook('h1', { deletedAt: 200, removal: removal('trash') });
    const addBookToLibrary = vi.fn();
    const provider = fakeProvider({
      captured,
      readText: async (p) =>
        p.endsWith('library.json') ? JSON.stringify(makeIndex([remote])) : null,
      list: async (p) =>
        p.endsWith('/books')
          ? [{ name: 'h1', path: '/Readest/books/h1', isDirectory: true }]
          : [{ name: 'Book.epub', path: '/Readest/books/h1/Book.epub', isDirectory: false }],
      readBinary: async () => new ArrayBuffer(3),
    });
    await new FileSyncEngine(provider, fakeStore({ addBookToLibrary })).syncLibrary([], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'd',
    });
    expect(addBookToLibrary).not.toHaveBeenCalled();
    expect(captured.deletedDirs).toEqual([]);
  });
});

describe('durable peer removal journal', () => {
  test('retains a deletion when an older client replaced the shared library index', async () => {
    const remote = makeBook('h1', { updatedAt: 100, deletedAt: 200, removal: removal('trash') });
    const deleted = vi.fn(async () => {});
    const provider = fakeProvider({
      list: async (p) =>
        p.endsWith('/removals')
          ? [
              {
                name: 'h1-200-job-200.json',
                path: '/Readest/removals/h1-200-job-200.json',
                isDirectory: false,
              },
            ]
          : [],
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
          : p.endsWith('h1-200-job-200.json')
            ? JSON.stringify({ version: 1, book: remote })
            : null,
    });
    await new FileSyncEngine(provider, fakeStore({ deleteBookLocally: deleted })).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'd' },
    );
    expect(deleted).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: 200,
        removal: expect.objectContaining({ mode: 'trash' }),
      }),
    );
  });
  test('does not erase remote files if the removal journal could not be saved', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      captured,
      writeText: async (p) => {
        if (p.includes('/removals/')) throw new Error('offline');
      },
    });
    const row = makeBook('h1', { deletedAt: 200, removal: removal('purge') });
    const result = await new FileSyncEngine(provider, fakeStore()).syncLibrary([row], {
      strategy: 'send',
      syncBooks: false,
      deviceId: 'd',
    });
    expect(captured.deletedDirs).toEqual([]);
    expect(result.failures).toBeGreaterThan(0);
  });
});

describe('edits saved by a peer after deletion', () => {
  test('retries the peer’s notes after conflict metadata was saved but the config request failed', async () => {
    let current = makeBook('h1', { updatedAt: 100, deletedAt: 200, removal: removal('trash') });
    const remote = makeBook('h1', { updatedAt: 500, title: 'Later edit' });
    let reads = 0;
    const saveBookConfig = vi.fn(async () => {});
    const provider = fakeProvider({
      readText: async (path) => {
        if (path.endsWith('library.json')) return JSON.stringify(makeIndex([remote]));
        if (path.endsWith('config.json')) {
          if (++reads === 1) throw new Error('offline');
          return JSON.stringify({
            schemaVersion: 1,
            bookHash: 'h1',
            config: { updatedAt: 500 },
            booknotes: [{ id: 'later-note', updatedAt: 500 }],
          });
        }
        return null;
      },
    });
    const store = fakeStore({
      getCurrentBook: async () => current,
      updateBookMetadata: async (book) => {
        current = book;
      },
      saveBookConfig,
    });
    const engine = new FileSyncEngine(provider, store);
    const failed = await engine.syncLibrary([current], {
      strategy: 'send',
      syncBooks: false,
      deviceId: 'd',
    });
    expect(failed.failures).toBeGreaterThan(0);
    expect(current.removal?.conflict).toBe(true);
    await engine.syncLibrary([current], { strategy: 'send', syncBooks: false, deviceId: 'd' });
    expect(saveBookConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ booknotes: [expect.objectContaining({ id: 'later-note' })] }),
    );
  });
  test('rechecks the peer journal before GC when a restore arrived after the initial pull', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const row = makeBook('h1', { deletedAt: 200, removal: removal('purge') });
    const restored = makeBook('h1', { deletedAt: null, removal: removal('restore', 300) });
    let published = false;
    const provider = fakeProvider({
      captured,
      writeText: async (path, body) => {
        captured.writes.push({ path, body });
        if (path.includes('/removals/')) published = true;
      },
      list: async (path) =>
        published && path.endsWith('/removals')
          ? [
              {
                name: 'h1-300-job-300.json',
                path: '/Readest/removals/h1-300-job-300.json',
                isDirectory: false,
              },
            ]
          : [],
      readText: async (path) =>
        path.endsWith('h1-300-job-300.json')
          ? JSON.stringify({ version: 1, book: restored })
          : null,
    });
    await new FileSyncEngine(provider, fakeStore()).syncLibrary([row], {
      strategy: 'send',
      syncBooks: false,
      deviceId: 'd',
    });
    expect(captured.deletedDirs).toEqual([]);
    const index = JSON.parse(libraryWrite(captured)!.body) as RemoteLibraryIndex;
    expect(index.books[0]?.removal?.mode).toBe('restore');
  });
  test.each([
    'silent',
    'send',
  ] as const)('retains a live older-client edit as a conflict in %s mode', async (strategy) => {
    const updateBookMetadata = vi.fn(async () => {}),
      saveBookConfig = vi.fn(async () => {});
    const row = makeBook('h1', { updatedAt: 100, deletedAt: 200, removal: removal('trash') });
    const remote = makeBook('h1', {
      updatedAt: 500,
      title: 'Peer personal title',
      progress: [8, 10],
    });
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([remote]))
          : p.endsWith('config.json')
            ? JSON.stringify({
                schemaVersion: 1,
                bookHash: 'h1',
                config: { updatedAt: 500, progress: [8, 10] },
                booknotes: [{ id: 'note', updatedAt: 500 }],
              })
            : null,
    });
    await new FileSyncEngine(
      provider,
      fakeStore({ updateBookMetadata, saveBookConfig }),
    ).syncLibrary([row], { strategy, syncBooks: false, deviceId: 'd' });
    expect(updateBookMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Peer personal title',
        deletedAt: 200,
        removal: expect.objectContaining({ conflict: true }),
      }),
    );
    expect(saveBookConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        progress: [8, 10],
        booknotes: [expect.objectContaining({ id: 'note' })],
      }),
    );
  });
  test.each([
    '{',
    JSON.stringify({
      schemaVersion: 1,
      books: [{ hash: '../outside', title: 'bad', updatedAt: 1 }],
      updatedAt: 1,
    }),
  ])('does not overwrite an unverifiable remote index', async (raw) => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      captured,
      readText: async (p) => (p.endsWith('library.json') ? raw : null),
    });
    await expect(
      new FileSyncEngine(provider, fakeStore()).syncLibrary([makeBook('h1')], {
        syncBooks: false,
        deviceId: 'd',
      }),
    ).rejects.toThrow(/index/i);
    expect(captured.writes).toEqual([]);
    expect(captured.deletedDirs).toEqual([]);
  });
});
