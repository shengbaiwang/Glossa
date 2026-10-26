import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { fingerprintFile } from '@/services/bookIdentity';
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

vi.mock('@/utils/tauriEpubBridge', () => ({ tryNativeParseEpub: vi.fn() }));
vi.mock('@/utils/tauriMobiBridge', () => ({ tryNativeParseMobi: vi.fn() }));
vi.mock('@/libs/document', async (original) => {
  const actual = await original<typeof import('@/libs/document')>();
  return {
    ...actual,
    DocumentLoader: class {
      async open() {
        return {
          format: 'EPUB',
          book: {
            metadata: { title: 'Same title', author: 'Same author', language: 'en' },
            getCover: async () => null,
            destroy: vi.fn(),
          },
        };
      }
    },
  };
});

import { importBook } from '@/services/bookService';
import { loadLibraryBooks, saveLibraryBooks } from '@/services/libraryService';

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
    expect(memory.fs.removeDir).not.toHaveBeenCalled();
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
    await expect(importBook(memory.fs, file, books, failing)).rejects.toThrow('disk full');
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
    expect(memory.fs.removeDir).not.toHaveBeenCalled();
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
