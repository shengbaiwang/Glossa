import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { fingerprintFile } from '@/services/bookIdentity';
import * as libraryEvents from '@/utils/libraryEvents';
import { partialMD5 } from '@/utils/md5';
import {
  getConfigFilename,
  getLocalBookFilename,
  getCoverFilename,
  getVisibleBooks,
} from '@/utils/book';
import { registerBookDownload } from '@/services/bookDownloadIdentity';
import { downloadBook } from '@/services/cloudService';
import type { AppService } from '@/types/system';
import {
  applyDuplicateChoice,
  previewDuplicateBooks,
  undoDuplicateChoice,
} from '@/services/duplicateBooks';

const importParser = vi.hoisted(() => ({
  count: 0,
  destroyed: 0,
  beforeOpen: undefined as undefined | (() => Promise<void>),
}));

vi.mock('@/utils/tauriEpubBridge', () => ({ tryNativeParseEpub: vi.fn() }));
vi.mock('@/utils/tauriMobiBridge', () => ({ tryNativeParseMobi: vi.fn() }));
vi.mock('@/libs/document', async (original) => {
  const actual = await original<typeof import('@/libs/document')>();
  return {
    ...actual,
    DocumentLoader: class {
      async open() {
        importParser.count++;
        await importParser.beforeOpen?.();
        return {
          format: 'EPUB',
          book: {
            metadata: { title: 'Same title', author: 'Same author', language: 'en' },
            getCover: async () => null,
            destroy: vi.fn(() => {
              importParser.destroyed++;
            }),
          },
        };
      }
    },
  };
});

import { buildBookLookupIndex, importBook, importBooks } from '@/services/bookService';
import { loadLibraryBooks, saveLibraryBooks } from '@/services/libraryService';

it('indexes complete content fingerprints for import candidate lookup', () => {
  const book = {
    hash: 'book',
    format: 'EPUB',
    title: 'Book',
    contentFingerprint: `sha256:${'a'.repeat(64)}`,
    createdAt: 1,
    updatedAt: 1,
  } as Book;
  const index = buildBookLookupIndex([book]);
  expect(index.byContentFingerprint.get(book.contentFingerprint!)).toEqual([book]);
});

function memoryFileSystem() {
  const files = new Map<string, File>();
  const key = (path: string, base: string) => `${base}/${path}`;
  const fs = {
    getPrefix: async () => '',
    createDir: async () => undefined,
    exists: async (path: string, base: string) => files.has(key(path, base)),
    openFile: async (path: string, base: string) => {
      const file = files.get(key(path, base));
      if (!file) throw new Error('Missing file');
      return file;
    },
    readFile: async (path: string, base: string, mode: string): Promise<string | ArrayBuffer> => {
      const file = await fs.openFile(path, base);
      return mode === 'text' ? file.text() : file.arrayBuffer();
    },
    writeFile: vi.fn(async (path: string, base: string, value: string | ArrayBuffer | File) => {
      files.set(key(path, base), new File([value], path.split('/').pop()!));
    }),
    copyFile: async (src: string, base: string, dest: string, destBase: string) => {
      await fs.writeFile(dest, destBase, await fs.openFile(src, base));
    },
    readDir: async () => [],
    removeDir: vi.fn(),
  } satisfies Partial<FileSystem>;
  return { fs: fs as unknown as FileSystem, files };
}

