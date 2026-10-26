import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Book } from '@/types/book';
import { getMetadataHash } from '@/utils/book';
import { fingerprintFile } from '@/services/bookIdentity';

const mockOpen = vi.hoisted(() => vi.fn());
const mockPartialMD5 = vi.hoisted(() => vi.fn());

vi.mock('@/utils/md5', async () => {
  const actual = await vi.importActual<typeof import('@/utils/md5')>('@/utils/md5');
  return { ...actual, partialMD5: mockPartialMD5 };
});

vi.mock('@/libs/document', async () => {
  const actual = await vi.importActual<typeof import('@/libs/document')>('@/libs/document');
  class MockDocumentLoader {
    open() {
      return mockOpen();
    }
  }
  return { ...actual, DocumentLoader: MockDocumentLoader };
});

vi.mock('@/utils/txt', () => ({ TxtToEpubConverter: vi.fn() }));
vi.mock('@/utils/svg', () => ({ svg2png: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  createProgressHandler: vi.fn(),
  batchGetDownloadUrls: vi.fn(),
}));

import { BaseAppService } from '@/services/appService';
import { buildBookLookupIndex, refreshBookMetadata } from '@/services/bookService';

// Concrete test subclass of BaseAppService with mocked fs
class TestAppService extends BaseAppService {
  private files = new Map<string, File>();
  protected fs = {
    openFile: vi.fn(async (path: string) => {
      const file = this.files.get(path);
      if (!file) throw new Error('Missing file');
      return file;
    }),
    readFile: vi.fn(),
    writeFile: vi.fn(async (path: string, _base: string, value: string | ArrayBuffer | File) => {
      this.files.set(path, new File([value], path.split('/').pop()!));
    }),
    copyFile: vi.fn(),
    removeFile: vi.fn(),
    readDir: vi.fn(),
    createDir: vi.fn(),
    removeDir: vi.fn(),
    exists: vi.fn(),
    stats: vi.fn(),
    resolvePath: vi.fn(),
    getURL: vi.fn(),
    getBlobURL: vi.fn().mockResolvedValue(''),
    getImageURL: vi.fn(),
    getPrefix: vi.fn(),
  };

  protected resolvePath() {
    return { baseDir: 0, basePrefix: async () => '', fp: '', base: 'Books' as const };
  }

  async init() {}
  async setCustomRootDir() {}
  async selectDirectory() {
    return '';
  }
  async selectFiles() {
    return [];
  }
  async saveFile() {
    return false;
  }
  async saveImageToGallery() {
    return false;
  }
  async ask() {
    return false;
  }
  async openDatabase() {
    return {} as ReturnType<BaseAppService['openDatabase']>;
  }
  async createWindow() {}
  async getCacheDir() {
    return '';
  }
  async clearWebviewCache() {}
  async showNotification() {}

  getFs() {
    return this.fs;
  }
}

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'old-hash-123',
    format: 'EPUB' as Book['format'],
    title: 'Test Book',
    sourceTitle: 'Test Book',
    author: 'Test Author',
    createdAt: Date.now() - 10000,
    updatedAt: Date.now() - 10000,
    downloadedAt: Date.now() - 10000,
    deletedAt: null,
    ...overrides,
  };
}

const TEST_METADATA = {
  title: 'Test Book',
  author: 'Test Author',
  language: 'en',
  identifier: 'isbn-123',
};

function setupMockBookDoc(metadata: Record<string, unknown> = TEST_METADATA) {
  const bookDoc = {
    metadata,
    getCover: vi.fn().mockResolvedValue(null),
  };
  mockOpen.mockResolvedValue({ book: bookDoc, format: 'EPUB' });
}

