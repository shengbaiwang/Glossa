import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import { openTestLibraryDatabase } from './suites/library-test-database';

const mockOpen = vi.hoisted(() => vi.fn());
const mockPartialMD5 = vi.hoisted(() => vi.fn());
const pdf = vi.hoisted(() => ({ prepare: vi.fn(), supported: false, openCache: vi.fn() }));
vi.mock('@/services/pdfAutoContents', () => ({ preparePDFContents: pdf.prepare }));
vi.mock('@/services/pdfEnhancement', () => ({
  supportsLocalPDF: () => pdf.supported,
  openPDFCache: pdf.openCache,
}));

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
import { refreshBookMetadata } from '@/services/bookService';
import { fingerprintFile } from '@/services/bookIdentity';

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
    return openTestLibraryDatabase(this);
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

const TEST_METADATA = {
  title: 'Test Book',
  author: 'Test Author',
  language: 'en',
  identifier: 'isbn-123',
};

// Validating a PDF opens a pdf.js document (worker + parsed structures + retained
// range chunks). Dropping the reference does NOT release it — the
// dedicated worker survives GC — so importBook must call destroy() or batch
// imports accumulate ~60 MB per PDF until the WebView renderer OOMs (#5387).
describe('importBook BookDoc lifecycle', () => {
  let service: TestAppService;
  let mockDestroy: ReturnType<typeof vi.fn>;

  const setupMockBookDoc = () => {
    mockDestroy = vi.fn();
    const bookDoc = {
      metadata: TEST_METADATA,
      getCover: vi.fn().mockResolvedValue(null),
      destroy: mockDestroy,
    };
    mockOpen.mockResolvedValue({ book: bookDoc, format: 'PDF' });
    return bookDoc;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pdf.supported = false;
    pdf.openCache.mockReset().mockResolvedValue(null);
    pdf.prepare.mockReset().mockResolvedValue('preserved');
    service = new TestAppService();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(false);
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockClear();
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
    mockPartialMD5.mockResolvedValue('hash-abc');
  });

  it.each([
    'ssreader',
    ' SSReader 4.0 ',
    'Untitled',
    'PowerPoint Presentation',
  ])('uses the original filename for a PDF with placeholder title %s', async (title) => {
    const document = setupMockBookDoc();
    document.metadata = { title, author: 'ssreader', language: 'zh', identifier: '' };
    const originalMetadata = structuredClone(document.metadata);
    const book = await service.importBook(new File(['pdf'], '马基雅维里主义.pdf'), []);

    expect(book?.title).toBe('马基雅维里主义');
    expect(book?.author).toBe('');
    expect(book?.sourceTitle).toBe('马基雅维里主义');
    expect(book?.metadata).toEqual(originalMetadata);
  });

  it('displays the original filename and keeps valid bibliographic metadata', async () => {
    const document = setupMockBookDoc();
    document.metadata = {
      title: 'The ssreader Handbook',
      author: 'A. Writer',
      language: 'en',
      identifier: '',
    };
    const book = await service.importBook(new File(['pdf'], 'download-123.pdf'), []);
    expect(book?.title).toBe('download-123');
    expect(book?.originalFilename).toBe('download-123.pdf');
    expect(book?.metadata?.title).toBe('The ssreader Handbook');
    expect(book?.author).toBe('A. Writer');
  });

  it('keeps differently named editions separate even if embedded metadata is identical', async () => {
    const books: Book[] = [];
    mockPartialMD5.mockResolvedValueOnce('edition-1').mockResolvedValueOnce('edition-2');
    for (const name of ['原书（初版）.epub', '原书（修订版）.epub']) {
      const doc = setupMockBookDoc();
      mockOpen.mockResolvedValue({ book: doc, format: 'EPUB' });
      await service.importBook(new File([name], name), books);
    }
    expect(books.filter((book) => !book.deletedAt).map((book) => book.title)).toEqual([
      '原书（初版）',
      '原书（修订版）',
    ]);
    expect(
      service
        .getFs()
        .removeDir.mock.calls.every(([path]) => String(path).startsWith('.importing/')),
    ).toBe(true);
  });

  it('does not collapse distinct books that share invalid metadata', async () => {
    const books: Book[] = [];
    for (const [index, filename] of ['甲书.epub', '乙书.epub'].entries()) {
      mockPartialMD5.mockResolvedValue(`different-${index}`);
      mockOpen.mockResolvedValue({
        book: {
          metadata: { title: 'ssreader', author: 'ssreader', language: 'zh' },
          getCover: vi.fn().mockResolvedValue(null),
        },
        format: 'EPUB',
      });
      await service.importBook(new File([filename], filename), books);
    }
    expect(books.map((book) => book.title)).toEqual(['甲书', '乙书']);
  });

  it('retains same-file metadata, stored filename and personal fields on reimport', async () => {
    const document = setupMockBookDoc();
    document.metadata = { title: 'ssreader', author: 'ssreader', language: 'zh', identifier: '' };
    const existing: Book = {
      hash: 'hash-abc',
      contentFingerprint: await fingerprintFile(new File(['pdf'], 'book.pdf')),
      format: 'PDF',
      title: 'ssreader',
      sourceTitle: 'ssreader',
      author: 'ssreader',
      metadata: { ...document.metadata },
      createdAt: 1000,
      updatedAt: 2000,
      progress: [17, 200],
      groupId: 'personal',
    };
    const book = await service.importBook(new File(['pdf'], '马基雅维里主义.pdf'), [existing]);
    expect(book).toBe(existing);
    expect(book?.title).toBe('ssreader');
    expect(book?.author).toBe('ssreader');
    expect(book?.sourceTitle).toBe('ssreader');
    expect(book?.progress).toEqual([17, 200]);
    expect(book?.groupId).toBe('personal');
    expect(service.getFs().writeFile.mock.calls.map((call) => call[0])).not.toContain(
      'hash-abc/马基雅维里主义.pdf',
    );
  });

  it('does not repair a stored book from a transient preview filename', async () => {
    const document = setupMockBookDoc();
    document.metadata = { title: 'ssreader', author: 'ssreader', language: 'zh', identifier: '' };
    service.getFs().openFile.mockResolvedValue(new File(['pdf'], '临时预览.pdf'));
    const existing: Book = {
      hash: 'hash-abc',
      format: 'PDF',
      title: 'ssreader',
      sourceTitle: 'ssreader',
      author: 'ssreader',
      metadata: { ...document.metadata },
      createdAt: 1000,
      updatedAt: 2000,
    };
    await service.importBook('/临时预览.pdf', [existing], { transient: true });
    expect(existing.title).toBe('ssreader');
    expect(existing.author).toBe('ssreader');
  });

  it('preserves explicitly edited metadata on reimport, even when it resembles a placeholder', async () => {
    const document = setupMockBookDoc();
    document.metadata = { title: 'ssreader', author: 'ssreader', language: 'zh', identifier: '' };
    const existing: Book = {
      hash: 'hash-abc',
      contentFingerprint: await fingerprintFile(new File(['pdf'], 'book.pdf')),
      format: 'PDF',
      title: 'ssreader',
      sourceTitle: 'ssreader',
      author: 'ssreader',
      metadata: { ...document.metadata },
      metadataUpdatedAt: 1500,
      createdAt: 1000,
      updatedAt: 2000,
    };
    const book = await service.importBook(new File(['pdf'], '原文件名.pdf'), [existing]);
    expect(book?.title).toBe('ssreader');
    expect(book?.author).toBe('ssreader');
  });

  it('destroys the loaded BookDoc after a successful import', async () => {
    setupMockBookDoc();
    const books: Book[] = [];
    const mockFile = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });

    const result = await service.importBook(mockFile, books);

    expect(result).not.toBeNull();
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledTimes(1));
  });

  it('skips the PDF plugin before opening files when disabled', async () => {
    pdf.supported = true;
    useSettingsStore.setState({
      settings: { officialModules: { pdfAutoContents: false } } as SystemSettings,
    });
    const resolve = vi.spyOn(service, 'resolveNativeBookFilePath');
    try {
      await service.prepareBookContents({ format: 'PDF' } as Book);
      expect(resolve).not.toHaveBeenCalled();
      expect(pdf.prepare).not.toHaveBeenCalled();
    } finally {
      useSettingsStore.setState({ settings: {} as SystemSettings });
    }
  });

  it('skips import preparation when the plugin import setting is off', async () => {
    pdf.supported = true;
    useSettingsStore.setState({ settings: { pdfContentsOnImport: false } as SystemSettings });
    const resolve = vi.spyOn(service, 'resolveNativeBookFilePath');
    try {
      await service.prepareBookContents({ format: 'PDF' } as Book);
      expect(resolve).not.toHaveBeenCalled();
      expect(pdf.prepare).not.toHaveBeenCalled();
    } finally {
      useSettingsStore.setState({ settings: {} as SystemSettings });
    }
  });

  it('releases the import parser before separately opening the background document', async () => {
    const document = setupMockBookDoc();
    const backgroundDestroy = vi.fn();
    const background = { ...document, destroy: backgroundDestroy };
    mockOpen.mockResolvedValueOnce({ book: document, format: 'PDF' });
    mockOpen.mockResolvedValue({ book: background, format: 'PDF' });
    pdf.supported = true;
    vi.spyOn(service, 'resolveNativeBookFilePath').mockResolvedValue('/managed/original.pdf');
    vi.spyOn(service, 'loadBookContent').mockResolvedValue({
      book: {} as Book,
      file: new File(['pdf content'], 'test.pdf'),
    });
    let finish: ((value: string) => void) | undefined;
    pdf.prepare.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );

    const importing = service.importBook(new File(['pdf content'], 'test.pdf'), []);
    let imported: Book | null = null;
    try {
      imported = await importing;
      expect(imported).not.toBeNull();
      await vi.waitFor(() => expect(pdf.prepare).toHaveBeenCalled());
      expect(pdf.prepare).toHaveBeenCalledWith(
        '/managed/original.pdf',
        background,
        expect.any(AbortSignal),
        expect.any(Function),
        { owner: { bookId: imported!.hash, revision: 0 }, regenerate: undefined },
      );
      expect(mockDestroy).toHaveBeenCalledOnce();
      expect(backgroundDestroy).not.toHaveBeenCalled();
    } finally {
      finish?.('generated');
      await importing;
    }
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(backgroundDestroy).toHaveBeenCalledOnce());
  });

  it('discards a late path lookup after disable and immediate re-enable', async () => {
    pdf.supported = true;
    let resolvePath!: (path: string) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(service, 'resolveNativeBookFilePath').mockImplementation(() => {
      started();
      return new Promise<string>((resolve) => {
        resolvePath = resolve;
      });
    });
    const task = service.prepareBookContents({ format: 'PDF' } as Book);
    await ready;
    useSettingsStore.setState({
      settings: { officialModules: { pdfAutoContents: false } } as SystemSettings,
    });
    useSettingsStore.setState({ settings: {} as SystemSettings });
    resolvePath('/managed/original.pdf');
    await task;
    expect(pdf.openCache).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
    expect(pdf.prepare).not.toHaveBeenCalled();
  });

  it('cancels active preparation on disable and never restarts it on enable', async () => {
    const document = setupMockBookDoc();
    const backgroundDestroy = vi.fn();
    mockOpen.mockResolvedValueOnce({ book: document, format: 'PDF' });
    mockOpen.mockResolvedValue({
      book: { ...document, destroy: backgroundDestroy },
      format: 'PDF',
    });
    pdf.supported = true;
    vi.spyOn(service, 'resolveNativeBookFilePath').mockResolvedValue('/managed/original.pdf');
    vi.spyOn(service, 'loadBookContent').mockResolvedValue({
      book: {} as Book,
      file: new File(['pdf content'], 'test.pdf'),
    });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let signal!: AbortSignal;
    pdf.prepare.mockImplementation(async (_source, _doc, value: AbortSignal) => {
      signal = value;
      started();
      await new Promise<void>((resolve) =>
        value.addEventListener('abort', () => resolve(), { once: true }),
      );
      throw new DOMException('Cancelled', 'AbortError');
    });
    const importing = service.importBook(new File(['pdf content'], 'test.pdf'), []);
    await ready;
    useSettingsStore.setState({
      settings: { officialModules: { pdfAutoContents: false } } as SystemSettings,
    });
    useSettingsStore.setState({ settings: {} as SystemSettings });
    expect(signal.aborted).toBe(true);
    expect(await importing).not.toBeNull();
    expect(pdf.prepare).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(backgroundDestroy).toHaveBeenCalledOnce());
  });

  it('keeps the book and releases its parser if automatic contents preparation fails', async () => {
    const document = setupMockBookDoc();
    const backgroundDestroy = vi.fn();
    mockOpen.mockResolvedValueOnce({ book: document, format: 'PDF' });
    mockOpen.mockResolvedValue({
      book: { ...document, destroy: backgroundDestroy },
      format: 'PDF',
    });
    pdf.supported = true;
    vi.spyOn(service, 'resolveNativeBookFilePath').mockResolvedValue('/managed/original.pdf');
    vi.spyOn(service, 'loadBookContent').mockResolvedValue({
      book: {} as Book,
      file: new File(['pdf content'], 'test.pdf'),
    });
    pdf.prepare.mockRejectedValue(new Error('pdf_processing_limit'));
    expect(await service.importBook(new File(['pdf content'], 'test.pdf'), [])).not.toBeNull();
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(backgroundDestroy).toHaveBeenCalledOnce());
  });

  it('retries an existing PDF without importing it again and releases its parser and file handle', async () => {
    const document = setupMockBookDoc();
    pdf.supported = true;
    const close = vi.fn().mockResolvedValue(undefined);
    const file = Object.assign(new File(['pdf'], 'existing.pdf'), { close });
    const book = { hash: 'existing', format: 'PDF', title: 'Existing', author: '' } as Book;
    vi.spyOn(service, 'resolveNativeBookFilePath').mockResolvedValue('/managed/existing.pdf');
    vi.spyOn(service, 'loadBookContent').mockResolvedValue({ book, file });
    pdf.prepare.mockRejectedValue(new Error('pdf_recognition_failed'));
    await service.prepareBookContents(book);
    expect(pdf.prepare).toHaveBeenCalledWith(
      '/managed/existing.pdf',
      document,
      expect.any(AbortSignal),
      expect.any(Function),
      { owner: { bookId: book.hash, revision: 0 }, regenerate: undefined },
    );
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledOnce());
    expect(close).toHaveBeenCalledOnce();
    expect(service.getFs().writeFile).not.toHaveBeenCalled();
  });

  it.each([
    { outline: [], revision: 1 },
    { outline: null, revision: 1 },
    { outline: [{ title: 'My chapter', pageIndex: 2, level: 0 }], revision: 0 },
    {
      outline: [{ title: 'Verified chapter', pageIndex: 2, level: 0 }],
      revision: 1,
      generator: 'glossa-contents-3',
    },
  ])('preserves a saved personal or verified outline on explicit re-import: %j', async (cache) => {
    pdf.supported = true;
    pdf.openCache.mockResolvedValue(cache);
    vi.spyOn(service, 'resolveNativeBookFilePath').mockResolvedValue('/managed/existing.pdf');
    const load = vi.spyOn(service, 'loadBookContent');
    await service.prepareBookContents({ format: 'PDF' } as Book);
    expect(load).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
    expect(pdf.prepare).not.toHaveBeenCalled();
  });

  it('keeps the imported book if resolving its optional native preparation path fails', async () => {
    setupMockBookDoc();
    pdf.supported = true;
    vi.spyOn(service, 'resolveNativeBookFilePath').mockRejectedValue(new Error('unavailable'));
    expect(await service.importBook(new File(['pdf content'], 'test.pdf'), [])).not.toBeNull();
    expect(pdf.prepare).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledOnce());
  });

  it('does not run preparation for a transient preview', async () => {
    setupMockBookDoc();
    pdf.supported = true;
    service.getFs().openFile.mockResolvedValue(new File(['pdf content'], 'test.pdf'));
    await service.importBook('/original.pdf', [], { transient: true });
    expect(pdf.prepare).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mockDestroy).toHaveBeenCalledOnce());
  });

  it('destroys the loaded BookDoc when the import fails after opening', async () => {
    setupMockBookDoc();
    service.getFs().createDir.mockRejectedValue(new Error('disk full'));
    const mockFile = new File(['pdf content'], 'test.pdf', { type: 'application/pdf' });

    await expect(service.importBook(mockFile, [])).rejects.toThrow();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('imports normally when the BookDoc has no destroy method', async () => {
    mockOpen.mockResolvedValue({
      book: { metadata: TEST_METADATA, getCover: vi.fn().mockResolvedValue(null) },
      format: 'EPUB',
    });
    const books: Book[] = [];
    const mockFile = new File(['epub content'], 'test.epub', { type: 'application/epub+zip' });

    const result = await service.importBook(mockFile, books);

    expect(result).not.toBeNull();
    expect(books.length).toBe(1);
  });

  it('destroys the BookDoc opened by refreshBookMetadata', async () => {
    const bookDoc = setupMockBookDoc();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(true);
    fs.readFile.mockResolvedValue(new ArrayBuffer(8));
    const book: Book = {
      hash: 'hash-abc',
      format: 'PDF',
      title: 'Test Book',
      sourceTitle: 'Test Book',
      author: 'Test Author',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
    };

    // loadBookContent goes through appService.loadBookContent → fs.openFile
    fs.openFile.mockResolvedValue(new File(['pdf content'], 'test.pdf'));

    const refreshed = await refreshBookMetadata(service.getFs() as never, book);

    expect(refreshed).toBe(true);
    expect(bookDoc.destroy).toHaveBeenCalledTimes(1);
  });
});
