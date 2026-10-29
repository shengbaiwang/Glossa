import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FoliateView } from '@/types/view';

vi.mock('@/store/bookDataStore', async () => {
  const { create } = await import('zustand');
  return {
    useBookDataStore: create(() => ({
      booksData: {} as Record<string, unknown>,
    })),
  };
});

vi.mock('@/store/settingsStore', () => {
  const { create } = require('zustand');
  return {
    useSettingsStore: create(() => ({
      settings: {},
    })),
  };
});

vi.mock('@/store/libraryStore', () => {
  const { create } = require('zustand');
  return {
    useLibraryStore: create(() => ({
      library: [],
      hashIndex: new Map(),
      setLibrary: vi.fn(),
      getBookByHash: vi.fn(),
      updateBookProgress: vi.fn(),
      rebuildHashIndex: vi.fn(),
    })),
  };
});

vi.mock('@/utils/misc', () => ({
  uniqueId: vi.fn(() => 'mock-uid-123'),
}));

// These are transitive imports needed by readerStore
vi.mock('@/services/nav', () => ({
  updateToc: vi.fn(),
  computeBookNav: vi.fn().mockResolvedValue({ version: 4, toc: [], sections: {} }),
  hydrateBookNav: vi.fn(),
  isBookNavCacheCurrent: (nav: { version: number } | null) => nav?.version === 4,
}));
vi.mock('@/utils/book', () => ({
  formatTitle: vi.fn((t: string) => t),
  getMetadataHash: vi.fn(() => 'hash'),
  getPrimaryLanguage: vi.fn(() => 'en'),
}));
vi.mock('@/utils/path', () => ({
  getBaseFilename: vi.fn((n: string) => n),
}));
vi.mock('@/services/constants', () => ({
  SUPPORTED_LANGNAMES: {},
}));
vi.mock('@/libs/document', () => ({
  DocumentLoader: vi.fn(),
}));
vi.mock('@/services/opds/pseStream', () => ({
  isPseStreamFileName: () => false,
  openPseStreamBook: vi.fn(),
  parsePseStreamFileName: vi.fn(),
}));
vi.mock('@/services/rss/feedBookUrl', () => ({
  isFeedBookUrl: () => false,
  parseFeedBookUrl: vi.fn(),
}));
vi.mock('@/services/rss/feedReader', () => ({
  openFeedBookDoc: vi.fn(),
}));

import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';

import { computeBookNav, hydrateBookNav, updateToc } from '@/services/nav';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import { DocumentLoader } from '@/libs/document';

