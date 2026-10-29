import { create } from 'zustand';

import {
  BookContent,
  BookConfig,
  PageInfo,
  BookProgress,
  ViewSettings,
  TimeInfo,
  FIXED_LAYOUT_FORMATS,
} from '@/types/book';
import { Insets } from '@/types/misc';
import { EnvConfigType } from '@/services/environment';
import { FoliateView } from '@/types/view';
import { BookDoc, DocumentLoader, TOCItem } from '@/libs/document';
import {
  isPseStreamFileName,
  openPseStreamBook,
  parsePseStreamFileName,
} from '@/services/opds/pseStream';
import type { FileSystem } from '@/types/system';
import { isFeedBookUrl, parseFeedBookUrl } from '@/services/rss/feedBookUrl';
import { openFeedBookDoc } from '@/services/rss/feedReader';
import { computeBookNav, hydrateBookNav, isBookNavCacheCurrent, updateToc } from '@/services/nav';
import { formatTitle, getMetadataHash, getPrimaryLanguage } from '@/utils/book';
import { getBaseFilename } from '@/utils/path';
import { SUPPORTED_LANGNAMES } from '@/services/constants';
import { useSettingsStore } from './settingsStore';
import { BookData, useBookDataStore } from './bookDataStore';
import { useLibraryStore } from './libraryStore';
import { clearBookProgress, getBookProgress, setBookProgress } from './readerProgressStore';
import { uniqueId } from '@/utils/misc';
import { cloneTocItems } from '@/services/nav/grouping';
import { assertNavActive } from '@/services/nav/scheduling';
import { bakeLocationsAndCfis } from '@/services/nav/locations';

interface NavigationTask {
  controller: AbortController;
  started: number;
  start?: () => void;
}

interface DocumentNavigation {
  controller: AbortController;
  owners: Set<string>;
  complete: boolean;
  start?: () => void;
}

const navigationTasks = new Map<string, NavigationTask>();
const initializingBooks = new Map<string, Promise<void>>();
const documentNavigation = new WeakMap<BookDoc, DocumentNavigation>();
const documentSources = new WeakMap<BookDoc, string | null>();
const originalTocs = new WeakMap<BookDoc, TOCItem[]>();

// Local User Timing only: bounded, without titles, paths or exported telemetry.
const measureReaderPhase = (phase: string, start: number) => {
  try {
    const name = `glossa.reader.${phase}`;
    if (performance.getEntriesByName(name).length >= 32) performance.clearMeasures(name);
    performance.measure(name, { start, end: performance.now() });
  } catch {
    /* Older WebViews may not implement numeric User Timing boundaries. */
  }
};

const cancelNavigation = (key: string) => {
  navigationTasks.get(key)?.controller.abort();
  navigationTasks.delete(key);
};

// Let the restored position paint before beginning optional whole-book work.
const afterReaderPaint = (signal: AbortSignal, run: () => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    if (!signal.aborted) timer = setTimeout(() => !signal.aborted && run(), 0);
  });
  signal.addEventListener(
    'abort',
    () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    },
    { once: true },
  );
};

const navigationCopy = (bookDoc: BookDoc): BookDoc => ({
  ...bookDoc,
  toc: cloneTocItems(bookDoc.toc ?? []),
  sections: bookDoc.sections.map((section) => ({ ...section })),
  splitTOCHref: bookDoc.splitTOCHref.bind(bookDoc),
});

const publishNavigation = (bookDoc: BookDoc, staged: BookDoc) => {
  bookDoc.toc = staged.toc;
  bookDoc.sections.forEach((section, index) => {
    section.fragments = staged.sections[index]?.fragments;
    section.location = staged.sections[index]?.location;
  });
};