describe('importBook metaHash deduplication', () => {
  let service: TestAppService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(false);
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockClear();
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
  });

  it('preserves an unverified metadata match as a separate version', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const existingBook = makeBook({ hash: 'old-hash-123', metaHash });
    const books: Book[] = [existingBook];

    mockPartialMD5.mockResolvedValue('new-hash-456');
    setupMockBookDoc();

    const mockFile = new File(['new content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books);

    expect(result).not.toBe(existingBook);
    expect(books.length).toBe(2);
    expect(existingBook.hash).toBe('old-hash-123');
    expect(existingBook.metadata).toBeUndefined();
    expect(existingBook.metaHash).toBe(metaHash);
  });

  it('keeps the old upload identity when a metadata match cannot be verified', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);
    const existingBook = makeBook({
      hash: 'old-hash-123',
      metaHash,
      uploadedAt: Date.now() - 5000,
    });
    const books: Book[] = [existingBook];
    const uploadedAt = existingBook.uploadedAt;

    mockPartialMD5.mockResolvedValue('new-hash-456');
    setupMockBookDoc();

    const mockFile = new File(['new content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books);

    expect(result).not.toBe(existingBook);
    expect(existingBook.hash).toBe('old-hash-123');
    expect(existingBook.uploadedAt).toBe(uploadedAt);
    expect(result?.uploadedAt).toBeNull();
  });

  it('should not match metaHash for deleted books', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const deletedBook = makeBook({
      hash: 'old-hash-123',
      metaHash,
      deletedAt: Date.now(),
    });
    const books: Book[] = [deletedBook];

    mockPartialMD5.mockResolvedValue('new-hash-456');
    setupMockBookDoc();

    const mockFile = new File(['new content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books);

    // Should create a new book since the existing one is deleted
    expect(result).not.toBe(deletedBook);
    expect(books.length).toBe(2);
  });

  it('initializes a separate config without migrating or deleting a metadata match', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);
    const existingBook = makeBook({ hash: 'old-hash-123', metaHash });
    const books: Book[] = [existingBook];

    mockPartialMD5.mockResolvedValue('new-hash-456');
    setupMockBookDoc();

    const fs = service.getFs();
    fs.exists.mockImplementation(async (path: string) => {
      if (path === 'old-hash-123/config.json') return true;
      if (path === 'old-hash-123') return true;
      return false;
    });
    fs.readFile.mockResolvedValue('{"readProgress":0.5}');

    const mockFile = new File(['new content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books);

    expect(fs.readFile).not.toHaveBeenCalledWith('old-hash-123/config.json', 'Books', 'text');
    const writeCalls = fs.writeFile.mock.calls;
    const configWrite = writeCalls.find((c: unknown[]) => c[0] === `${result!.hash}/config.json`);
    expect(configWrite).toBeDefined();
    const writtenConfig = JSON.parse(configWrite![2] as string);
    expect(result!.hash).not.toBe(existingBook.hash);
    expect(writtenConfig.location).toBeUndefined();
    expect(writtenConfig.readProgress).toBeUndefined();
    expect(existingBook.hash).toBe('old-hash-123');
    expect(fs.removeDir).not.toHaveBeenCalled();
  });

  it('should prefer exact file hash match over metaHash match', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const exactMatchBook = makeBook({ hash: 'same-hash', metaHash });
    exactMatchBook.contentFingerprint = await fingerprintFile(new File(['content'], 'test.epub'));
    const metaMatchBook = makeBook({ hash: 'different-hash', metaHash });
    const books: Book[] = [exactMatchBook, metaMatchBook];

    mockPartialMD5.mockResolvedValue('same-hash');
    setupMockBookDoc();

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books);

    // Should return the exact hash match, not the metaHash match
    expect(result).toBe(exactMatchBook);
    expect(metaMatchBook.deletedAt).toBeNull();
    expect(exactMatchBook.deletedAt).toBeNull();
  });

  it('should not check metaHash for transient imports', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);
    const existingBook = makeBook({ hash: 'old-hash', metaHash });
    const books: Book[] = [existingBook];

    mockPartialMD5.mockResolvedValue('new-hash');
    setupMockBookDoc();

    const fs = service.getFs();
    fs.openFile.mockResolvedValue(new File(['content'], 'test.epub'));

    // Transient import requires string file path
    const result = await service.importBook('/path/to/test.epub', books, { transient: true });

    // Should create a new entry, not override existing
    expect(result).not.toBe(existingBook);
  });

  it('should promote extracted ISBN into metadata.isbn during import', async () => {
    const books: Book[] = [];

    mockPartialMD5.mockResolvedValue('new-hash-456');
    setupMockBookDoc({
      ...TEST_METADATA,
      identifier: 'calibre:abc123',
      altIdentifier: ['urn:isbn:9780316033664', 'mobi-asin:B004J4XGN6'],
    });

    const mockFile = new File(['new content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books);
    expect(result).not.toBeNull();
    if (!result) {
      throw new Error('Expected importBook to return an imported book');
    }

    expect(result.metadata?.isbn).toBe('9780316033664');
  });
});