const key = 'cached-1';
let app: AppService;
let doc: BookDoc;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useReaderStore.getState().clearViewState(key);
  doc = {
    metadata: { title: 'Original' },
    rendition: {},
    sections: [],
    toc: [{ label: 'Original', href: 'c.xhtml#start' }],
    splitTOCHref: (href: string) => href.split('#'),
  } as unknown as BookDoc;
  const book = { hash: 'cached', format: 'EPUB', title: 'Original' } as Book;
  useLibraryStore.getState().getBookByHash = vi.fn(() => book);
  useBookDataStore.setState({
    booksData: {
      cached: {
        id: 'cached',
        book,
        bookDoc: doc,
        file: new File(['original'], 'book.epub'),
        config: { updatedAt: 1, viewSettings: {}, booknotes: [] },
        isFixedLayout: false,
      },
    },
  });
  useSettingsStore.setState({ settings: { globalViewSettings: {} } as never });
  app = {
    getBookNavSource: vi.fn().mockResolvedValue('source-1'),
    loadBookConfig: vi.fn().mockResolvedValue({ viewSettings: {}, booknotes: [] }),
    loadBookNav: vi.fn().mockResolvedValue(null),
    saveBookNav: vi.fn().mockResolvedValue(undefined),
  } as unknown as AppService;
  vi.mocked(computeBookNav).mockResolvedValue({ version: 4, toc: [], sections: {} });
  vi.mocked(hydrateBookNav).mockImplementation(() => {});
  vi.mocked(updateToc).mockResolvedValue(undefined);
});
afterEach(() => {
  useReaderStore.getState().clearViewState(key);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
const open = () =>
  useReaderStore.getState().initViewState({ getAppService: async () => app }, 'cached', key);
const show = async () => {
  useReaderStore.getState().setViewInited(key, true);
  await vi.runAllTimersAsync();
};

describe('navigation on reader startup', () => {
  test('uses a valid cache in development without computing or rewriting', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const cache = { version: 4, source: 'source-1', toc: [], sections: {} };
    vi.mocked(app.loadBookNav).mockResolvedValue(cache);
    await open();
    await show();
    expect(hydrateBookNav).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: doc.metadata }),
      cache,
    );
    expect(computeBookNav).not.toHaveBeenCalled();
    expect(app.saveBookNav).not.toHaveBeenCalled();
  });
  test('opens on the original TOC before computing, then refreshes navigation without remounting', async () => {
    await open();
    expect(computeBookNav).not.toHaveBeenCalled();
    expect(useReaderStore.getState().getViewState(key)?.loading).toBe(false);
    const viewerKey = useReaderStore.getState().getViewState(key)?.viewerKey;
    const view = {
      book: doc,
      updateTOC: vi.fn().mockResolvedValue(undefined),
    } as unknown as FoliateView;
    useReaderStore.getState().setView(key, view);
    await show();
    expect(computeBookNav).toHaveBeenCalledTimes(1);
    expect(view.updateTOC).toHaveBeenCalledTimes(1);
    expect(app.saveBookNav).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: 'source-1' }),
    );
    expect(useReaderStore.getState().getViewState(key)?.viewerKey).toBe(viewerKey);
  });
  test('cancels queued work when the view closes before the first page', async () => {
    await open();
    useReaderStore.getState().clearViewState(key);
    await vi.runAllTimersAsync();
    expect(computeBookNav).not.toHaveBeenCalled();
    expect(app.saveBookNav).not.toHaveBeenCalled();
  });
  test('does not publish or save a late result after closing', async () => {
    let finish!: (nav: never) => void;
    vi.mocked(computeBookNav).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await open();
    await show();
    expect(computeBookNav).toHaveBeenCalledTimes(1);
    useReaderStore.getState().clearViewState(key);
    finish({ version: 4, toc: [], sections: {} } as never);
    await vi.runAllTimersAsync();
    expect(hydrateBookNav).not.toHaveBeenCalled();
    expect(app.saveBookNav).not.toHaveBeenCalled();
    expect(useReaderStore.getState().getViewState(key)).toBeNull();
  });
  test('discards enhancement if the source changes while it is being built', async () => {
    vi.mocked(app.getBookNavSource).mockResolvedValueOnce('source-1').mockResolvedValue('source-2');
    await open();
    await show();
    expect(computeBookNav).toHaveBeenCalledTimes(1);
    expect(hydrateBookNav).not.toHaveBeenCalled();
    expect(app.saveBookNav).not.toHaveBeenCalled();
    expect(doc.toc?.[0]?.label).toBe('Original');
  });
  test('does not start duplicate whole-book work when a secondary joins the primary', async () => {
    const secondKey = 'cached-2';
    await open();
    try {
      await useReaderStore
        .getState()
        .initViewState({ getAppService: async () => app }, 'cached', secondKey, false);
      useReaderStore.getState().setViewInited(secondKey, true);
      await show();
      expect(computeBookNav).toHaveBeenCalledTimes(1);
    } finally {
      useReaderStore.getState().clearViewState(secondKey);
    }
  });
  test('shares parsing and navigation when the same book opens concurrently in two views', async () => {
    const secondKey = 'cached-2';
    useBookDataStore.setState({ booksData: {} });
    app.loadBookContent = vi.fn().mockResolvedValue({ file: new File(['content'], 'book.epub') });
    app.resolveNativeBookFilePath = vi.fn().mockResolvedValue(null);
    let finish!: (value: { book: BookDoc }) => void;
    const pending: Array<(value: { book: BookDoc }) => void> = [];
    const parse = vi.fn(
      () =>
        new Promise<{ book: BookDoc }>((resolve) => {
          finish = resolve;
          pending.push(resolve);
        }),
    );
    vi.mocked(DocumentLoader).mockImplementation(function () {
      return { open: parse } as unknown as DocumentLoader;
    });
    const primary = open();
    const secondary = useReaderStore
      .getState()
      .initViewState({ getAppService: async () => app }, 'cached', secondKey, false);
    try {
      await vi.waitFor(() => expect(parse).toHaveBeenCalled());
      expect(parse).toHaveBeenCalledTimes(1);
      finish({ book: doc });
      await Promise.all([primary, secondary]);
      expect(DocumentLoader).toHaveBeenCalledTimes(1);
      useReaderStore.getState().setViewInited(key, true);
      useReaderStore.getState().setViewInited(secondKey, true);
      await vi.runAllTimersAsync();
      expect(computeBookNav).toHaveBeenCalledTimes(1);
    } finally {
      // Also release a failing pre-fix parse, so this regression does not leave
      // an unresolved initialization behind for later tests.
      pending.forEach((resolve) => resolve({ book: doc }));
      await Promise.all([primary, secondary]);
      useReaderStore.getState().clearViewState(secondKey);
    }
  });
  test('does not downgrade an enhanced shared document when opening a secondary without a cache source', async () => {
    const secondKey = 'cached-2';
    vi.mocked(app.getBookNavSource).mockResolvedValue(null);
    vi.mocked(hydrateBookNav).mockImplementation((staged) => {
      staged.toc = [{ label: 'Enhanced chapter', href: 'c.xhtml#deep' } as never];
    });
    await open();
    await show();
    expect(doc.toc?.[0]?.label).toBe('Enhanced chapter');
    try {
      await useReaderStore
        .getState()
        .initViewState({ getAppService: async () => app }, 'cached', secondKey, false);
      useReaderStore.getState().setViewInited(secondKey, true);
      await vi.runAllTimersAsync();
      expect(doc.toc?.[0]?.label).toBe('Enhanced chapter');
      expect(computeBookNav).toHaveBeenCalledTimes(1);
    } finally {
      useReaderStore.getState().clearViewState(secondKey);
    }
  });
  test('finishes shared navigation for a surviving secondary after the primary closes', async () => {
    const secondKey = 'cached-2';
    let finish!: (nav: never) => void;
    vi.mocked(computeBookNav).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await open();
    await useReaderStore
      .getState()
      .initViewState({ getAppService: async () => app }, 'cached', secondKey, false);
    const view = {
      book: doc,
      updateTOC: vi.fn().mockResolvedValue(undefined),
    } as unknown as FoliateView;
    useReaderStore.getState().setView(secondKey, view);
    try {
      await show();
      useReaderStore.getState().setViewInited(secondKey, true);
      await vi.runAllTimersAsync();
      useReaderStore.getState().clearViewState(key);
      finish({ version: 4, toc: [], sections: {} } as never);
      await vi.runAllTimersAsync();
      expect(computeBookNav).toHaveBeenCalledTimes(1);
      expect(view.updateTOC).toHaveBeenCalledTimes(1);
      expect(app.saveBookNav).toHaveBeenCalledTimes(1);
    } finally {
      useReaderStore.getState().clearViewState(secondKey);
    }
  });
  test('does not retain navigation ownership after a secondary fails to initialize', async () => {
    const secondKey = 'cached-2';
    let finish!: (nav: never) => void;
    vi.mocked(computeBookNav).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await open();
    vi.mocked(updateToc).mockRejectedValueOnce(new Error('label conversion unavailable'));
    try {
      await expect(
        useReaderStore
          .getState()
          .initViewState({ getAppService: async () => app }, 'cached', secondKey, false),
      ).rejects.toThrow('label conversion unavailable');
      await show();
      useReaderStore.getState().clearViewState(key);
      finish({ version: 4, toc: [], sections: {} } as never);
      await vi.runAllTimersAsync();
      expect(hydrateBookNav).not.toHaveBeenCalled();
      expect(app.saveBookNav).not.toHaveBeenCalled();
    } finally {
      useReaderStore.getState().clearViewState(secondKey);
    }
  });
  test('lets a queued secondary open and enhance after a cancelled primary releases its document', async () => {
    const secondKey = 'cached-2';
    useBookDataStore.setState({ booksData: {} });
    const firstFile = Object.assign(new File(['original'], 'book.epub'), { close: vi.fn() });
    const nextFile = new File(['original'], 'book.epub');
    app.loadBookContent = vi
      .fn()
      .mockResolvedValueOnce({ file: firstFile })
      .mockResolvedValueOnce({ file: nextFile });
    app.resolveNativeBookFilePath = vi.fn().mockResolvedValue(null);
    const destroy = vi.fn();
    const abandoned = { ...doc, destroy };
    let finish!: (value: { book: BookDoc }) => void;
    const parse = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ book: BookDoc }>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ book: doc });
    vi.mocked(DocumentLoader).mockImplementation(function () {
      return { open: parse } as unknown as DocumentLoader;
    });
    const primary = open();
    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    const secondary = useReaderStore
      .getState()
      .initViewState({ getAppService: async () => app }, 'cached', secondKey, false);
    try {
      useReaderStore.getState().clearViewState(key);
      finish({ book: abandoned });
      await Promise.all([primary, secondary]);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(firstFile.close).toHaveBeenCalledTimes(1);
      expect(useBookDataStore.getState().booksData['cached']?.bookDoc).toBe(doc);
      useReaderStore.getState().setViewInited(secondKey, true);
      await vi.runAllTimersAsync();
      expect(computeBookNav).toHaveBeenCalledTimes(1);
      expect(app.saveBookNav).toHaveBeenCalledTimes(1);
    } finally {
      useReaderStore.getState().clearViewState(secondKey);
    }
  });
  test('does not reuse completed navigation when reopening from a changed source', async () => {
    const secondKey = 'cached-2';
    vi.mocked(hydrateBookNav).mockImplementation((staged) => {
      staged.toc = [{ label: `${staged.metadata.title} enhanced`, href: 'c.xhtml#deep' } as never];
    });
    await open();
    await show();
    expect(doc.toc?.[0]?.label).toBe('Original enhanced');
    const nextDoc = {
      ...doc,
      metadata: { ...doc.metadata, title: 'Replacement' },
      toc: [{ label: 'Replacement raw', href: 'c.xhtml#new' }],
    } as BookDoc;
    vi.mocked(app.getBookNavSource).mockResolvedValue('source-2');
    app.loadBookContent = vi
      .fn()
      .mockResolvedValue({ file: new File(['new source'], 'book.epub') });
    app.resolveNativeBookFilePath = vi.fn().mockResolvedValue(null);
    vi.mocked(DocumentLoader).mockImplementation(function () {
      return { open: async () => ({ book: nextDoc }) } as unknown as DocumentLoader;
    });
    try {
      await useReaderStore
        .getState()
        .initViewState({ getAppService: async () => app }, 'cached', secondKey, false);
      expect(useBookDataStore.getState().booksData['cached']?.bookDoc).toBe(nextDoc);
      expect(nextDoc.toc?.[0]?.label).toBe('Replacement raw');
      useReaderStore.getState().setViewInited(secondKey, true);
      await vi.runAllTimersAsync();
      expect(nextDoc.toc?.[0]?.label).toBe('Replacement enhanced');
      expect(doc.toc?.[0]?.label).toBe('Original enhanced');
      expect(app.saveBookNav).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ source: 'source-2' }),
      );
    } finally {
      useReaderStore.getState().clearViewState(secondKey);
    }
  });
  test('does not resurrect initialization that completed after closing', async () => {
    let resolve!: (value: AppService) => void;
    const opened = useReaderStore.getState().initViewState(
      {
        getAppService: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
      'cached',
      key,
    );
    useReaderStore.getState().clearViewState(key);
    resolve(app);
    await opened;
    expect(useReaderStore.getState().getViewState(key)).toBeNull();
    expect(app.loadBookConfig).not.toHaveBeenCalled();
  });
  test('releases newly opened resources when parsing finishes after closing', async () => {
    useBookDataStore.setState({ booksData: {} });
    const file = Object.assign(new File(['content'], 'book.epub'), { close: vi.fn() });
    const destroy = vi.fn();
    const loadedDoc = { ...doc, destroy };
    let finish!: (value: { book: BookDoc }) => void;
    const parse = vi.fn(
      () =>
        new Promise<{ book: BookDoc }>((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(DocumentLoader).mockImplementation(function () {
      return { open: parse } as unknown as DocumentLoader;
    });
    app.loadBookContent = vi.fn().mockResolvedValue({ file });
    app.resolveNativeBookFilePath = vi.fn().mockResolvedValue(null);
    const opened = open();
    await vi.waitFor(() => expect(parse).toHaveBeenCalled());
    useReaderStore.getState().clearViewState(key);
    finish({ book: loadedDoc });
    await opened;
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(file.close).toHaveBeenCalledTimes(1);
    expect(useBookDataStore.getState().booksData['cached']).toBeUndefined();
    expect(useReaderStore.getState().getViewState(key)).toBeNull();
  });
  test('binds a newly downloaded source before parsing and can cache its navigation', async () => {
    useBookDataStore.setState({ booksData: {} });
    vi.mocked(app.getBookNavSource)
      .mockResolvedValueOnce(null)
      .mockResolvedValue('downloaded-source');
    app.loadBookContent = vi.fn().mockResolvedValue({ file: new File(['content'], 'book.epub') });
    app.resolveNativeBookFilePath = vi.fn().mockResolvedValue(null);
    vi.mocked(DocumentLoader).mockImplementation(function () {
      expect(app.getBookNavSource).toHaveBeenCalledTimes(2);
      return { open: async () => ({ book: doc }) } as unknown as DocumentLoader;
    });
    await open();
    await show();
    expect(app.saveBookNav).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: 'downloaded-source' }),
    );
  });
  test('keeps the readable original document if enhancement fails', async () => {
    vi.mocked(computeBookNav).mockRejectedValue(new Error('damaged nav section'));
    await open();
    await show();
    expect(useReaderStore.getState().getViewState(key)?.error).toBeNull();
    expect(doc.toc?.[0]?.label).toBe('Original');
    expect(app.saveBookNav).not.toHaveBeenCalled();
  });
});