describe('content identity import contract', () => {
  let memory: ReturnType<typeof memoryFileSystem>;
  beforeEach(() => {
    memory = memoryFileSystem();
    importParser.count = 0;
    importParser.destroyed = 0;
    importParser.beforeOpen = undefined;
  });
  const options = () => ({
    saveCover: false,
    generateCoverImageUrl: async () => '',
    saveBookConfig: async (book: Book) => {
      await memory.fs.writeFile(
        getConfigFilename(book),
        'Books',
        JSON.stringify({ booknotes: [] }),
      );
    },
  });

  it('records an explicit restore lifecycle when a deleted file is deliberately reimported', async () => {
    const file = new File(['restore content'], 'original.epub');
    const books: Book[] = [];
    const first = (await importBook(memory.fs, file, books, options()))!;
    first.deletedAt = 200;
    first.removal = {
      version: 1,
      id: 'trash-job',
      revision: 200,
      requestedAt: 200,
      mode: 'trash',
      local: 'complete',
      cloud: 'pending',
      cloudTargets: { webdav: 'complete' },
    };
    await saveLibraryBooks(memory.fs, [first], { replace: true });
    const restored = (await importBook(memory.fs, file, books, options()))!;
    expect(restored.deletedAt).toBeNull();
    expect(restored.removal).toMatchObject({
      mode: 'restore',
      local: 'complete',
      cloud: 'pending',
      cloudTargets: { webdav: 'pending' },
    });
    expect(restored.removal!.revision).toBeGreaterThan(200);
  });

  it('does not import over an unfinished physical removal', async () => {
    const file = new File(['pending content'], 'original.epub');
    const books: Book[] = [];
    const first = (await importBook(memory.fs, file, books, options()))!;
    first.deletedAt = 200;
    first.removal = {
      version: 1,
      id: 'purge-job',
      revision: 200,
      requestedAt: 200,
      mode: 'purge',
      local: 'failed',
      cloud: 'none',
    };
    await saveLibraryBooks(memory.fs, [first], { replace: true });
    await expect(importBook(memory.fs, file, books, options())).rejects.toThrow(/removal/i);
    const persisted = JSON.parse(
      (await memory.fs.readFile('library.json', 'Books', 'text')) as string,
    ) as Book[];
    expect(persisted[0]!.removal?.id).toBe('purge-job');
  });

  it('fingerprints all bytes using standard SHA-256 and ignores the filename', async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 33).fill(9);
    const expected = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    expect(await fingerprintFile(new File([bytes], 'one.epub'))).toBe(expected);
    expect(await fingerprintFile(new File([bytes], 'renamed.epub'))).toBe(expected);
  });

  it('uses the file stream instead of issuing independent ranged reads', async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024).fill(7);
    const file = new File([bytes], 'stream.epub');
    const stream = vi.fn(
      () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
    );
    Object.defineProperty(file, 'stream', { value: stream });
    const slice = vi.spyOn(file, 'slice');

    await fingerprintFile(file);

    expect(stream).toHaveBeenCalledOnce();
    expect(slice).not.toHaveBeenCalled();
  });

  it('yields during a large fingerprint so cancellation stops before completion', async () => {
    const controller = new AbortController();
    const file = new File([new Uint8Array(8 * 1024 * 1024)], 'large.epub');
    const pending = fingerprintFile(file, controller.signal);
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      clearTimeout(timer);
    }
  });

  it('keeps versions distinct even when sampled hashes and metadata match', async () => {
    const first = new Uint8Array(100_000).fill(65);
    const second = first.slice();
    second[30_000] = 66; // outside every old partialMD5 sample
    const a = new File([first], 'same.epub');
    const b = new File([second], 'same.epub');
    expect(await partialMD5(a)).toBe(await partialMD5(b));
    const books: Book[] = [];
    const one = await importBook(memory.fs, a, books, options());
    const two = await importBook(memory.fs, b, books, options());
    expect(books).toHaveLength(2);
    expect(one?.hash).not.toBe(two?.hash);
    expect(
      vi
        .mocked(memory.fs.removeDir)
        .mock.calls.every(([path]) => String(path).startsWith('.importing/')),
    ).toBe(true);
  });

  it('commits concurrent renamed copies once, then reuses the record after restart', async () => {
    const books: Book[] = [];
    const statuses: string[] = [];
    const results = await Promise.all(
      ['one.epub', 'two.epub', 'three.epub'].map((name) =>
        importBook(memory.fs, new File(['original content'], name), books, {
          ...options(),
          onResult: (status) => statuses.push(status),
        }),
      ),
    );
    expect(books).toHaveLength(1);
    expect(new Set(results.map((book) => book?.hash)).size).toBe(1);
    expect(statuses.sort()).toEqual(['added', 'existing', 'existing']);
    const restored = await loadLibraryBooks(memory.fs, async () => '');
    expect(restored).toHaveLength(1);
    expect(
      (
        await importBook(
          memory.fs,
          new File(['original content'], 'again.epub'),
          restored,
          options(),
        )
      )?.hash,
    ).toBe(books[0]?.hash);
    expect(restored).toHaveLength(1);
  });

  it('commits a four-file batch with one disk snapshot and one logical save', async () => {
    const books: Book[] = [];
    const statuses: string[] = [];
    const reads = vi.spyOn(memory.fs, 'readFile');
    const inputs = ['one', 'two', 'three', 'three'].map((content, index) => ({
      file: new File([content], `${index}.epub`),
      options: {
        ...options(),
        onResult: (status: 'added' | 'existing') => statuses.push(status),
      },
    }));

    const results = await importBooks(memory.fs, inputs, books, options());

    expect(results.every((result) => result.book && !result.error)).toBe(true);
    expect(books).toHaveLength(3);
    expect(statuses).toEqual(['added', 'added', 'added', 'existing']);
    expect(reads.mock.calls.filter(([path]) => path === 'library.json')).toHaveLength(1);
    expect(
      vi.mocked(memory.fs.writeFile).mock.calls.filter(([path]) => path === 'library.json'),
    ).toHaveLength(1);
  });

  it('reuses an available complete identity before invoking a format parser', async () => {
    const books: Book[] = [];
    const first = (await importBook(
      memory.fs,
      new File(['known bytes'], 'first.epub'),
      books,
      options(),
    ))!;
    first.title = 'Personal title';
    first.progress = [17, 100];
    first.metadataUpdatedAt = first.updatedAt + 1;
    first.updatedAt++;
    await saveLibraryBooks(memory.fs, [first]);
    const parses = importParser.count;
    const reused = await importBook(
      memory.fs,
      new File(['known bytes'], 'renamed.epub'),
      books,
      options(),
    );
    expect(importParser.count).toBe(parses);
    expect(reused).toMatchObject({
      hash: first.hash,
      title: 'Personal title',
      progress: [17, 100],
    });
  });

  it('publishes ready peers and starts the fifth input while the first is still reading', async () => {
    const books: Book[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    memory.fs.fingerprint = async (path, base, signal) => {
      if (path === '/0.epub') await gate;
      return fingerprintFile(await memory.fs.openFile(path, base), signal);
    };
    for (let index = 0; index < 6; index++)
      await memory.fs.writeFile(`/${index}.epub`, 'None', `content ${index}`);
    const completed: number[] = [];
    const importing = importBooks(
      memory.fs,
      Array.from({ length: 6 }, (_, index) => ({
        file: `/${index}.epub`,
        options: { onComplete: () => completed.push(index) },
      })),
      books,
      options(),
    );
    try {
      await vi.waitFor(() => expect(completed).toContain(4));
      expect(completed).not.toContain(0);
      expect(books.length).toBeGreaterThanOrEqual(4);
      expect((await loadLibraryBooks(memory.fs, async () => '')).length).toBeGreaterThanOrEqual(4);
    } finally {
      release();
    }
    const results = await importing;
    expect(results.every((result) => result.book && !result.error)).toBe(true);
    expect(completed).toHaveLength(6);
  });

  it('completes a saved peer before a newly discovered legacy candidate finishes hashing', async () => {
    const legacy = new File(['slow legacy bytes'], 'legacy.epub');
    const old = {
      hash: await partialMD5(legacy),
      format: 'EPUB',
      title: 'Legacy',
      sourceTitle: 'Legacy',
      author: '',
      createdAt: 1,
      updatedAt: 1,
    } as Book;
    await memory.fs.writeFile(getLocalBookFilename(old), 'Books', legacy);
    await saveLibraryBooks(memory.fs, [old]);
    let release!: () => void;
    const reading = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const hashing = new Promise<void>((resolve) => {
      started = resolve;
    });
    memory.fs.fingerprint = async (path, base, signal) => {
      if (path === getLocalBookFilename(old)) {
        started();
        await reading;
      }
      return fingerprintFile(await memory.fs.openFile(path, base), signal);
    };
    const books: Book[] = [];
    const completed: number[] = [];
    let legacyCommitting = false;
    let sharedBatch = false;
    const importing = importBooks(
      memory.fs,
      [
        {
          file: new File(['ready peer'], 'ready.epub'),
          options: {
            onComplete: () => {
              sharedBatch = legacyCommitting;
              completed.push(0);
            },
          },
        },
        {
          file: legacy,
          options: {
            onProgress: ({ stage }) => {
              if (stage === 'committing') legacyCommitting = true;
            },
            onComplete: () => completed.push(1),
          },
        },
      ],
      books,
      options(),
    );
    try {
      await hashing;
      expect(completed).toEqual([0]);
      expect(sharedBatch).toBe(true);
      expect(importParser.destroyed).toBe(1);
      expect(
        (await loadLibraryBooks(memory.fs, async () => '')).some((book) => book.title === 'ready'),
      ).toBe(true);
    } finally {
      release();
    }
    const results = await importing;
    expect(results.every((result) => result.book && !result.error)).toBe(true);
    expect(completed).toEqual([0, 1]);
    expect(results[1]?.book?.hash).toBe(old.hash);
  });

  it('isolates observers and only reports completion after the saved record is readable', async () => {
    const books: Book[] = [];
    const calls: string[] = [];
    const result = await importBook(memory.fs, new File(['observer'], 'observer.epub'), books, {
      ...options(),
      onResult: () => {
        throw new Error('UI observer failed');
      },
      onProgress: ({ stage }) => {
        calls.push(stage);
      },
      onComplete: (result) => {
        expect(result.book?.hash).toBe(books[0]?.hash);
        expect(memory.files.has('Books/library.json')).toBe(true);
        throw new Error('Completion observer failed');
      },
    });
    expect(result).toBe(books[0]);
    expect(calls.at(-1)).toBe('completed');
  });

  it('notifies other windows only after a successful durable publication', async () => {
    const books: Book[] = [];
    const observed: Array<{ count: number; persisted: boolean }> = [];
    const notify = vi.spyOn(libraryEvents, 'notifyLibraryUpdated').mockImplementation(() => {
      observed.push({ count: books.length, persisted: memory.files.has('Books/library.json') });
    });
    try {
      const write = memory.fs.writeFile.bind(memory.fs);
      memory.fs.writeFile = async (path, base, value) => {
        if (path === 'library.json') throw new Error('disk full');
        return write(path, base, value);
      };
      const file = new File(['notification'], 'notification.epub');
      await expect(importBook(memory.fs, file, books, options())).rejects.toThrow('disk full');
      expect(notify).not.toHaveBeenCalled();
      memory.fs.writeFile = write;
      await importBook(memory.fs, file, books, options());
      expect(observed).toEqual([{ count: 1, persisted: true }]);
    } finally {
      notify.mockRestore();
    }
  });

  it('cancels a globally queued import before parsing and releases all permits for retry', async () => {
    let release!: () => void;
    const parsing = new Promise<void>((resolve) => {
      release = resolve;
    });
    importParser.beforeOpen = () => parsing;
    const books: Book[] = [];
    const active = Array.from({ length: 4 }, (_, index) =>
      importBook(memory.fs, new File([`active ${index}`], `${index}.epub`), books, options()),
    );
    const controller = new AbortController();
    const onComplete = vi.fn();
    try {
      await vi.waitFor(() => expect(importParser.count).toBe(4));
      const queued = importBook(memory.fs, new File(['queued'], 'queued.epub'), books, {
        ...options(),
        signal: controller.signal,
        onComplete,
      });
      controller.abort();
      await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
      expect(importParser.count).toBe(4);
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          book: null,
          error: expect.objectContaining({ name: 'AbortError' }),
        }),
      );
    } finally {
      release();
    }
    await Promise.all(active);
    expect(importParser.destroyed).toBe(4);
    importParser.beforeOpen = undefined;
    await importBook(memory.fs, new File(['queued'], 'queued.epub'), books, options());
    expect(books).toHaveLength(5);
  });

  it('discards a parser result arriving after cancellation without publishing a book', async () => {
    let release!: () => void;
    const parsing = new Promise<void>((resolve) => {
      release = resolve;
    });
    importParser.beforeOpen = () => parsing;
    const controller = new AbortController();
    const books: Book[] = [];
    const completed = vi.fn();
    const importing = importBooks(memory.fs, [{ file: new File(['late'], 'late.epub') }], books, {
      ...options(),
      signal: controller.signal,
      onComplete: completed,
    });
    await vi.waitFor(() => expect(importParser.count).toBe(1));
    controller.abort();
    release();
    const [result] = await importing;
    expect(result?.error?.name).toBe('AbortError');
    expect(result?.book).toBeNull();
    expect(books).toHaveLength(0);
    expect(memory.files.has('Books/library.json')).toBe(false);
    expect(importParser.destroyed).toBe(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it('rejects cancellation while generating the cover URL before starting a durable save', async () => {
    const controller = new AbortController();
    const books: Book[] = [];
    const onResult = vi.fn();
    const onComplete = vi.fn();
    const [result] = await importBooks(
      memory.fs,
      [{ file: new File(['cancel cover'], 'cancel.epub') }],
      books,
      {
        ...options(),
        signal: controller.signal,
        onResult,
        onComplete,
        generateCoverImageUrl: async () => {
          controller.abort();
          return '';
        },
      },
    );
    expect(result?.error?.name).toBe('AbortError');
    expect(result?.book).toBeNull();
    expect(books).toHaveLength(0);
    expect(memory.files.has('Books/library.json')).toBe(false);
    expect(onResult).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        book: null,
        error: expect.objectContaining({ name: 'AbortError' }),
      }),
    );
    expect(importParser.destroyed).toBe(1);
  });

  it('publishes a successful atomic save when cancellation arrives after persistence starts', async () => {
    const controller = new AbortController();
    const write = memory.fs.writeFile.bind(memory.fs);
    memory.fs.writeFile = async (path, base, value) => {
      if (path === 'library.json') controller.abort();
      return write(path, base, value);
    };
    const books: Book[] = [];
    const [result] = await importBooks(
      memory.fs,
      [{ file: new File(['atomic'], 'atomic.epub') }],
      books,
      {
        ...options(),
        signal: controller.signal,
      },
    );
    expect(controller.signal.aborted).toBe(true);
    expect(result?.error).toBeUndefined();
    expect(result?.book).toBe(books[0]);
    expect(await loadLibraryBooks(memory.fs, async () => '')).toHaveLength(1);
    expect(importParser.destroyed).toBe(1);
  });

  it('rejects an early duplicate cancelled while generating its cover URL', async () => {
    const books: Book[] = [];
    const file = new File(['known cancelled'], 'known.epub');
    await importBook(memory.fs, file, books, options());
    const writes = vi.mocked(memory.fs.writeFile);
    writes.mockClear();
    const controller = new AbortController();
    const onResult = vi.fn();
    const [result] = await importBooks(memory.fs, [{ file }], books, {
      ...options(),
      signal: controller.signal,
      onResult,
      generateCoverImageUrl: async () => {
        controller.abort();
        return '';
      },
    });
    expect(result?.error?.name).toBe('AbortError');
    expect(result?.book).toBeNull();
    expect(books).toHaveLength(1);
    expect(writes.mock.calls.some(([path]) => path === 'library.json')).toBe(false);
    expect(onResult).not.toHaveBeenCalled();
    expect(importParser.count).toBe(1);
  });

  it.each([
    false,
    true,
  ])('keeps an independently active peer when an earlier ready item is cancelled before save (same bytes: %s)', async (sameBytes) => {
    const controller = new AbortController();
    const books: Book[] = [];
    let firstCoverPrepared = false;
    const results = await importBooks(
      memory.fs,
      [
        {
          file: new File(['checkpoint first'], 'first.epub'),
          options: { signal: controller.signal },
        },
        { file: new File([sameBytes ? 'checkpoint first' : 'checkpoint second'], 'second.epub') },
      ],
      books,
      {
        ...options(),
        generateCoverImageUrl: async () => {
          if (firstCoverPrepared) controller.abort();
          else firstCoverPrepared = true;
          return '';
        },
      },
    );
    expect(results[0]?.error?.name).toBe('AbortError');
    expect(results[0]?.book).toBeNull();
    expect(results[1]?.error).toBeUndefined();
    expect(results[1]?.book).toBeTruthy();
    expect(books).toHaveLength(1);
    expect(await loadLibraryBooks(memory.fs, async () => '')).toHaveLength(1);
    expect(importParser.destroyed).toBe(2);
  });

  it('reuses an exclusive admission lease when an early duplicate needs its file restaged', async () => {
    const books: Book[] = [];
    const file = new File(['restage bytes'], 'first.epub');
    const first = (await importBook(memory.fs, file, books, options()))!;
    const largeSource = new File(['restage bytes'], 'source.epub');
    Object.defineProperty(largeSource, 'size', { value: 300 * 1024 * 1024 });
    memory.files.set('None//source.epub', largeSource);
    memory.fs.fingerprint = async () => first.contentFingerprint;
    let waiting = 0;
    const result = await importBook(memory.fs, '/source.epub', books, {
      ...options(),
      onProgress: ({ stage }) => {
        if (stage === 'waiting' && ++waiting === 2)
          memory.files.delete(`Books/${getLocalBookFilename(first)}`);
      },
    });
    expect(result?.hash).toBe(first.hash);
    expect(books).toHaveLength(1);
    expect(importParser.count).toBe(2);
    expect(await memory.fs.exists(getLocalBookFilename(first), 'Books')).toBe(true);
  });

  it('verifies legacy bytes outside the library lock so unrelated saves can continue', async () => {
    const file = new File(['legacy outside lock'], 'legacy.epub');
    const old = {
      hash: await partialMD5(file),
      format: 'EPUB',
      title: 'Mine',
      sourceTitle: 'Mine',
      author: '',
      createdAt: 1,
      updatedAt: 1,
    } as Book;
    await memory.fs.writeFile(getLocalBookFilename(old), 'Books', file);
    await saveLibraryBooks(memory.fs, [old]);
    let release!: () => void;
    const reading = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const hashing = new Promise<void>((resolve) => {
      started = resolve;
    });
    memory.fs.fingerprint = async (path, base, signal) => {
      if (path === getLocalBookFilename(old)) {
        started();
        await reading;
      }
      return fingerprintFile(await memory.fs.openFile(path, base), signal);
    };
    const importing = importBook(memory.fs, file, [], options());
    try {
      await hashing;
      let saved = false;
      const saving = saveLibraryBooks(memory.fs, [
        { ...old, title: 'Later title', metadataUpdatedAt: 2, updatedAt: 2 },
      ]).then(() => {
        saved = true;
      });
      await vi.waitFor(() => expect(saved).toBe(true));
      await saving;
    } finally {
      release();
    }
    const result = await importing;
    expect(result).toMatchObject({ hash: old.hash, title: 'Later title' });
  });

  it('verifies a legacy record, retains its identity and every personal field and sidecar', async () => {
    const file = new File(['legacy content'], 'old.epub');
    const old: Book = {
      hash: await partialMD5(file),
      format: 'EPUB',
      title: 'My title',
      author: 'Edited author',
      groupId: 'research',
      groupName: 'Research',
      tags: ['mine'],
      progress: [45, 100],
      readingStatus: 'reading',
      metadata: { title: 'Personal metadata', author: 'Mine', language: 'en' },
      createdAt: 10,
      updatedAt: 20,
    };
    const before = structuredClone(old);
    await memory.fs.writeFile(getLocalBookFilename(old), 'Books', file);
    await memory.fs.writeFile(getConfigFilename(old), 'Books', '{"booknotes":[{"id":"mine"}]}');
    await memory.fs.writeFile(`${old.hash}/nav.json`, 'Books', '{"personal":true}');
    await saveLibraryBooks(memory.fs, [old]);
    const result = await importBook(
      memory.fs,
      new File(['legacy content'], 'renamed.epub'),
      [old],
      options(),
    );
    expect(result).toMatchObject(before);
    expect(result?.contentFingerprint).toBe(await fingerprintFile(file));
    expect(await memory.fs.readFile(getConfigFilename(old), 'Books', 'text')).toBe(
      '{"booknotes":[{"id":"mine"}]}',
    );
    expect(await memory.fs.readFile(`${old.hash}/nav.json`, 'Books', 'text')).toBe(
      '{"personal":true}',
    );
  });

  it('rechecks disk when separate callers imported from stale empty snapshots', async () => {
    const snapshots: Book[][] = [[], []];
    const results = await Promise.all(
      snapshots.map((books, index) =>
        importBook(memory.fs, new File(['identical'], `${index}.epub`), books, options()),
      ),
    );
    expect(results[0]?.hash).toBe(results[1]?.hash);
    expect(await loadLibraryBooks(memory.fs, async () => '')).toHaveLength(1);
  });

  it('distinguishes a replaced file at the same path and leaves the first sidecars intact', async () => {
    const books: Book[] = [];
    await memory.fs.writeFile('/books/original.epub', 'None', 'edition one');
    const first = await importBook(memory.fs, '/books/original.epub', books, {
      ...options(),
      inPlace: true,
    });
    await memory.fs.writeFile(
      getConfigFilename(first!),
      'Books',
      '{"booknotes":[{"id":"personal"}]}',
    );
    await memory.fs.writeFile('/books/original.epub', 'None', 'edition two');
    const second = await importBook(memory.fs, '/books/original.epub', books, {
      ...options(),
      inPlace: true,
    });
    expect(first?.hash).not.toBe(second?.hash);
    expect(books).toHaveLength(2);
    expect(await memory.fs.readFile(getConfigFilename(first!), 'Books', 'text')).toBe(
      '{"booknotes":[{"id":"personal"}]}',
    );
  });

  it('retries a failed durable save without resetting sidecars written by the first attempt', async () => {
    const file = new File(['retry content'], 'retry.epub');
    const failing = options();
    const write = memory.fs.writeFile.bind(memory.fs);
    let fail = true;
    memory.fs.writeFile = async (path, base, value) => {
      if (fail && path === 'library.json') throw new Error('disk full');
      return write(path, base, value);
    };
    const books: Book[] = [];
    const completed = vi.fn();
    await expect(
      importBook(memory.fs, file, books, { ...failing, onComplete: completed }),
    ).rejects.toThrow('disk full');
    expect(books).toHaveLength(0);
    expect(completed).toHaveBeenCalledWith(
      expect.objectContaining({
        book: null,
        error: expect.objectContaining({ message: expect.stringContaining('disk full') }),
      }),
    );
    const { md5 } = await import('@/utils/md5');
    const hash = md5(await fingerprintFile(file));
    await write(`${hash}/config.json`, 'Books', '{"booknotes":[{"id":"saved"}]}');
    fail = false;
    await importBook(memory.fs, file, books, options());
    expect(books).toHaveLength(1);
    expect(await memory.fs.readFile(`${hash}/config.json`, 'Books', 'text')).toBe(
      '{"booknotes":[{"id":"saved"}]}',
    );
  });

  it('does not infer an unversioned external record from a replaced source path', async () => {
    const file = new File(['new edition'], 'same.epub');
    const old = {
      hash: await partialMD5(file),
      format: 'EPUB',
      title: 'Personal title',
      author: 'Mine',
      filePath: '/same.epub',
      createdAt: 1,
      updatedAt: 1,
    } as Book;
    await memory.fs.writeFile('/same.epub', 'None', file);
    await saveLibraryBooks(memory.fs, [old]);
    const books = [old];
    const imported = await importBook(memory.fs, '/same.epub', books, {
      ...options(),
      inPlace: true,
    });
    expect(imported?.hash).not.toBe(old.hash);
    expect(books).toHaveLength(2);
    expect(old.title).toBe('Personal title');
    expect(old.filePath).toBeUndefined();
  });

  it('uses a verified streaming copy when the filesystem provides one', async () => {
    const file = new File(['verified bytes'], 'source.epub');
    await memory.fs.writeFile('/source.epub', 'None', file);
    const expected = await fingerprintFile(file);
    const copyFileVerified = vi.fn(
      async (src: string, srcBase: 'None', dest: string, destBase: 'Books') => {
        await memory.fs.copyFile(src, srcBase, dest, destBase);
        return expected;
      },
    );
    Object.assign(memory.fs, { copyFileVerified });

    const books: Book[] = [];
    await importBook(memory.fs, '/source.epub', books, options());

    expect(copyFileVerified).toHaveBeenCalledWith(
      '/source.epub',
      'None',
      expect.stringMatching(/^\.importing\/.+\/book$/),
      'Books',
      expected,
      undefined,
    );
    expect(books[0]?.contentFingerprint).toBe(expected);
  });

  it('rejects a source changed during copying, then repairs its unregistered file on retry', async () => {
    const file = new File(['expected'], 'source.epub');
    await memory.fs.writeFile('/source.epub', 'None', file);
    const copy = memory.fs.copyFile.bind(memory.fs);
    memory.fs.copyFile = async (_src, _base, dest, destBase) => {
      await memory.fs.writeFile(dest, destBase, 'changed');
    };
    const books: Book[] = [];
    await expect(importBook(memory.fs, '/source.epub', books, options())).rejects.toThrow(
      'changed during import',
    );
    expect(books).toHaveLength(0);
    memory.fs.copyFile = copy;
    await importBook(memory.fs, '/source.epub', books, options());
    expect(books).toHaveLength(1);
    expect(await memory.fs.readFile(getLocalBookFilename(books[0]!), 'Books', 'text')).toBe(
      'expected',
    );
  });

  it('commits initial grouping atomically and preserves it on a repeated import', async () => {
    const file = new File(['grouped'], 'grouped.epub');
    const books: Book[] = [];
    const first = await importBook(memory.fs, file, books, {
      ...options(),
      initialGroup: { id: 'research', name: 'Research' },
      initialTags: ['mine'],
    });
    expect((await loadLibraryBooks(memory.fs, async () => ''))[0]).toMatchObject({
      groupId: 'research',
      tags: ['mine'],
    });
    await importBook(memory.fs, file, books, {
      ...options(),
      initialGroup: { id: 'other' },
      initialTags: ['other'],
    });
    expect(first).toMatchObject({ groupId: 'research', tags: ['mine'] });
  });

  it('uses the same transaction for concurrent sync downloads and manual imports', async () => {
    const remote = {
      hash: 'legacy-remote',
      format: 'EPUB',
      title: 'Remote personal title',
      author: 'Mine',
      createdAt: 1,
      updatedAt: 1,
    } as Book;
    await memory.fs.writeFile(getLocalBookFilename(remote), 'Books', 'shared bytes');
    await memory.fs.writeFile(
      getConfigFilename(remote),
      'Books',
      '{"booknotes":[{"id":"remote-note"}]}',
    );
    await Promise.all([
      registerBookDownload(memory.fs, remote),
      importBook(memory.fs, new File(['shared bytes'], 'renamed.epub'), [], options()),
    ]);
    const saved = await loadLibraryBooks(memory.fs, async () => '');
    expect(getVisibleBooks(saved)).toHaveLength(1);
    expect(await memory.fs.readFile(getConfigFilename(remote), 'Books', 'text')).toContain(
      'remote-note',
    );
  });

  it('applies the same byte verification to the existing cloud download route', async () => {
    const keeper = await importBook(
      memory.fs,
      new File(['cloud bytes'], 'keeper.epub'),
      [],
      options(),
    );
    const remote = {
      hash: 'old-cloud-id',
      format: 'EPUB',
      title: 'Peer title',
      author: 'Peer',
      createdAt: 1,
      updatedAt: 1,
    } as Book;
    await memory.fs.writeFile(getLocalBookFilename(remote), 'Books', 'cloud bytes');
    await memory.fs.writeFile(getCoverFilename(remote), 'Books', 'cover');
    await saveLibraryBooks(memory.fs, [remote]);
    await downloadBook({} as AppService, memory.fs, '/books', remote);
    expect(remote.duplicateOf).toBe(keeper?.hash);
    expect(remote.contentFingerprint).toBe(keeper?.contentFingerprint);
    expect(getVisibleBooks(await loadLibraryBooks(memory.fs, async () => ''))).toHaveLength(1);
  });

  it('preserves a newer duplicate choice when memory has later reading metadata', async () => {
    const fingerprint = await fingerprintFile(new File(['same bytes'], 'same.epub'));
    const keeper = {
      hash: 'chosen',
      format: 'EPUB',
      title: 'Chosen',
      author: '',
      createdAt: 1,
      updatedAt: 1,
      contentFingerprint: fingerprint,
    } as Book;
    const archived = {
      ...keeper,
      hash: 'archived',
      duplicateOf: keeper.hash,
      duplicateUpdatedAt: 20,
    };
    await saveLibraryBooks(memory.fs, [archived, keeper]);
    const stale = {
      ...archived,
      updatedAt: 30,
      duplicateOf: undefined,
      duplicateUpdatedAt: undefined,
    };
    const remote = { ...keeper, hash: 'download' };
    await memory.fs.writeFile(getLocalBookFilename(remote), 'Books', 'same bytes');
    const result = await registerBookDownload(memory.fs, remote, [stale, keeper]);
    expect(result.book.duplicateOf).toBe(keeper.hash);
    expect(result.books.find((book) => book.hash === archived.hash)).toMatchObject({
      updatedAt: 30,
      duplicateOf: keeper.hash,
      duplicateUpdatedAt: 20,
    });
    expect(getVisibleBooks(result.books).map((book) => book.hash)).toEqual([keeper.hash]);
  });

  it('does not mark a rejected cloud download as available', async () => {
    const remote = {
      hash: 'bad-cloud-id',
      format: 'EPUB',
      title: 'Peer title',
      author: '',
      createdAt: 1,
      updatedAt: 1,
      downloadedAt: null,
      contentFingerprint: await fingerprintFile(new File(['expected'], 'expected.epub')),
    } as Book;
    await memory.fs.writeFile(getLocalBookFilename(remote), 'Books', 'corrupt download');
    await memory.fs.writeFile(getCoverFilename(remote), 'Books', 'cover');
    await expect(downloadBook({} as AppService, memory.fs, '/books', remote)).rejects.toThrow(
      'fingerprint mismatch',
    );
    expect(remote.downloadedAt).toBeNull();
  });

  it('refuses a routine write that replaces an established content identity', async () => {
    const book = await importBook(memory.fs, new File(['edition one'], 'one.epub'), [], options());
    await expect(
      saveLibraryBooks(memory.fs, [
        {
          ...book!,
          contentFingerprint: await fingerprintFile(new File(['edition two'], 'two.epub')),
        },
      ]),
    ).rejects.toThrow('identity conflict');
    expect((await loadLibraryBooks(memory.fs, async () => ''))[0]?.contentFingerprint).toBe(
      book?.contentFingerprint,
    );
  });

  it('cancels before commit and allows one successful retry', async () => {
    const controller = new AbortController();
    controller.abort();
    const books: Book[] = [];
    const file = new File(['cancel'], 'cancel.epub');
    await expect(
      importBook(memory.fs, file, books, { ...options(), signal: controller.signal }),
    ).rejects.toThrow();
    expect(books).toHaveLength(0);
    await importBook(memory.fs, file, books, options());
    expect(books).toHaveLength(1);
  });

  async function legacyDuplicates() {
    const books: Book[] = ['one', 'two'].map((hash, index) => ({
      hash,
      format: 'EPUB',
      title: `Personal ${index}`,
      author: 'Mine',
      groupName: `Group ${index}`,
      createdAt: 10 + index,
      updatedAt: 20,
      progress: [index * 40, 100],
    }));
    for (const book of books) {
      await memory.fs.writeFile(getLocalBookFilename(book), 'Books', 'same bytes');
      await memory.fs.writeFile(
        getConfigFilename(book),
        'Books',
        JSON.stringify({
          location: book.hash,
          booknotes: [{ id: 'conflict', note: book.hash }],
        }),
      );
      await memory.fs.writeFile(`${book.hash}/nav.json`, 'Books', `{"title":"${book.hash}"}`);
    }
    await saveLibraryBooks(memory.fs, books);
    return books;
  }

  it('previews actual duplicate bytes and archives only after an explicit record choice', async () => {
    const books = await legacyDuplicates();
    const before = await memory.fs.readFile('library.json', 'Books', 'text');
    const preview = await previewDuplicateBooks(memory.fs, books);
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0]!.candidates.map((row) => [row.notes, row.hasContents])).toEqual([
      [1, true],
      [1, true],
    ]);
    expect(await memory.fs.readFile('library.json', 'Books', 'text')).toBe(before);
    const result = await applyDuplicateChoice(memory.fs, preview.groups[0]!, 'two');
    expect(result.find((book) => book.hash === 'one')?.duplicateOf).toBe('two');
    expect(result.find((book) => book.hash === 'two')?.duplicateOf).toBeUndefined();
    for (const book of books) {
      expect(await memory.fs.readFile(getConfigFilename(book), 'Books', 'text')).toContain(
        `"note":"${book.hash}"`,
      );
      expect(await memory.fs.readFile(`${book.hash}/nav.json`, 'Books', 'text')).toBe(
        `{"title":"${book.hash}"}`,
      );
    }
    expect(
      vi
        .mocked(memory.fs.removeDir)
        .mock.calls.every(([path]) => String(path).startsWith('.importing/')),
    ).toBe(true);
  });

  it('undoes after restart without overwriting later reading or metadata edits', async () => {
    const books = await legacyDuplicates();
    const preview = await previewDuplicateBooks(memory.fs, books);
    const archived = await applyDuplicateChoice(memory.fs, preview.groups[0]!, 'one');
    const edited = archived.find((book) => book.hash === 'two')!;
    await saveLibraryBooks(memory.fs, [
      { ...edited, title: 'Later title', progress: [70, 100], updatedAt: 100 },
    ]);
    const restored = await undoDuplicateChoice(memory.fs);
    expect(restored.find((book) => book.hash === 'two')).toMatchObject({
      title: 'Later title',
      progress: [70, 100],
      updatedAt: 100,
    });
    expect(restored.some((book) => !!book.duplicateOf)).toBe(false);
  });

  it('rejects a stale duplicate preview when personal sidecars changed', async () => {
    const books = await legacyDuplicates();
    const preview = await previewDuplicateBooks(memory.fs, books);
    await memory.fs.writeFile('two/config.json', 'Books', '{"booknotes":[{"id":"new"}]}');
    await expect(applyDuplicateChoice(memory.fs, preview.groups[0]!, 'one')).rejects.toThrow(
      'Library changed',
    );
    expect(
      (await loadLibraryBooks(memory.fs, async () => '')).some((book) => !!book.duplicateOf),
    ).toBe(false);
  });

  it('reports missing files instead of treating metadata equality as duplicates', async () => {
    const books = await legacyDuplicates();
    memory.files.delete(`Books/${getLocalBookFilename(books[1]!)}`);
    const preview = await previewDuplicateBooks(memory.fs, books);
    expect(preview.groups).toHaveLength(0);
    expect(preview.unavailable).toBe(1);
  });
});