describe('importBook metaHash aggregation', () => {
  let service: TestAppService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(false);
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockClear();
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
  });

  it('keeps every unverified metadata match for explicit review', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const book1 = makeBook({ hash: 'hash-1', metaHash });
    const book2 = makeBook({ hash: 'hash-2', metaHash });
    const book3 = makeBook({ hash: 'hash-3', metaHash });
    const unrelated = makeBook({ hash: 'other', metaHash: 'different' });
    const books: Book[] = [book1, book2, book3, unrelated];

    mockPartialMD5.mockResolvedValue('new-hash');
    setupMockBookDoc();

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    await service.importBook(mockFile, books);

    const active = books.filter((b) => b.metaHash === metaHash && !b.deletedAt);
    expect(active).toHaveLength(4);
    expect(book1.hash).toBe('hash-1');
    expect(book2.deletedAt).toBeNull();
    expect(book3.deletedAt).toBeNull();
    expect(unrelated.deletedAt).toBeNull();
  });

  it('does not select another version merely because its progress is higher', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const book1 = makeBook({ hash: 'hash-1', metaHash });
    const book2 = makeBook({ hash: 'hash-2', metaHash });
    const book3 = makeBook({ hash: 'hash-3', metaHash });
    const books: Book[] = [book1, book2, book3];

    mockPartialMD5.mockResolvedValue('new-hash');
    setupMockBookDoc();

    const fs = service.getFs();
    fs.exists.mockImplementation(async (path: string) => {
      if (path.endsWith('/config.json')) return true;
      if (['hash-1', 'hash-2', 'hash-3'].includes(path)) return true;
      return false;
    });
    fs.readFile.mockImplementation(async (path: string) => {
      if (path === 'hash-1/config.json')
        return JSON.stringify({ updatedAt: 3000, progress: [10, 200], location: 'loc1' });
      if (path === 'hash-2/config.json')
        return JSON.stringify({ updatedAt: 1000, progress: [50, 200], location: 'loc2' });
      if (path === 'hash-3/config.json')
        return JSON.stringify({ updatedAt: 2000, progress: [30, 200], location: 'loc3' });
      return '{}';
    });

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    await service.importBook(mockFile, books);

    expect(fs.writeFile.mock.calls.filter((c) => String(c[0]).endsWith('/config.json'))).toEqual(
      [],
    );
    for (const hash of ['hash-1', 'hash-2', 'hash-3']) {
      expect(fs.readFile).not.toHaveBeenCalledWith(`${hash}/config.json`, 'Books', 'text');
    }
    expect(fs.removeDir).not.toHaveBeenCalled();
  });

  it('does not resolve conflicting notes across versions by timestamp', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const book1 = makeBook({ hash: 'hash-1', metaHash });
    const book2 = makeBook({ hash: 'hash-2', metaHash });
    const books: Book[] = [book1, book2];

    mockPartialMD5.mockResolvedValue('new-hash');
    setupMockBookDoc();

    const fs = service.getFs();
    fs.exists.mockImplementation(async (path: string) => {
      if (path.endsWith('/config.json')) return true;
      if (['hash-1', 'hash-2'].includes(path)) return true;
      return false;
    });
    fs.readFile.mockImplementation(async (path: string) => {
      if (path === 'hash-1/config.json')
        return JSON.stringify({
          updatedAt: 1000,
          progress: [80, 200],
          booknotes: [
            {
              id: 'note-a',
              type: 'annotation',
              cfi: 'cfi-a',
              note: 'A',
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'note-shared',
              type: 'annotation',
              cfi: 'cfi-s',
              note: 'old',
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        });
      if (path === 'hash-2/config.json')
        return JSON.stringify({
          updatedAt: 2000,
          progress: [20, 200],
          booknotes: [
            { id: 'note-b', type: 'bookmark', cfi: 'cfi-b', note: 'B', createdAt: 2, updatedAt: 2 },
            {
              id: 'note-shared',
              type: 'annotation',
              cfi: 'cfi-s',
              note: 'newer',
              createdAt: 1,
              updatedAt: 5,
            },
          ],
        });
      return '{}';
    });

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    await service.importBook(mockFile, books);

    expect(fs.writeFile.mock.calls.filter((c) => String(c[0]).endsWith('/config.json'))).toEqual(
      [],
    );
    expect(fs.removeDir).not.toHaveBeenCalled();
    expect(books.filter((b) => !b.deletedAt)).toHaveLength(3);
  });

  it('does not treat missing progress as permission to replace a version', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const book1 = makeBook({ hash: 'hash-1', metaHash });
    const book2 = makeBook({ hash: 'hash-2', metaHash });
    const books: Book[] = [book1, book2];

    mockPartialMD5.mockResolvedValue('new-hash');
    setupMockBookDoc();

    const fs = service.getFs();
    fs.exists.mockImplementation(async (path: string) => {
      if (path.endsWith('/config.json')) return true;
      if (['hash-1', 'hash-2'].includes(path)) return true;
      return false;
    });
    fs.readFile.mockImplementation(async (path: string) => {
      if (path === 'hash-1/config.json')
        return JSON.stringify({ updatedAt: 1000, location: 'loc1' });
      if (path === 'hash-2/config.json')
        return JSON.stringify({ updatedAt: 2000, progress: [5, 100], location: 'loc2' });
      return '{}';
    });

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    await service.importBook(mockFile, books);

    expect(fs.writeFile.mock.calls.filter((c) => String(c[0]).endsWith('/config.json'))).toEqual(
      [],
    );
    expect(book1.deletedAt).toBeNull();
    expect(book2.deletedAt).toBeNull();
  });

  it('should not aggregate books with different formats', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const epubBook = makeBook({ hash: 'epub-hash', metaHash });
    const pdfBook = makeBook({
      hash: 'pdf-hash',
      metaHash,
      format: 'PDF' as Book['format'],
    });
    const books: Book[] = [epubBook, pdfBook];

    mockPartialMD5.mockResolvedValue('new-hash');
    setupMockBookDoc(); // Opens as EPUB

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    await service.importBook(mockFile, books);

    // PDF book should not be soft-deleted (different format)
    expect(pdfBook.deletedAt).toBeNull();
    // EPUB book should survive (promoted as existing, not a duplicate of itself)
    expect(epubBook.deletedAt).toBeNull();
  });

  it('retains directories of unverified metadata matches', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const book1 = makeBook({ hash: 'hash-1', metaHash });
    const book2 = makeBook({ hash: 'hash-2', metaHash });
    const book3 = makeBook({ hash: 'hash-3', metaHash });
    const books: Book[] = [book1, book2, book3];

    mockPartialMD5.mockResolvedValue('new-hash');
    setupMockBookDoc();

    const fs = service.getFs();
    fs.exists.mockImplementation(async (path: string) => {
      return ['hash-2', 'hash-3'].includes(path);
    });

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    await service.importBook(mockFile, books);

    expect(book2.deletedAt).toBeNull();
    expect(book3.deletedAt).toBeNull();
    expect(fs.removeDir).not.toHaveBeenCalled();
  });

  it('reuses verified content without removing other metadata matches', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const exactMatch = makeBook({ hash: 'exact-hash', metaHash });
    exactMatch.contentFingerprint = await fingerprintFile(new File(['content'], 'test.epub'));
    const dup1 = makeBook({ hash: 'dup-1', metaHash });
    const dup2 = makeBook({ hash: 'dup-2', metaHash });
    const books: Book[] = [exactMatch, dup1, dup2];

    mockPartialMD5.mockResolvedValue('exact-hash');
    setupMockBookDoc();

    const fs = service.getFs();
    fs.exists.mockImplementation(async (path: string) => {
      return ['dup-1', 'dup-2'].includes(path);
    });

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books);

    expect(result).toBe(exactMatch);
    expect(exactMatch.deletedAt).toBeNull();
    expect(dup1.deletedAt).toBeNull();
    expect(dup2.deletedAt).toBeNull();
  });

  it('keeps the verified record config and other version notes untouched', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);

    const exactMatch = makeBook({ hash: 'exact-hash', metaHash });
    exactMatch.contentFingerprint = await fingerprintFile(new File(['content'], 'test.epub'));
    const dup = makeBook({ hash: 'dup-hash', metaHash });
    const books: Book[] = [exactMatch, dup];

    mockPartialMD5.mockResolvedValue('exact-hash');
    setupMockBookDoc();

    const fs = service.getFs();
    fs.exists.mockImplementation(async (path: string) => {
      if (path.endsWith('/config.json')) return true;
      if (path === 'dup-hash') return true;
      return false;
    });
    fs.readFile.mockImplementation(async (path: string) => {
      if (path === 'exact-hash/config.json')
        return JSON.stringify({
          updatedAt: 1000,
          progress: [10, 100],
          booknotes: [
            { id: 'n1', type: 'annotation', cfi: 'c1', note: 'x', createdAt: 1, updatedAt: 1 },
          ],
        });
      if (path === 'dup-hash/config.json')
        return JSON.stringify({
          updatedAt: 5000,
          progress: [70, 100],
          location: 'newer',
          booknotes: [
            { id: 'n2', type: 'bookmark', cfi: 'c2', note: 'y', createdAt: 2, updatedAt: 2 },
          ],
        });
      return '{}';
    });

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    await service.importBook(mockFile, books);

    expect(fs.writeFile.mock.calls.filter((c) => String(c[0]).endsWith('/config.json'))).toEqual(
      [],
    );
    expect(fs.removeDir).not.toHaveBeenCalled();
    expect(dup.deletedAt).toBeNull();
  });
});

