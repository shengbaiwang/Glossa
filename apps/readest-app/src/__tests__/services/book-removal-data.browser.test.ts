import { afterEach, expect, test, vi } from 'vitest';
import {
  purgeBookBrowserData,
  inspectLegacyBrowserCaches,
  clearLegacyBrowserCaches,
} from '@/services/bookRemovalData';
import { activateBookData, withBookDataWrite } from '@/services/bookDataLifecycle';
import { z } from 'zod';
import { createDerivedStore } from '@/glossa/harness/derivedStore';
import { mapCheckpointStore, type MapCheckpoint } from '@/glossa/mindmap/checkpoints';
import { updateCoverImage } from '@/services/bookService';
import type { CoverContext } from '@/services/bookService';

const stores = [
  ['glossa-conversations', 'books', 'bookId'],
  ['glossa-map-workspaces', 'workspaces', 'bookId'],
  ['glossa-reading-mindmaps', 'mindmaps', ['bookId', 'chapterId', 'passageId']],
] as const;
const opened: IDBDatabase[] = [];
afterEach(async () => {
  opened.splice(0).forEach((db) => db.close());
  for (const name of [
    ...stores.map(([name]) => name),
    'glossa-book-data-lifecycle',
    'glossa-reading-inventories',
    'glossa-map-generation',
  ])
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
});
async function open(name: string, store: string, keyPath: string | readonly string[]) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(store, {
        keyPath: typeof keyPath === 'string' ? keyPath : [...keyPath],
      });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  opened.push(db);
  return db;
}
async function rows(db: IDBDatabase, store: string) {
  return new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly'),
      request = tx.objectStore(store).getAll();
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}
test('removes only the selected book’s conversations, saved maps and edited workspace', async () => {
  for (const [name, store, keyPath] of stores) {
    const db = await open(name, store, keyPath);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      for (const bookId of ['selected-book', 'other-book'])
        tx.objectStore(store).put({
          bookId,
          chapterId: 'one',
          passageId: 'one',
          content: 'personal data',
        });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  await purgeBookBrowserData('selected-book');
  for (let index = 0; index < stores.length; index++)
    expect(await rows(opened[index]!, stores[index]![1])).toEqual([
      { bookId: 'other-book', chapterId: 'one', passageId: 'one', content: 'personal data' },
    ]);
  await purgeBookBrowserData('selected-book');
  for (let index = 0; index < stores.length; index++)
    expect(await rows(opened[index]!, stores[index]![1])).toHaveLength(1);
});
test('does not invent or clear a database when personal storage has never been used', async () => {
  await purgeBookBrowserData('selected-book');
  const names = (await indexedDB.databases()).map((db) => db.name);
  for (const [name] of stores) expect(names).not.toContain(name);
});
test('finishes an in-flight write before purging and rejects late writes even after explicit reimport', async () => {
  const events: string[] = [];
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const write = withBookDataWrite('selected-book', 0, async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    events.push('old-write');
  });
  await entered;
  const purge = purgeBookBrowserData('selected-book', 200, async () => {
    events.push('purge-files');
  });
  release();
  await write;
  await purge;
  expect(events).toEqual(['old-write', 'purge-files']);
  await expect(withBookDataWrite('selected-book', 0, async () => {})).rejects.toThrow();
  await activateBookData('selected-book', 300);
  await expect(withBookDataWrite('selected-book', 0, async () => {})).rejects.toThrow();
  await withBookDataWrite('selected-book', 300, async () => {
    events.push('new-write');
  });
  expect(events.at(-1)).toBe('new-write');
});
test('clears owned derived inventories and checkpoints while preserving other books and unattributed legacy data', async () => {
  const cache = createDerivedStore('glossa-reading-inventories', z.array(z.string()));
  const signal = new AbortController().signal;
  const checkpoint: MapCheckpoint = {
    version: 1,
    contentHash: 'a'.repeat(64),
    sourceCount: 1,
    characterCount: 5,
    batches: [{ start: 0, end: 1 }],
  };
  for (const [index, bookId] of ['selected-book', 'other-book'].entries()) {
    const owner = { bookId, revision: 0 };
    const key = String(index + 1).repeat(64);
    await cache.save(key, ['derived content'], signal, owner);
    await mapCheckpointStore.save(key, null, checkpoint, signal, owner);
  }
  await cache.save('3'.repeat(64), ['unattributed legacy content'], signal);
  await purgeBookBrowserData('selected-book', 200);
  expect(await cache.load('1'.repeat(64))).toBeNull();
  expect(await cache.load('2'.repeat(64))).toEqual(['derived content']);
  expect(await cache.load('3'.repeat(64))).toEqual(['unattributed legacy content']);
  expect((await mapCheckpointStore.load('1'.repeat(64))).checkpoint).toBeNull();
  expect((await mapCheckpointStore.load('2'.repeat(64))).checkpoint).toEqual(checkpoint);
  await expect(
    cache.save('4'.repeat(64), ['late'], signal, { bookId: 'selected-book', revision: 0 }),
  ).rejects.toThrow();
  await expect(
    mapCheckpointStore.save('4'.repeat(64), null, checkpoint, signal, {
      bookId: 'selected-book',
      revision: 0,
    }),
  ).rejects.toThrow();
});
test('attributes a verified legacy cache hit before reuse and refuses to relabel an owned entry', async () => {
  const cache = createDerivedStore('glossa-reading-inventories', z.array(z.string()));
  const key = 'a'.repeat(64),
    signal = new AbortController().signal;
  await cache.save(key, ['legacy'], signal);
  expect(await cache.load(key, { bookId: 'selected-book', revision: 0 })).toEqual(['legacy']);
  expect(await cache.load(key, { bookId: 'other-book', revision: 0 })).toBeNull();
  await purgeBookBrowserData('selected-book', 200);
  expect(await cache.load(key)).toBeNull();
});
test('does not recreate a cover from a late image selection after permanent deletion', async () => {
  const writeFile = vi.fn(),
    removeFile = vi.fn();
  const ctx = {
    appPlatform: 'tauri',
    localBooksDir: '/books',
    fs: { writeFile, removeFile, openFile: async () => new File(['image'], 'image.png') },
  } as unknown as CoverContext;
  const book = {
    hash: 'selected-book',
    title: 'Book',
    author: 'A',
    format: 'EPUB' as const,
    createdAt: 1,
    updatedAt: 1,
  };
  await purgeBookBrowserData(book.hash, 200);
  await expect(updateCoverImage(ctx, book, undefined, '/external/image.png')).rejects.toThrow();
  await expect(updateCoverImage(ctx, book, '_blank')).rejects.toThrow();
  expect(writeFile).not.toHaveBeenCalled();
  expect(removeFile).not.toHaveBeenCalled();
});