interface ViewState {
  /* Unique key for each book view */
  key: string;
  view: FoliateView | null;
  viewerKey: string;
  isPrimary: boolean;
  loading: boolean;
  inited: boolean;
  error: string | null;
  /* `progress` moved to readerProgressStore — see that file's header for
     rationale. Use `useBookProgress(key)` for reactive subscription or
     `getBookProgress(key)` for one-shot reads. */
  ribbonVisible: boolean;
  ttsEnabled: boolean;
  /* True while an Auto Scroll session (#4998) is engaged for this view;
     session-only, never persisted. Drives the View menu checkmark. */
  autoScrollEnabled: boolean;
  syncing: boolean;
  gridInsets: Insets | null;
  /* True while the reader is showing a position requested by an external
     deep link (e.g. ?cfi=...) that the user hasn't yet confirmed by reading.
     Progress writers (auto-save, cloud sync, kosync) skip while this is true
     so the user's actual last-read position isn't overwritten by a preview.
     Cleared on the first user-initiated relocate (page turn / scroll). */
  previewMode: boolean;
  /* View settings for the view:
    generally view settings have a hierarchy of global settings < book settings < view settings
    view settings for primary view are saved to book config which is persisted to config file
    omitting settings that are not changed from global settings */
  viewSettings: ViewSettings | null;
}

interface ReaderStore {
  viewStates: { [key: string]: ViewState };
  bookKeys: string[];
  hoveredBookKey: string | null;
  /* The action tab selected in the mobile bottom bar (font/color/progress);
     lives here rather than in FooterBar state so the TTS mini player can
     stack above the expanded panel. Persists across bar hide/show. */
  bottomBarTab: string;
  setBookKeys: (keys: string[]) => void;
  setHoveredBookKey: (key: string | null) => void;
  setBottomBarTab: (tab: string) => void;
  setBookmarkRibbonVisibility: (key: string, visible: boolean) => void;
  setTTSEnabled: (key: string, enabled: boolean) => void;
  setAutoScrollEnabled: (key: string, enabled: boolean) => void;
  setIsLoading: (key: string, loading: boolean) => void;
  setIsSyncing: (key: string, syncing: boolean) => void;
  setProgress: (
    key: string,
    location: string,
    tocItem: TOCItem,
    pageItem: BookProgress['pageItem'],
    section: PageInfo,
    pageinfo: PageInfo,
    timeinfo: TimeInfo,
    range: Range,
    fraction: number,
  ) => void;
  getProgress: (key: string) => BookProgress | null;
  setView: (key: string, view: FoliateView) => void;
  getView: (key: string | null) => FoliateView | null;
  getViews: () => FoliateView[];
  getViewsById: (id: string) => FoliateView[];
  setViewSettings: (key: string, viewSettings: ViewSettings) => void;
  getViewSettings: (key: string) => ViewSettings | null;

  initViewState: (
    envConfig: EnvConfigType,
    id: string,
    key: string,
    isPrimary?: boolean,
    reload?: boolean,
  ) => Promise<void>;
  clearViewState: (key: string) => void;
  getViewState: (key: string) => ViewState | null;
  getGridInsets: (key: string) => Insets | null;
  setGridInsets: (key: string, insets: Insets | null) => void;
  setViewInited: (key: string, inited: boolean) => void;
  setPreviewMode: (key: string, previewMode: boolean) => void;
  recreateViewer: (envConfig: EnvConfigType, key: string) => void;
}