// PDF title, author and filename cannot establish content identity.
describe('importBook PDF filename-aware dedup', () => {
  let service: TestAppService;

  const PDF_METADATA = {
    title: 'PowerPoint Presentation',
    author: 'Alice Author',
    language: 'en',
  };

  function setupMockPdfDoc() {
    const bookDoc = {
      metadata: { ...PDF_METADATA },
      getCover: vi.fn().mockResolvedValue(null),
    };
    mockOpen.mockResolvedValue({ book: bookDoc, format: 'PDF' });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(false);
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockClear();
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
  });

  it('imports PDFs with identical metadata but different filenames as separate books', async () => {
    const books: Book[] = [];

    mockPartialMD5.mockResolvedValue('pdf-hash-1');
    setupMockPdfDoc();
    const book1 = await service.importBook(
      new File(['slides 1'], 'lecture-01.pdf', { type: 'application/pdf' }),
      books,
    );

    mockPartialMD5.mockResolvedValue('pdf-hash-2');
    setupMockPdfDoc();
    const book2 = await service.importBook(
      new File(['slides 2'], 'lecture-02.pdf', { type: 'application/pdf' }),
      books,
    );

    expect(book2).not.toBe(book1);
    expect(books.filter((b) => !b.deletedAt)).toHaveLength(2);
  });

  it('keeps changed PDF bytes separate despite the same filename and metadata', async () => {
    const books: Book[] = [];

    mockPartialMD5.mockResolvedValue('pdf-hash-1');
    setupMockPdfDoc();
    const book1 = await service.importBook(
      new File(['v1'], 'deck.pdf', { type: 'application/pdf' }),
      books,
    );

    mockPartialMD5.mockResolvedValue('pdf-hash-2');
    setupMockPdfDoc();
    const book2 = await service.importBook(
      new File(['v2'], 'deck.pdf', { type: 'application/pdf' }),
      books,
    );

    expect(book2).not.toBe(book1);
    expect(books.filter((b) => !b.deletedAt)).toHaveLength(2);
    expect(book1!.hash).not.toBe(book2!.hash);
  });

  it('refreshBookMetadata preserves the salted metaHash for PDFs', async () => {
    // The original filename is lost after import (files are stored under the
    // metadata title), so re-parsing the file cannot reproduce the salt and
    // must keep the metaHash stamped at import time.
    const book = makeBook({
      hash: 'pdf-hash-1',
      format: 'PDF' as Book['format'],
      metaHash: 'salted-import-hash',
    });

    const fs = service.getFs();
    fs.exists.mockResolvedValue(true);
    fs.openFile.mockResolvedValue(new File(['pdf'], 'Test Book.pdf'));
    setupMockPdfDoc();

    const refreshed = await refreshBookMetadata(
      fs as unknown as Parameters<typeof refreshBookMetadata>[0],
      book,
    );

    expect(refreshed).toBe(true);
    expect(book.metaHash).toBe('salted-import-hash');
  });
});