test('reviews only shared generated rows and rejects data changed or attributed after preview', async () => {
  const cache = createDerivedStore('glossa-reading-inventories', z.array(z.string()));
  const signal = new AbortController().signal,
    key = 'f'.repeat(64);
  await cache.save(key, ['legacy'], signal);
  await cache.save('e'.repeat(64), ['owned'], signal, { bookId: 'other-book', revision: 0 });
  let review = await inspectLegacyBrowserCaches();
  expect(review).toHaveLength(1);
  await cache.save(key, ['new words'], signal);
  await expect(clearLegacyBrowserCaches(review)).rejects.toThrow(/changed/i);
  expect(await cache.load(key)).toEqual(['new words']);
  review = await inspectLegacyBrowserCaches();
  await cache.load(key, { bookId: 'selected-book', revision: 0 });
  await expect(clearLegacyBrowserCaches(review)).rejects.toThrow(/changed/i);
  await cache.save('d'.repeat(64), ['reviewed legacy'], signal);
  review = await inspectLegacyBrowserCaches();
  await cache.save('c'.repeat(64), ['later legacy'], signal);
  await clearLegacyBrowserCaches(review);
  await clearLegacyBrowserCaches(review);
  expect(await cache.load('d'.repeat(64))).toBeNull();
  expect(await cache.load('c'.repeat(64))).toEqual(['later legacy']);
  expect(await cache.load(key)).toEqual(['new words']);
  expect(await cache.load('e'.repeat(64))).toEqual(['owned']);
});

test('a checksum read in progress cannot recreate a legacy row after its reviewed cleanup', async () => {
  const cache = createDerivedStore('glossa-reading-inventories', z.array(z.string()));
  const signal = new AbortController().signal,
    key = '9'.repeat(64);
  await cache.save(key, ['legacy'], signal);
  const review = await inspectLegacyBrowserCaches();
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return digest(...args);
  });
  try {
    const reading = cache.load(key, { bookId: 'selected-book', revision: 0 });
    await started;
    await clearLegacyBrowserCaches(review);
    release();
    expect(await reading).toBeNull();
    expect(await cache.load(key)).toBeNull();
  } finally {
    spy.mockRestore();
  }
});