export const useReaderStore = create<ReaderStore>((set, get) => ({
  viewStates: {},
  bookKeys: [],
  hoveredBookKey: null,
  bottomBarTab: '',
  setBookKeys: (keys: string[]) => set({ bookKeys: keys }),
  setHoveredBookKey: (key: string | null) => set({ hoveredBookKey: key }),
  setBottomBarTab: (tab: string) => set({ bottomBarTab: tab }),
  getView: (key: string | null) => (key && get().viewStates[key]?.view) || null,
  setView: (key: string, view) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: { ...state.viewStates[key]!, view },
      },
    })),
  getViews: () => Object.values(get().viewStates).map((state) => state.view!),
  getViewsById: (id: string) => {
    const { viewStates } = get();
    return Object.values(viewStates)
      .filter((state) => state.key && state.key.startsWith(id))
      .map((state) => state.view!);
  },

  clearViewState: (key: string) => {
    cancelNavigation(key);
    // Drop the per-book progress entry alongside the view state so the
    // standalone progress store doesn't leak across opens/closes.
    clearBookProgress(key);
    set((state) => {
      const viewStates = { ...state.viewStates };
      delete viewStates[key];
      return { viewStates };
    });
  },
  getViewState: (key: string) => get().viewStates[key] || null,
  initViewState: async (
    envConfig: EnvConfigType,
    id: string,
    key: string,
    isPrimary = true,
    reload = false,
  ) => {
    cancelNavigation(key);
    const task: NavigationTask = { controller: new AbortController(), started: performance.now() };
    navigationTasks.set(key, task);
    const { signal } = task.controller;
    const isCurrent = () => !signal.aborted && navigationTasks.get(key) === task;
    // Same-book views share one parsed document. Let the preceding open publish
    // (or release its cancelled resources) before reading the shared BookData.
    const preceding = initializingBooks.get(id);
    let finishInitialization!: () => void;
    const initialization = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    initializingBooks.set(id, initialization);
    let ownedDoc: BookDoc | undefined;
    let ownedFile: (File & { close?: () => void | Promise<void> }) | undefined;
    let published = false;
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          key: '',
          view: null,
          viewerKey: '',
          isPrimary: false,
          loading: true,
          inited: false,
          error: null,
          ribbonVisible: false,
          ttsEnabled: false,
          autoScrollEnabled: false,
          syncing: false,
          gridInsets: null,
          previewMode: false,
          viewSettings: null,
        },
      },
    }));
    try {
      if (preceding) await preceding;
      assertNavActive(signal);
      const bookData = useBookDataStore.getState().booksData[id];
      const appService = await envConfig.getAppService();
      measureReaderPhase('service-ready', task.started);
      assertNavActive(signal);
      const { settings } = useSettingsStore.getState();
      const { getBookByHash, library } = useLibraryStore.getState();
      const book = getBookByHash(id);
      if (!book) {
        console.error(
          `Book ${id} not found in library (size=${library.length}); likely the in-memory entry was dropped by a library reload.`,
        );
        throw new Error('Book not found');
      }
      const isPseStream = !!book.url && isPseStreamFileName(book.url);
      const isFeed = !!book.url && isFeedBookUrl(book.url);
      const needsNav = book.format === 'EPUB';
      // Capture before parsing; a replacement must never stamp an old result
      // with the new file's identity when the background calculation finishes.
      let navSource = needsNav ? await appService.getBookNavSource(book) : null;
      assertNavActive(signal);
      let bookDoc = bookData?.bookDoc;
      let file: File | null = bookData?.file ?? null;
      const sourceChanged =
        bookDoc && documentSources.has(bookDoc) && documentSources.get(bookDoc) !== navSource;
      if (!bookDoc || (!isPseStream && !isFeed && !file) || reload || sourceChanged) {
        console.log('Loading book', key);
        if (isPseStream) {
          const data = parsePseStreamFileName(book.url!);
          const doc = await openPseStreamBook(data);
          bookDoc = doc.book;
          ownedDoc = bookDoc;
          file = null;
        } else if (isFeed) {
          const { feedUrl } = parseFeedBookUrl(book.url!);
          // AppService publicly exposes the readFile/writeFile/exists surface of FileSystem.
          const fs = appService as unknown as FileSystem;
          bookDoc = await openFeedBookDoc(fs, book.hash, feedUrl, book.title);
          ownedDoc = bookDoc;
          file = null;
        } else {
          const fileStarted = performance.now();
          const content = (await appService.loadBookContent(book)) as BookContent;
          measureReaderPhase('file-open', fileStarted);
          file = content.file;
          if (file !== bookData?.file) ownedFile = file;
          assertNavActive(signal);
          // Loading may have downloaded a previously remote-only book. Bind
          // the now-local source before parsing, never after building its nav.
          if (needsNav && !navSource) navSource = await appService.getBookNavSource(book);
          let nativeFilePath: string | null = null;
          try {
            nativeFilePath = await appService.resolveNativeBookFilePath(book);
          } catch (err) {
            console.warn('resolveNativeBookFilePath failed', err);
          }
          const documentStarted = performance.now();
          const doc = await new DocumentLoader(file, {
            nativeFilePath: nativeFilePath ?? undefined,
            pdfOwner: { bookId: book.hash, revision: book.removal?.revision ?? 0 },
            autoPDFOCR: book.format === 'PDF',
          }).open();
          measureReaderPhase('document-parse', documentStarted);
          bookDoc = doc.book;
          ownedDoc = bookDoc;
        }
      }
      assertNavActive(signal);
      documentSources.set(bookDoc, navSource);
      if (!originalTocs.has(bookDoc)) originalTocs.set(bookDoc, cloneTocItems(bookDoc.toc ?? []));
      const configStarted = performance.now();
      const config = await appService.loadBookConfig(book, settings);
      measureReaderPhase('config-read', configStarted);
      assertNavActive(signal);
      // Import annotations from third-party readers on first open
      if (bookDoc.metadata.identifier) {
        const { getAnnotationProviders } = await import('@/services/annotation');
        for (const provider of getAnnotationProviders()) {
          if (provider.isAvailable(appService)) {
            const merged = await provider.importAnnotations(
              appService,
              bookDoc.metadata.identifier,
              config,
            );
            if (merged !== config) {
              Object.assign(config, merged);
              await appService.saveBookConfig(book, config, settings);
            }
          }
        }
      }
      // Filter out invalid booknotes
      config.booknotes = config.booknotes?.filter((booknote) => booknote.cfi) ?? [];
      // A valid cache is cheap in development and production. A miss must not
      // hold up the chapter renderer or restoration of the saved CFI.
      if (book.format === 'EPUB' && bookDoc.rendition?.layout !== 'pre-paginated') {
        let shared = documentNavigation.get(bookDoc);
        // A secondary view must keep the prepared navigation of its shared
        // document, including enhancements that cannot be cached for old books.
        if (!shared || (!shared.complete && shared.controller.signal.aborted)) {
          const navStarted = performance.now();
          const cachedNav = await appService.loadBookNav(book);
          measureReaderPhase('navigation-cache-read', navStarted);
          assertNavActive(signal);
          let cacheUsed = false;
          if (navSource && isBookNavCacheCurrent(cachedNav) && cachedNav.source === navSource) {
            try {
              const staged = navigationCopy(bookDoc);
              hydrateBookNav(staged, cachedNav);
              publishNavigation(bookDoc, staged);
              cacheUsed = true;
            } catch (error) {
              console.warn('Ignoring damaged book navigation cache:', error);
            }
          }
          shared = { controller: new AbortController(), owners: new Set(), complete: cacheUsed };
          documentNavigation.set(bookDoc, shared);
          if (!cacheUsed) {
            bookDoc.toc = cloneTocItems(originalTocs.get(bookDoc) ?? []);
            // Cheap structural positions keep bookmarks, annotation grouping and
            // chapter navigation useful while precise fragment CFIs are pending.
            bakeLocationsAndCfis(bookDoc.toc, bookDoc.sections, (href) =>
              bookDoc.splitTOCHref(href),
            );
            const originalDoc = bookDoc;
            const input = navigationCopy(originalDoc);
            const navigation = shared;
            const navSignal = navigation.controller.signal;
            const navIsCurrent = () =>
              !navSignal.aborted &&
              documentNavigation.get(originalDoc) === navigation &&
              useBookDataStore.getState().booksData[id]?.bookDoc === originalDoc;
            navigation.start = () => {
              // All views request this same function after their first paint;
              // consume it synchronously so only one whole-book build starts.
              navigation.start = undefined;
              void (async () => {
                try {
                  const freshNav = await computeBookNav(input, {
                    signal: navSignal,
                    background: true,
                  });
                  if (!navIsCurrent()) return;
                  if (navSource !== (await appService.getBookNavSource(book))) return;
                  if (!navIsCurrent()) return;
                  const staged = navigationCopy(originalDoc);
                  hydrateBookNav(staged, freshNav);
                  const owner =
                    [...navigation.owners].find(
                      (ownerKey) => get().viewStates[ownerKey]?.isPrimary,
                    ) ?? navigation.owners.values().next().value;
                  const latestSettings = owner ? get().viewStates[owner]?.viewSettings : undefined;
                  await updateToc(
                    staged,
                    latestSettings?.sortedTOC ?? false,
                    latestSettings?.convertChineseVariant ?? 'none',
                  );
                  if (!navIsCurrent()) return;
                  // Publish the complete artifact synchronously. Once committed,
                  // finish progress refreshes for all surviving views even if
                  // the initiating view closes during their asynchronous init.
                  publishNavigation(originalDoc, staged);
                  navigation.complete = true;
                  measureReaderPhase('navigation-enhanced', task.started);
                  const views = get()
                    .getViewsById(id)
                    .filter((view) => view?.book === originalDoc);
                  // Notify sidebars without changing viewerKey or mounting a new renderer.
                  useBookDataStore.setState((state) => ({
                    booksData: {
                      ...state.booksData,
                      [id]: { ...state.booksData[id]! },
                    },
                  }));
                  await Promise.all(
                    views.map(async (view) => {
                      try {
                        await view.updateTOC?.(staged.toc ?? []);
                      } catch (error) {
                        console.warn('Failed to refresh view navigation:', error);
                      }
                    }),
                  );
                  if (navSource && navIsCurrent()) {
                    freshNav.source = navSource;
                    await appService.saveBookNav(book, freshNav);
                  }
                } catch (error) {
                  if (!navSignal.aborted) console.warn('Failed to enhance book navigation:', error);
                }
              })();
            };
          }
        }
        if (!shared.complete) {
          const navigation = shared;
          navigation.owners.add(key);
          signal.addEventListener(
            'abort',
            () => {
              navigation.owners.delete(key);
              if (!navigation.owners.size) navigation.controller.abort();
            },
            { once: true },
          );
          task.start = () => afterReaderPaint(signal, () => navigation.start?.());
        }
      }
      await updateToc(
        bookDoc,
        config.viewSettings?.sortedTOC ?? false,
        config.viewSettings?.convertChineseVariant ?? 'none',
      );
      assertNavActive(signal);
      if (!bookDoc.metadata.title && file) {
        bookDoc.metadata.title = getBaseFilename(file.name);
      }
      book.sourceTitle = formatTitle(bookDoc.metadata.title);
      // Correct language codes mistakenly set with language names
      if (typeof bookDoc.metadata?.language === 'string') {
        if (bookDoc.metadata.language in SUPPORTED_LANGNAMES) {
          bookDoc.metadata.language = SUPPORTED_LANGNAMES[bookDoc.metadata.language]!;
        }
      }
      // Set the book's language for formerly imported books, newly imported books have this field set
      const primaryLanguage = getPrimaryLanguage(bookDoc.metadata.language);
      book.primaryLanguage = book.primaryLanguage ?? primaryLanguage;
      book.metadata = book.metadata ?? bookDoc.metadata;

      // Update series info from metadata if available and not already set on the book
      if (bookDoc.metadata.belongsTo?.series) {
        const belongsTo = bookDoc.metadata.belongsTo.series;
        const series = Array.isArray(belongsTo) ? belongsTo[0] : belongsTo;
        if (series) {
          book.metadata.series = book.metadata.series ?? formatTitle(series.name);
          book.metadata.seriesIndex =
            book.metadata.seriesIndex ?? parseFloat(series.position || '0');
          book.metadata.seriesTotal =
            book.metadata.seriesTotal ?? (series.total ? parseInt(series.total, 10) : undefined);
        }
      }
      // TODO: uncomment this when we can ensure metaHash is correctly generated for all books
      // book.metaHash = book.metaHash ?? getMetadataHash(bookDoc.metadata);
      // PDF metaHash is salted with the original import filename (issue #5411),
      // which is lost after import — keep the value stamped at import time.
      if (book.format !== 'PDF' || !book.metaHash) {
        book.metaHash = getMetadataHash(bookDoc.metadata);
      }

      const isFixedLayout =
        bookDoc.rendition?.layout === 'pre-paginated' || FIXED_LAYOUT_FORMATS.has(book.format);
      const newBookData: BookData = { id, book, file, config, bookDoc, isFixedLayout };
      useBookDataStore.setState((state) => ({
        booksData: {
          ...state.booksData,
          [id]: newBookData,
        },
      }));
      published = true;
      const configViewSettings = config.viewSettings!;
      const globalViewSettings = settings.globalViewSettings;
      set((state) => ({
        viewStates: {
          ...state.viewStates,
          [key]: {
            ...state.viewStates[key],
            key,
            view: null,
            viewerKey: `${key}-${uniqueId()}`,
            isPrimary,
            loading: false,
            inited: false,
            error: null,
            ribbonVisible: false,
            ttsEnabled: false,
            autoScrollEnabled: false,
            syncing: false,
            gridInsets: null,
            previewMode: false,
            viewSettings: { ...globalViewSettings, ...configViewSettings },
          },
        },
      }));
      measureReaderPhase('store-ready', task.started);
    } catch (error) {
      if (!isCurrent()) return;
      console.error(error);
      set((state) => ({
        viewStates: {
          ...state.viewStates,
          [key]: {
            ...state.viewStates[key],
            key: '',
            view: null,
            viewerKey: '',
            isPrimary: false,
            loading: false,
            inited: false,
            error: 'Failed to load book.',
            ribbonVisible: false,
            ttsEnabled: false,
            autoScrollEnabled: false,
            syncing: false,
            gridInsets: null,
            previewMode: false,
            viewSettings: null,
          },
        },
      }));
      throw error;
    } finally {
      if (!published) {
        task.controller.abort();
        const current = useBookDataStore.getState().booksData[id];
        try {
          if (ownedDoc && ownedDoc !== current?.bookDoc) await ownedDoc.destroy?.();
        } catch (error) {
          console.warn('Failed to release unopened book:', error);
        }
        try {
          if (ownedFile && ownedFile !== current?.file) await ownedFile.close?.();
        } catch (error) {
          console.warn('Failed to release unopened book file:', error);
        }
      }
      finishInitialization();
      if (initializingBooks.get(id) === initialization) initializingBooks.delete(id);
    }
  },
  getViewSettings: (key: string) => get().viewStates[key]?.viewSettings || null,
  setViewSettings: (key: string, viewSettings: ViewSettings) => {
    if (!key) return;
    const id = key.split('-')[0]!;
    const bookData = useBookDataStore.getState().booksData[id];
    const viewState = get().viewStates[key];
    if (!viewState || !bookData) return;
    if (viewState.isPrimary) {
      useBookDataStore.setState((state) => ({
        booksData: {
          ...state.booksData,
          [id]: {
            ...bookData,
            config: {
              ...bookData.config,
              updatedAt: Date.now(),
              viewSettings,
            },
          },
        },
      }));
    }
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          viewSettings,
        },
      },
    }));
  },
  // Delegates to the standalone readerProgressStore so that progress reads
  // do not subscribe the caller to readerStore. Most call sites need a
  // one-shot read (event handlers, useEffect bodies). Components that
  // genuinely depend on progress for rendering should subscribe via the
  // `useBookProgress(key)` hook exported from readerProgressStore instead.
  getProgress: (key: string) => getBookProgress(key),
  setProgress: (
    key: string,
    location: string,
    tocItem: TOCItem,
    pageItem: BookProgress['pageItem'],
    section: PageInfo,
    pageinfo: PageInfo,
    timeinfo: TimeInfo,
    range: Range,
    fraction: number,
  ) => {
    const id = key.split('-')[0]!;
    const bookData = useBookDataStore.getState().booksData[id];
    const viewState = get().viewStates[key];
    if (!viewState || !bookData) return;

    const pageInfo = bookData.isFixedLayout ? section : pageinfo;
    const progress: [number, number] = [pageInfo.current + 1, pageInfo.total];
    const progressPercentage = Math.round((progress[0] / progress[1]) * 100);

    // Lightweight library update — O(1) lookup, no array copy, no refreshGroups
    const { getBookByHash, updateBookProgress } = useLibraryStore.getState();
    const existingBook = getBookByHash(id);
    if (existingBook) {
      let newReadingStatus = existingBook.readingStatus;
      if (existingBook.readingStatus === 'unread') {
        newReadingStatus = undefined;
      }
      if (progressPercentage >= 100 && existingBook.readingStatus !== 'finished') {
        newReadingStatus = 'finished';
      }
      updateBookProgress(id, progress, newReadingStatus);
    }

    // Only the primary view persists progress into the shared bookData
    // config — secondary views in a parallel layout shouldn't overwrite
    // it. Skip the bookDataStore write entirely when not primary to spare
    // its subscribers a re-render.
    if (viewState.isPrimary) {
      useBookDataStore.setState((state) => {
        const existing = state.booksData[id];
        if (!existing) return state;
        return {
          booksData: {
            ...state.booksData,
            [id]: {
              ...existing,
              config: {
                ...existing.config,
                progress,
                location,
              } as BookConfig,
            },
          },
        };
      });
    }

    // Write progress to the standalone store. This is the only setState on
    // the hot swipe path that the previous implementation routed through
    // the (much bigger) readerStore — the split here is the whole point of
    // the refactor: components subscribing to `useReaderStore()` without a
    // selector will no longer re-render per page turn.
    setBookProgress(key, {
      location,
      sectionHref: tocItem?.href,
      sectionLabel: tocItem?.label,
      pageItem,
      section,
      pageinfo,
      timeinfo,
      fraction,
      index: section.current,
      range,
      page: pageInfo.current + 1,
    } as BookProgress);
  },
  setBookmarkRibbonVisibility: (key: string, visible: boolean) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          ribbonVisible: visible,
        },
      },
    })),

  setTTSEnabled: (key: string, enabled: boolean) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          ttsEnabled: enabled,
        },
      },
    })),

  setAutoScrollEnabled: (key: string, enabled: boolean) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          autoScrollEnabled: enabled,
        },
      },
    })),

  setIsLoading: (key: string, loading: boolean) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          loading,
        },
      },
    })),

  setIsSyncing: (key: string, syncing: boolean) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          syncing,
        },
      },
    })),

  getGridInsets: (key: string) =>
    get().viewStates[key]?.gridInsets || { top: 0, right: 0, bottom: 0, left: 0 },
  setGridInsets: (key: string, insets: Insets | null) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          gridInsets: insets,
        },
      },
    })),

  setViewInited: (key: string, inited: boolean) => {
    if (!get().viewStates[key]) return;
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          inited,
        },
      },
    }));
    if (inited) {
      const task = navigationTasks.get(key);
      if (task && !get().viewStates[key]?.loading) {
        measureReaderPhase('position-restored', task.started);
        measureReaderPhase('window-to-position', 0);
      }
      const start = task?.start;
      if (task) task.start = undefined;
      start?.();
    }
  },

  setPreviewMode: (key: string, previewMode: boolean) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          previewMode,
        },
      },
    })),

  recreateViewer: (envConfig: EnvConfigType, key: string) => {
    const id = key.split('-')[0]!;
    // `initViewState` already mints a fresh `viewerKey` when the reload lands,
    // which is what remounts <FoliateViewer>. Minting a second one here
    // remounted it twice: the abandoned first mount kept running its async
    // `openBook()` and registered another `data` transform listener on the
    // *same* reloaded bookDoc, so every resource was piped through the
    // transform chain twice. A twice-transformed stylesheet lost all its
    // font-family declarations, and the book fell back to the app font
    // (readest#5277).
    void get().initViewState(envConfig, id, key, true, true);
  },
}));