describe('importBook with BookLookupIndex', () => {
  let service: TestAppService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(false);
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockClear();
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
  });

  it('updates the lookup index after a successful new-book import', async () => {
    const books: Book[] = [];
    const lookupIndex = buildBookLookupIndex(books);

    mockPartialMD5.mockResolvedValue('imported-hash');
    setupMockBookDoc();

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books, { lookupIndex });

    expect(result).not.toBeNull();
    expect(result?.contentFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(lookupIndex.byHash.get(result!.hash)).toBe(result);
    if (result?.metaHash) {
      const key = `${result.metaHash}:${result.format}`;
      expect(lookupIndex.byMetaKey.get(key)).toContain(result);
    }
  });

  it('does not trust a stale lookup index without a durable or live record', async () => {
    const metaHash = getMetadataHash(TEST_METADATA);
    const existingBook = makeBook({ hash: 'existing', metaHash });
    // Pass an EMPTY books array but a lookup index that already contains the book.
    // If the implementation falls back to books.find(), it will fail to find the
    // existing book and create a new one. If it consults the lookup index, it
    // will discover the existing book and update it.
    const books: Book[] = [];
    const lookupIndex = buildBookLookupIndex([existingBook]);

    mockPartialMD5.mockResolvedValue('existing'); // same hash as existing
    setupMockBookDoc();

    const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
    const result = await service.importBook(mockFile, books, { lookupIndex });

    expect(result).not.toBe(existingBook);
    expect(books).toHaveLength(1);
    expect(existingBook.hash).toBe('existing');
  });

  it('buildBookLookupIndex skips deleted and url-backed books in byFilePath', async () => {
    const inPlaceBook = makeBook({
      hash: 'a',
      filePath: '/lib/a.epub',
    });
    const deletedBook = makeBook({
      hash: 'b',
      filePath: '/lib/b.epub',
      deletedAt: Date.now(),
    });
    const urlBook = makeBook({ hash: 'c', filePath: 'https://example.com/c.epub' });

    const lookupIndex = buildBookLookupIndex([inPlaceBook, deletedBook, urlBook], 'linux');

    expect(lookupIndex.byFilePath.get('/lib/a.epub')).toBe(inPlaceBook);
    expect(lookupIndex.byFilePath.has('/lib/b.epub')).toBe(false);
    expect(lookupIndex.byFilePath.has('https://example.com/c.epub')).toBe(false);
  });
});
