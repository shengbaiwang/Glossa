import { afterEach, expect, test, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService, BaseDir } from '@/types/system';
import { cleanRemovedBook } from '@/services/appBookRemoval';
import { withBookDataWrite } from '@/services/bookDataLifecycle';
import { getLocalBookFilename } from '@/utils/book';

afterEach(async () => {
  document.querySelectorAll('iframe[data-removal-peer]').forEach((frame) => frame.remove());
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('glossa-book-data-lifecycle');
    request.onsuccess = () => resolve();
    request.onerror = request.onblocked = () => reject(new Error('Storage still open'));
  });
});
function memory() {
  const book: Book = {
    hash: 'browser-download',
    title: 'Original',
    author: 'A',
    format: 'EPUB',
    createdAt: 1,
    updatedAt: 1,
    downloadedAt: 1,
    filePath: '/chosen/original.epub',
  };
  const managed = `Books/${getLocalBookFilename(book)}`;
  const external = `None/${book.filePath}`;
  const files = new Map([
    [managed, new File(['first bytes'], 'original.epub')],
    [external, new File(['first bytes'], 'original.epub')],
  ]);
  const app = {
    exists: async (path: string, base: BaseDir) => files.has(`${base}/${path}`),
    readDirectory: async () => [],
    openFile: vi.fn(async (path: string, base: BaseDir) => {
      const file = files.get(`${base}/${path}`);
      if (!file) throw new Error('Missing file');
      return file;
    }),
    deleteBook: vi.fn(async () => {
      files.delete(managed);
    }),
  };
  return {
    book,
    files,
    managed,
    external,
    app,
    clean: cleanRemovedBook(app as unknown as AppService),
  };
}

test('waits for an in-flight file writer before verifying and clearing the download', async () => {
  const m = memory();
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const writer = withBookDataWrite(m.book.hash, 0, async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    m.files.set(m.managed, new File(['finished bytes'], 'original.epub'));
    m.files.set(m.external, new File(['finished bytes'], 'original.epub'));
  });
  await ready;
  const clearing = m.clean(m.book, 'local');
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(m.app.openFile).not.toHaveBeenCalled();
    expect(m.app.deleteBook).not.toHaveBeenCalled();
  } finally {
    release();
    await writer;
  }
  await clearing;
  expect(m.files.has(m.managed)).toBe(false);
  expect(await m.files.get(m.external)!.text()).toBe('finished bytes');
});

test('a separate window can publish a purge barrier while an older window waits to clear a download', async () => {
  const m = memory();
  const frame = document.createElement('iframe');
  frame.dataset['removalPeer'] = 'true';
  frame.src = 'about:blank';
  const loaded = new Promise<void>((resolve) => {
    frame.onload = () => resolve();
  });
  document.body.append(frame);
  await loaded;
  const peer = frame.contentWindow!;
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const external = peer.navigator.locks.request(`glossa-book-data:${m.book.hash}`, async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = peer.indexedDB.open('glossa-book-data-lifecycle', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('books', { keyPath: 'bookId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('books', 'readwrite');
        transaction.objectStore('books').put({ bookId: m.book.hash, cutoff: 200, blocked: true });
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
  await ready;
  const clearing = m.clean(m.book, 'local');
  const rejected = expect(clearing).rejects.toThrow(/permanently deleted/);
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(m.app.openFile).not.toHaveBeenCalled();
  } finally {
    release();
    await external;
  }
  await rejected;
  expect(m.app.deleteBook).not.toHaveBeenCalled();
  expect(m.files.has(m.managed)).toBe(true);
  expect(m.files.has(m.external)).toBe(true);
});
