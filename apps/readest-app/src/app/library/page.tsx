'use client';

import clsx from 'clsx';
import * as React from 'react';
import { ChevronRight, X } from '@/components/GlossaIcons';
import { useState, useRef, useEffect, Suspense, useCallback } from 'react';
import { ReadonlyURLSearchParams, useSearchParams } from 'next/navigation';

import { Book, BooksGroup, type LibrarySearchConfig } from '@/types/book';
import { AppService, DeleteAction, type FileItem } from '@/types/system';
import {
  buildBookLookupIndex,
  collectKnownSourcePaths,
  normalizeFilePathForIndex,
  selectNewImportableFiles,
  toWatchedFolderImports,
} from '@/services/bookService';
import { bookRemovalIO, removeAppBooks, removalFeedback } from '@/services/appBookRemoval';
import { restoreRemovedBooks, type RemovalResult } from '@/services/bookRemovalService';
import { getEnabledFileSyncBackends } from '@/services/sync/cloudSyncProvider';
import RecentlyDeleted from './components/RecentlyDeleted';
import { debounce } from '@/utils/debounce';
import { DEFAULT_NEARBY_WORDS } from '@/utils/searchConfig';
import { clearLibrarySearchHistory, loadLibrarySearchHistory } from './utils/searchHistory';
import type { LibrarySearchTarget } from '@/types/book';
import { navigateToLibrary, navigateToLogin, navigateToReader } from '@/utils/nav';
import { getBookWithUpdatedMetadata, listFormater } from '@/utils/book';
import { getImportErrorMessage } from '@/services/errors';
import { ingestFile } from '@/services/ingestService';
import { eventDispatcher } from '@/utils/event';
import { ProgressPayload } from '@/utils/transfer';
import { throttle } from '@/utils/throttle';
import { getFilename, getFolderImportGroupName, joinScannedPath } from '@/utils/path';
import { parseOpenWithFiles } from '@/helpers/openWith';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { checkForAppUpdates, checkAppReleaseNotes } from '@/helpers/updater';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { getCurrentWebview } from '@tauri-apps/api/webview';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useTheme } from '@/hooks/useTheme';
import { useUICSS } from '@/hooks/useUICSS';
import { useDemoBooks } from './hooks/useDemoBooks';
import { useBooksSync } from './hooks/useBooksSync';
import { useLibraryFileSync } from './hooks/useLibraryFileSync';
import { useBookTransferActions } from './hooks/useBookTransferActions';
import { useAutoImportFolders } from './hooks/useAutoImportFolders';

import { useBookDataStore } from '@/store/bookDataStore';
import { useTransferStore } from '@/store/transferStore';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { getFolderImportReadInPlace, getLibraryViewSettings } from '@/helpers/settings';
import { useAppUrlIngress } from '@/hooks/useAppUrlIngress';
import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { useOpenAnnotationLink } from '@/hooks/useOpenAnnotationLink';
import { useOpenBookLink } from '@/hooks/useOpenBookLink';

import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { SelectedFile, useFileSelector } from '@/hooks/useFileSelector';
import { lockScreenOrientation, selectDirectory, showFilePicker } from '@/utils/bridge';
import { useAndroidPickedBooks } from '@/hooks/useAndroidFilePicker';
import { requestStoragePermission } from '@/utils/permission';
import { SUPPORTED_BOOK_EXTS } from '@/services/constants';
import {
  tauriHandleClose,
  tauriHandleSetAlwaysOnTop,
  tauriHandleToggleFullScreen,
  tauriQuitApp,
  tauriSetWindowTitle,
} from '@/utils/window';

import { LibraryGroupByType } from '@/types/settings';
import { BookMetadata } from '@/libs/document';
import { AboutWindow } from '@/components/AboutWindow';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import { BookDetailModal } from '@/components/metadata';
import { UpdaterWindow } from '@/components/UpdaterWindow';

import { MigrateDataWindow } from './components/MigrateDataWindow';
import { BackupWindow } from './components/BackupWindow';
import { CacheManagerWindow } from './components/CacheManagerWindow';
import { useDragDropImport } from './hooks/useDragDropImport';
import { useLibraryFolders } from './hooks/useLibraryFolders';
import { droppedFolderPath } from './utils/libraryDragDrop';
import { useTransferQueue } from '@/hooks/useTransferQueue';
import { useAppRouter } from '@/hooks/useAppRouter';
import { Toast } from '@/components/Toast';
import {
  createBookGroups,
  ensureLibraryGroupByType,
  findGroupById,
  getBreadcrumbs,
} from './utils/libraryUtils';
import Spinner from '@/components/Spinner';
import LibraryHeader from './components/LibraryHeader';
import LibraryNavigation from './components/LibraryNavigation';
import Bookshelf from './components/Bookshelf';
import LibraryEmptyState from './components/LibraryEmptyState';
import ImportMenuPopup from './components/ImportMenuPopup';
import GroupHeader from './components/GroupHeader';
import FailedImportsDialog, { FailedImport } from './components/FailedImportsDialog';
import ImportFromFolderDialog, {
  type ImportFromFolderResult,
  type FolderImportOptions,
} from './components/ImportFromFolderDialog';
import FileImportDialog, { type FileImportState } from './components/FileImportDialog';
import { pluginLoaders } from '@/glossa/plugins/loaders';
import { isPluginEnabled } from '@/glossa/plugins/registry';

const ImportFromUrlDialog = React.lazy(() => import('./components/ImportFromUrlDialog'));
import ClipSignInAlert from '@/components/ClipSignInAlert';
import useShortcuts from '@/hooks/useShortcuts';
import { useReplicaPull } from '@/hooks/useReplicaPull';
import { useCustomFonts } from '@/hooks/useCustomFonts';
import DropIndicator from '@/components/DropIndicator';
import SettingsDialog from '@/components/settings/SettingsDialog';
import ModalPortal from '@/components/ModalPortal';
import TransferQueuePanel from './components/TransferQueuePanel';

/** Skip tiny non-book artifacts during folder auto-scan (matches the manual import dialog default). */
const AUTO_IMPORT_MIN_SIZE_BYTES = 20 * 1024;
const LIBRARY_SEARCH_MODES: LibrarySearchConfig['mode'][] = [
  'contains',
  'whole-words',
  'regex',
  'nearby-words',
  'fuzzy',
];

const getLibrarySearchConfig = (
  searchParams: ReadonlyURLSearchParams | null,
): LibrarySearchConfig => {
  const modeParam = searchParams?.get('mode') as LibrarySearchConfig['mode'] | null;
  const nearbyParam = Number(searchParams?.get('nearby'));
  return {
    scope: 'book',
    mode: modeParam && LIBRARY_SEARCH_MODES.includes(modeParam) ? modeParam : 'contains',
    matchCase: searchParams?.get('matchCase') === 'true',
    matchDiacritics: searchParams?.get('matchDiacritics') === 'true',
    nearbyWords:
      Number.isFinite(nearbyParam) && nearbyParam > 0 ? nearbyParam : DEFAULT_NEARBY_WORDS,
  };
};

/**
 * Key used to persist the last directory the user imported books from.
 * Stored in localStorage so re-opening the dialog (even across app
 * restarts) seeds the path field with their previous choice — this
 * mirrors the behaviour of native file pickers on most desktop OSes.
 */
const LAST_IMPORT_FOLDER_KEY = 'readest:lastImportFolder';
/**
 * Key used to persist the user's last "Folder Structure" choice
 * ('keep' vs 'flatten'). Restored as the default radio selection on
 * the next dialog open.
 */
const LAST_IMPORT_FOLDER_MODE_KEY = 'readest:lastImportFolderMode';
const LibraryPageWithSearchParams = () => {
  const searchParams = useSearchParams();
  return <LibraryPageContent searchParams={searchParams} />;
};

const LibraryPageContent = ({ searchParams }: { searchParams: ReadonlyURLSearchParams | null }) => {
  const router = useAppRouter();
  const { envConfig, appService } = useEnv();
  const { token, user } = useAuth();
  const {
    library: libraryBooks,
    libraryLoaded: libraryLoadedFromDisk,
    isSyncing,
    syncProgress,
    updateBook,
    updateBooks,
    setLibrary,
    getGroupId,
    getGroupName,
    refreshGroups,
    checkOpenWithBooks,
    checkLastOpenBooks,
    setCheckOpenWithBooks,
    setCheckLastOpenBooks,
  } = useLibraryStore();
  const _ = useTranslation();
  const { selectFiles } = useFileSelector(appService, _);
  const { safeAreaInsets: insets, isRoundedWindow } = useThemeStore();
  const { clearBookData } = useBookDataStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { isSettingsDialogOpen } = useSettingsStore();
  // Field selector, not `const { isTransferQueueOpen } = useTransferStore()`:
  // a whole-store subscription re-renders the entire library tree on every
  // transfer progress tick (~10/sec per active upload), freezing the app
  // during a bulk cloud upload (issue #5047).
  const isTransferQueueOpen = useTransferStore((state) => state.isTransferQueueOpen);

  // Library page pulls user replicas (dictionaries, custom fonts,
  // background textures, OPDS catalogs, bundled settings). Deferred
  // 10s; module-scoped dedup means a later navigation to the reader
  // won't re-pull the same kind.
  useReplicaPull({
    kinds: ['dictionary', 'font', 'texture', 'opds_catalog', 'settings'],
  });
  // Hydrate the custom-font store from persisted settings so the Font
  // panel sees imported fonts even when opened straight from the
  // library — the replica pull above is auth-gated and the reader's
  // FoliateViewer hydration never runs without a book open.
  useCustomFonts();

  const [showImportFromUrl, setShowImportFromUrl] = useState(false);
  const webImportEnabled = isPluginEnabled(settings, 'webImport');
  const [fileImportState, setFileImportState] = useState<FileImportState | null>(null);
  const fileImportController = useRef<AbortController | null>(null);
  const retryFileImport = useRef<(() => void) | null>(null);
  useEffect(() => () => fileImportController.current?.abort(), []);
  useEffect(() => {
    if (!webImportEnabled) setShowImportFromUrl(false);
  }, [webImportEnabled]);

  const [importMenuAnchor, setImportMenuAnchor] = useState<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  // Seed from the library store: if we already have books in memory (the
  // common reader → library return path), treat the page as loaded
  // immediately. This prevents `showBookshelf` from briefly being false on
  // remount, which used to flash a placeholder before `initLibrary` finished.
  const [libraryLoaded, setLibraryLoaded] = useState(() => libraryBooks.length > 0);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isLibrarySidebarVisible, setIsLibrarySidebarVisible] = useState(true);
  const [isSelectAll, setIsSelectAll] = useState(false);
  const [isSelectNone, setIsSelectNone] = useState(false);
  const [librarySearchQuery, setLibrarySearchQuery] = useState(searchParams?.get('q') ?? '');
  const pendingLibrarySearchQueryRef = useRef<string | null>(null);
  const [librarySearchProgress, setLibrarySearchProgress] = useState<number | null>(null);
  const [librarySearchHistory, setLibrarySearchHistory] = useState<string[]>([]);
  const [librarySearchTarget, setLibrarySearchTarget] = useState<LibrarySearchTarget>(() =>
    ['contents', 'text'].includes(searchParams?.get('search') ?? '') ? 'text' : 'books',
  );
  const [librarySearchConfig, setLibrarySearchConfig] = useState<LibrarySearchConfig>(() =>
    getLibrarySearchConfig(searchParams),
  );
  useEffect(() => {
    if (librarySearchTarget === 'text' && !librarySearchQuery.trim()) {
      setLibrarySearchHistory(loadLibrarySearchHistory());
    }
  }, [librarySearchTarget, librarySearchQuery]);
  const librarySearchTargetRef = useRef(librarySearchTarget);
  const librarySearchConfigRef = useRef(librarySearchConfig);
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);
  const [failedImportsModal, setFailedImportsModal] = useState<FailedImport[] | null>(null);
  // "Import from folder" dialog state. Held as a small object rather
  // than a boolean because we need a default starting directory to seed
  // the path field, and we want the dialog to remain mounted long
  // enough for the platform's folder picker to overlay it.
  const [importFromFolderState, setImportFromFolderState] = useState<{
    initialDirectory: string;
    initialFolderMode: 'keep' | 'flatten';
  } | null>(null);
  const [currentGroupPath, setCurrentGroupPath] = useState<string | undefined>(undefined);
  const [currentVirtualGroup, setCurrentVirtualGroup] = useState<{
    groupBy:
      | typeof LibraryGroupByType.Series
      | typeof LibraryGroupByType.Author
      | typeof LibraryGroupByType.Tag;
    groupName: string;
  } | null>(null);
  const [booksTransferProgress, setBooksTransferProgress] = useState<{
    [key: string]: number | null;
  }>({});
  const [pendingNavigationBookIds, setPendingNavigationBookIds] = useState<string[] | null>(null);
  const isInitiating = useRef(false);

  const iconSize = useResponsiveSize(18);
  const viewSettings = settings.globalViewSettings;
  const demoBooks = useDemoBooks();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handleScrollerRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
  }, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // Tracks paths that failed to import in this session so auto-import does not
  // re-attempt (and re-toast) them on every subsequent folder scan.
  const autoImportFailedPathsRef = useRef<Set<string>>(new Set());
  // Folders whose fs/asset scopes were already granted this session. Each
  // `allowPathsInScopes` call makes tauri-plugin-persisted-scope rewrite its
  // whole state file on the main thread, so grant once, not on every focus
  // scan (issue #5494).
  const autoImportGrantedFoldersRef = useRef<Set<string>>(new Set());

  const getScrollKey = (group: string) => `library-scroll-${group || 'all'}`;

  const saveScrollPosition = (group: string) => {
    if (scrollRef.current) {
      sessionStorage.setItem(getScrollKey(group), scrollRef.current.scrollTop.toString());
    }
  };

  const restoreScrollPosition = useCallback((group: string) => {
    const savedPosition = sessionStorage.getItem(getScrollKey(group));
    if (savedPosition && scrollRef.current) {
      scrollRef.current.scrollTop = parseInt(savedPosition, 10);
    }
  }, []);

  useTheme({ systemUIVisible: true, appThemeColor: 'base-200' });
  useUICSS();

  // Apply the library's own background texture (separate from the reader's,
  // issue #4743). Re-applies on mount so returning from a textured book
  // restores the library background, and whenever the library texture — or the
  // reader/global texture it inherits when unset — changes from the Color panel.
  const { applyBackgroundTexture } = useBackgroundTexture();
  useEffect(() => {
    applyBackgroundTexture(envConfig, getLibraryViewSettings(settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    envConfig,
    applyBackgroundTexture,
    settings.libraryBackgroundTextureId,
    settings.libraryBackgroundTransparency,
    settings.libraryBackgroundSize,
    settings.globalViewSettings?.backgroundTextureId,
    settings.globalViewSettings?.backgroundTransparency,
    settings.globalViewSettings?.backgroundSize,
  ]);

  useAppUrlIngress();
  useOpenWithBooks();
  useOpenAnnotationLink();
  useOpenBookLink();

  useTransferQueue(libraryLoaded);

  const { pullLibrary, pushLibrary } = useBooksSync();
  // Library-scoped auto-sync for the active third-party cloud provider (WebDAV /
  // Google Drive): keeps library.json current on import / delete / book-close,
  // parity with useBooksSync. No-op when no provider is enabled.
  useLibraryFileSync();

  const { isDragging } = useDragDropImport();
  const folders = useLibraryFolders();

  usePullToRefresh(
    scrollRef,
    async () => {
      if (!user) {
        navigateToLogin(router);
        return;
      }
      await pullLibrary(false, true);
    },
    async () => {
      if (!user) {
        navigateToLogin(router);
        return;
      }
      await pullLibrary(true, true);
    },
  );
  useShortcuts({
    onToggleFullscreen: async () => {
      if (isTauriAppPlatform()) {
        await tauriHandleToggleFullScreen();
      }
    },
    onCloseWindow: async () => {
      if (isTauriAppPlatform()) {
        await tauriHandleClose();
      }
    },
    onQuitApp: async () => {
      if (isTauriAppPlatform()) {
        await tauriQuitApp();
      }
    },
    onOpenFontLayoutSettings: () => {
      useSettingsStore.getState().openSettingsDialog('application');
    },
    onOpenBooks: () => {
      handleImportBooksFromFiles();
    },
  });

  useEffect(() => {
    const snapshot = searchParams?.toString() || '';
    if (snapshot !== new URLSearchParams(window.location.search).toString()) return;
    sessionStorage.setItem('lastLibraryParams', snapshot);
  }, [searchParams]);

  // Strip the empty `group=` param that `handleLibraryNavigation` sets as a
  // workaround for a Next.js 16.2 static-export regression (see the NOTE
  // above `handleLibraryNavigation` for full context). This effect runs
  // after the router.replace() has committed, so React has already
  // re-rendered with the new (empty) group state; we're only rewriting the
  // URL cosmetically via window.history.replaceState — Next.js' patched
  // replaceState will pick up the new canonical URL without triggering
  // another navigation.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (searchParams?.get('group') !== '') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('group');
    const cleanHref = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, '', cleanHref);
  }, [searchParams]);

  // Unified navigation function that handles scroll position and direction.
  // Workaround for a Next.js 16.2 static-export regression: navigating to a
  // same-pathname URL with an empty search string causes `router.replace()`
  // to silently no-op (e.g. `/library?group=foo` -> `/library`), which broke
  // the breadcrumb "All" button. By always calling `params.set('group',
  // targetGroup)` — including when `targetGroup` is an empty string — the
  // resulting URL becomes `/library?group=` instead of `/library`, which
  // Next.js does commit. The trailing empty `group=` is stripped via a
  // cleanup effect below (purely cosmetic URL rewrite). See
  // https://github.com/readest/readest/issues/3782.
  const handleLibraryNavigation = useCallback(
    (targetGroup: string) => {
      const params = new URLSearchParams(window.location.search);
      const currentGroup = params.get('group') || '';

      // Save current scroll position BEFORE navigation
      saveScrollPosition(currentGroup);

      // Detect and set navigation direction
      const direction = currentGroup && !targetGroup ? 'back' : 'forward';
      document.documentElement.setAttribute('data-nav-direction', direction);

      // Build query params — always `set` so the search string is non-empty
      // even when targetGroup is '' (the Next.js 16.2 workaround).
      params.set('group', targetGroup);

      navigateToLibrary(router, `${params.toString()}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );

  const handleBackUpOneGroupLevel = () => {
    if (!currentGroupPath) return;
    const segments = currentGroupPath.split('/');
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : undefined;
    const parentGroupId = parentPath ? getGroupId(parentPath) || '' : '';
    setIsSelectAll(false);
    setIsSelectNone(false);
    handleLibraryNavigation(parentGroupId);
  };

  const handleBackUpOneGroupLevelRef = useRef(handleBackUpOneGroupLevel);
  handleBackUpOneGroupLevelRef.current = handleBackUpOneGroupLevel;
  const triggerBackUpOneGroupLevel = useCallback(() => handleBackUpOneGroupLevelRef.current(), []);

  useKeyDownActions({
    onCancel: triggerBackUpOneGroupLevel,
    enabled: !!appService?.isAndroidApp && !!currentGroupPath,
  });

  useEffect(() => {
    const doCheckAppUpdates = async () => {
      if (appService?.hasUpdater && settings.autoCheckUpdates) {
        await checkForAppUpdates(_, true, settings.updateChannel);
      } else if (appService?.hasUpdater === false) {
        checkAppReleaseNotes();
      }
    };
    if (settings.alwaysOnTop) {
      tauriHandleSetAlwaysOnTop(settings.alwaysOnTop);
    }
    doCheckAppUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.hasUpdater, settings]);

  useEffect(() => {
    if (appService?.isMobileApp) {
      lockScreenOrientation({ orientation: 'auto' });
    }
  }, [appService]);

  // Drop the book name the reader put in the window title, so a window back on
  // the library does not keep announcing a book that is no longer open.
  useEffect(() => {
    if (appService?.hasWindow) {
      tauriSetWindowTitle();
    }
  }, [appService?.hasWindow]);

  useEffect(() => {
    if (appService?.hasWindow) {
      const currentWebview = getCurrentWebview();
      const unlisten = currentWebview.listen('close-reader-window', async () => {
        // Reader windows are independent Tauri webviews with their own
        // libraryStore instance — progress / readingStatus / move-to-front
        // updates from the reader window do NOT propagate to this main
        // window's store. Reload from disk so the library reflects the
        // changes the reader just persisted.
        const appService = await envConfig.getAppService();
        const settings = await appService.loadSettings();
        const library = await appService.loadLibraryBooks();
        setSettings(settings);
        setLibrary(library);
      });
      return () => {
        unlisten.then((fn) => fn());
      };
    }
    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, envConfig]);

  const handleImportBookFiles = useCallback(
    async (event: CustomEvent) => {
      const selectedFiles: SelectedFile[] = event.detail.files;
      const groupId: string | undefined = event.detail.groupId;
      const importedFolders: string[] = event.detail.folders ?? [];
      if (importedFolders.length && !(await folders.ensure(importedFolders))) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Unable to save folders. Please try again.'),
        });
        return;
      }
      if (!selectedFiles?.length) return;
      await importBooks(selectedFiles, groupId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [appService, envConfig],
  );

  const handleImportBookDirectory = useCallback(
    async (event: CustomEvent) => {
      const dirPath: string | undefined = event.detail?.path;
      if (!dirPath) return;
      await handleImportBooksFromDirectory(dirPath, event.detail?.destination);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [appService, envConfig],
  );

  useEffect(() => {
    eventDispatcher.on('import-book-files', handleImportBookFiles);
    eventDispatcher.on('import-book-directory', handleImportBookDirectory);
    return () => {
      eventDispatcher.off('import-book-files', handleImportBookFiles);
      eventDispatcher.off('import-book-directory', handleImportBookDirectory);
    };
  }, [handleImportBookFiles, handleImportBookDirectory]);

  useEffect(() => {
    if (!libraryBooks.some((book) => !book.deletedAt)) {
      handleSetSelectMode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryBooks]);

  const processOpenWithFiles = useCallback(
    async (appService: AppService, openWithFiles: string[], libraryBooks: Book[]) => {
      const settings = await appService.loadSettings();
      const bookIds: string[] = [];
      for (const file of openWithFiles) {
        console.log('Open with book:', file);
        try {
          const temp = appService.isMobile ? false : !settings.autoImportBooksOnOpen;
          // A file shared into Readest on mobile (the OS share-sheet) is a
          // "Send to Glossa" capture — force it to the cloud so it syncs to
          // every device. Desktop "open with" honors the book sync toggle.
          const book = await ingestFile(
            {
              file,
              books: libraryBooks,
              transient: temp,
              forceUpload: !!appService.isMobile && !!user,
            },
            { appService, settings, isLoggedIn: !!user },
          );
          if (book) {
            bookIds.push(book.hash);
          }
        } catch (error) {
          console.log('Failed to import book:', file, error);
        }
      }
      setLibrary(libraryBooks);
      appService.saveLibraryBooks(libraryBooks);

      console.log('Opening books:', bookIds);
      if (bookIds.length > 0) {
        setPendingNavigationBookIds(bookIds);
        return true;
      }
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleOpenLastBooks = async (
    appService: AppService,
    lastBookIds: string[],
    libraryBooks: Book[],
  ) => {
    if (lastBookIds.length === 0) return false;
    const bookIds: string[] = [];
    for (const bookId of lastBookIds) {
      const book = libraryBooks.find((b) => b.hash === bookId && b.readingStatus !== 'finished');
      if (book && (await appService.isBookAvailable(book))) {
        bookIds.push(book.hash);
      }
    }
    console.log('Opening last books:', bookIds);
    if (bookIds.length > 0) {
      setPendingNavigationBookIds(bookIds);
      return true;
    }
    return false;
  };

  const libraryInitKey = (() => {
    const params = new URLSearchParams(searchParams?.toString());
    for (const key of ['q', 'search', 'mode', 'matchCase', 'matchDiacritics', 'nearby']) {
      params.delete(key);
    }
    return params.toString();
  })();

  useEffect(() => {
    if (pendingNavigationBookIds) {
      const bookIds = pendingNavigationBookIds;
      setPendingNavigationBookIds(null);
      if (bookIds.length > 0) {
        navigateToReader(router, bookIds);
      }
    }
  }, [pendingNavigationBookIds, appService, router]);

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;

    const initLogin = async () => {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      if (token && user) {
        if (!settings.keepLogin) {
          settings.keepLogin = true;
          setSettings(settings);
          saveSettings(envConfig, settings);
        }
      }
    };

    // Reuse the in-store library only when it was actually loaded from disk.
    // Gating on `length > 0` was unsafe: a transient "Open with" entry made the
    // store non-empty before any disk load, so this skipped loadLibraryBooks and
    // a later save persisted the partial library (wiping library.json).
    const hasCachedLibrary = libraryLoadedFromDisk;
    const loadingTimeout = hasCachedLibrary ? null : setTimeout(() => setLoading(true), 500);
    const initLibrary = async () => {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      setSettings(settings);

      // Re-grant fs_scope / asset_protocol_scope for every external
      // library folder the user registered in a previous session, so
      // in-place books under those roots are immediately readable
      // through both `dir_scanner::read_dir` and the fs plugin.
      // Best-effort — `allowPathsInScopes` swallows its own errors.
      // On iOS the corresponding native-bridge plugin separately
      // re-acquires security-scoped resources via persisted
      // bookmarks (see InPlaceFolderBookmarkStore in
      // NativeBridgePlugin.swift); here we just sync Tauri's in-memory
      // scope set with the persisted intent.
      const externalRoots = settings.externalLibraryFolders ?? [];
      if (externalRoots.length > 0 && appService.allowPathsInScopes) {
        await appService.allowPathsInScopes(externalRoots, true);
      }

      // Reuse the library from the store when we return from the reader
      const library = hasCachedLibrary ? libraryBooks : await appService.loadLibraryBooks();
      let opened = false;
      if (checkOpenWithBooks) {
        opened = await handleOpenWithBooks(appService, library);
      }
      setCheckOpenWithBooks(opened);
      if (!opened && checkLastOpenBooks && settings.openLastBooks) {
        opened = await handleOpenLastBooks(appService, settings.lastOpenBooks, library);
      }
      setCheckLastOpenBooks(opened);

      // Skip the redundant setLibrary on the cached path: the store already
      // contains the same array reference, and a no-op set would still
      // trigger refreshGroups (O(n) MD5) and a full Bookshelf re-render.
      // The cold path or the openWith / openLast path may have produced a
      // different `library` reference (intent-imported books) — only then
      // do we commit it.
      if (!hasCachedLibrary || library !== libraryBooks) {
        setLibrary(library);
      }
      setLibraryLoaded(true);
      if (loadingTimeout) clearTimeout(loadingTimeout);
      setLoading(false);
    };

    const handleOpenWithBooks = async (appService: AppService, library: Book[]) => {
      const openWithFiles = (await parseOpenWithFiles(appService)) || [];

      if (openWithFiles.length > 0) {
        return await processOpenWithFiles(appService, openWithFiles, library);
      }
      return false;
    };

    initLogin();
    initLibrary();
    return () => {
      setCheckOpenWithBooks(false);
      setCheckLastOpenBooks(false);
      isInitiating.current = false;
    };
    // Non-search URL changes trigger parsing OPEN_WITH_FILES without reinitializing on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryInitKey]);

  useEffect(() => {
    const group = searchParams?.get('group') || '';
    const groupName = getGroupName(group);
    setCurrentGroupPath(groupName);
  }, [libraryBooks, searchParams, getGroupName, settings.libraryFolders]);

  useEffect(() => {
    refreshGroups();
  }, [settings.libraryFolders, refreshGroups]);

  useEffect(() => {
    if (
      (searchParams?.toString() || '') !== new URLSearchParams(window.location.search).toString()
    ) {
      return;
    }
    const urlQuery = searchParams?.get('q') ?? '';
    if (pendingLibrarySearchQueryRef.current === urlQuery) {
      pendingLibrarySearchQueryRef.current = null;
    }
    if (pendingLibrarySearchQueryRef.current === null) setLibrarySearchQuery(urlQuery);
    const target = ['contents', 'text'].includes(searchParams?.get('search') ?? '')
      ? 'text'
      : 'books';
    const config = getLibrarySearchConfig(searchParams);
    librarySearchTargetRef.current = target;
    librarySearchConfigRef.current = config;
    setLibrarySearchTarget(target);
    setLibrarySearchConfig(config);
  }, [searchParams]);

  useEffect(() => {
    const group = searchParams?.get('group') || '';
    restoreScrollPosition(group);
  }, [searchParams, restoreScrollPosition]);

  // A retired subject link may contain a virtual group ID. Drop both so it
  // cannot strand the user on an empty shelf after the category is removed.
  useEffect(() => {
    if (searchParams?.get('groupBy') !== 'subject') return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('groupBy', LibraryGroupByType.None);
    params.set('group', '');
    navigateToLibrary(router, params.toString());
  }, [searchParams, router]);

  // Track the current virtual group for the navigation header.
  useEffect(() => {
    const groupId = searchParams?.get('group') || '';
    const groupByParam = searchParams?.get('groupBy');
    const groupBy = ensureLibraryGroupByType(groupByParam, settings.libraryGroupBy);

    if (
      groupId &&
      (groupBy === LibraryGroupByType.Series ||
        groupBy === LibraryGroupByType.Author ||
        groupBy === LibraryGroupByType.Tag)
    ) {
      // Find the group to get its name
      const allGroups = createBookGroups(
        libraryBooks.filter((b) => !b.deletedAt),
        groupBy,
      );
      const targetGroup = findGroupById(allGroups, groupId);

      if (targetGroup) {
        setCurrentVirtualGroup({
          groupBy,
          groupName: targetGroup.displayName || targetGroup.name,
        });
      } else {
        setCurrentVirtualGroup(null);
      }
    } else {
      setCurrentVirtualGroup(null);
    }
  }, [libraryBooks, searchParams, settings.libraryGroupBy]);

  useEffect(() => {
    if (demoBooks.length > 0 && libraryLoaded) {
      const newLibrary = [...libraryBooks];
      for (const book of demoBooks) {
        const idx = newLibrary.findIndex((b) => b.hash === book.hash);
        if (idx === -1) {
          newLibrary.push(book);
        } else {
          newLibrary[idx] = book;
        }
      }
      setLibrary(newLibrary);
      appService?.saveLibraryBooks(newLibrary);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoBooks, libraryLoaded]);

  const importBooks = async (
    files: SelectedFile[],
    groupId?: string,
    options: FolderImportOptions & { silent?: boolean; throwOnFailure?: boolean } = {},
  ): Promise<{ failedPaths: string[] }> => {
    const ownsProgress = !options.silent && !options.onProgress;
    const controller = ownsProgress ? new AbortController() : null;
    if (controller) {
      fileImportController.current = controller;
      retryFileImport.current = () => {
        void importBooks(files, groupId);
      };
      options = { ...options, signal: controller.signal };
      setFileImportState({ completed: 0, total: files.length });
    }
    setLoading(true);
    const { library } = useLibraryStore.getState();
    // Build the lookup index ONCE per import batch so each book lookup is
    // O(1) instead of O(n) over the existing library. importBook also keeps
    // the index updated as new books are appended, so subsequent files in
    // the same batch see the additions.
    //
    // `osPlatform` is required for the `byFilePath` arm: on case-insensitive
    // filesystems (macOS / iOS / Windows) two paths that differ only in
    // casing must hash to the same key, so the in-place fast path in
    // importBook can recognize a re-import of the same file.
    const lookupIndex = buildBookLookupIndex(library, appService?.osPlatform);
    const failedImports: Array<{ filename: string; errorMessage: string }> = [];
    const failedPaths: string[] = [];
    const successfulImports: string[] = [];
    let addedImports = 0;
    let existingImports = 0;

    // Readest's own Books/ prefix is resolved once at app init and persisted
    // in `settings.localBooksDir`. We hand it to `ingestFile` so the in-place
    // decision can exclude files that already live inside our managed hash
    // store WITHOUT misclassifying user-owned folders that happen to be
    // named "Books" (e.g. Baidu Netdisk's default `Books/` directory
    // directly under the user's library root).
    const appBooksPrefix: string | null =
      useSettingsStore.getState().settings.localBooksDir || null;

    const processFile = async (selectedFile: SelectedFile): Promise<Book | null> => {
      const file = selectedFile.file || selectedFile.path;
      if (!file) return null;
      if (!appService) return null;
      try {
        const { path, basePath } = selectedFile;
        // `groupId` is treated as a tri-state:
        //   - undefined  → caller didn't specify; derive grouping from
        //                  basePath (Import-from-Folder "keep" mode).
        //   - '' (empty) → caller explicitly wants the library root.
        //   - any string → caller explicitly wants that group.
        // Distinguishing '' from undefined matters for re-imports of an
        // already-known book: without it, a falsy check would silently
        // keep the existingBook's stale groupId/groupName from a prior
        // import instead of moving the book to the root.
        let resolvedGroupId = groupId;
        let resolvedGroupName = groupId !== undefined ? getGroupName(groupId) : undefined;
        if (resolvedGroupId === undefined && selectedFile.groupName !== undefined) {
          resolvedGroupName = selectedFile.groupName;
          resolvedGroupId = resolvedGroupName ? getGroupId(resolvedGroupName) : '';
        } else if (resolvedGroupId === undefined && path && basePath) {
          resolvedGroupName = getFolderImportGroupName(path, basePath);
          resolvedGroupId = getGroupId(resolvedGroupName);
        }
        // Read settings from the store at call-time rather than the
        // component closure. `runFolderImport` may have just registered
        // the picked directory as an external library folder via
        // `setSettings(...)`, but React state updates don't mutate the
        // already-captured `settings` reference until the next render —
        // by the time we get here, the closure still holds the *old*
        // settings, so `shouldImportInPlace` would see an empty
        // `externalLibraryFolders` and incorrectly fall back to copy
        // mode. Pulling the latest snapshot from zustand fixes this.
        const liveSettings = useSettingsStore.getState().settings;
        let importStatus: 'added' | 'existing' = 'added';
        const book = await ingestFile(
          {
            file,
            markdownResourceRoot: selectedFile.resourceRoot ?? basePath,
            books: library,
            lookupIndex,
            retryPDFContents: !options.silent,
            groupId: resolvedGroupId,
            groupName: resolvedGroupName,
            signal: options.signal,
            onResult: (status) => {
              importStatus = status;
            },
          },
          { appService, settings: liveSettings, isLoggedIn: !!user, appBooksPrefix },
        );
        if (!book) return null;
        successfulImports.push(book.title);
        if ((importStatus as string) === 'existing') existingImports++;
        else addedImports++;
        return book;
      } catch (error) {
        if (options.signal?.aborted && error instanceof Error && error.name === 'AbortError')
          return null;
        const filename = typeof file === 'string' ? file : file.name;
        if (typeof file === 'string') failedPaths.push(file);
        const baseFilename = getFilename(filename);
        const errorMessage = error instanceof Error ? _(getImportErrorMessage(error.message)) : '';
        failedImports.push({ filename: baseFilename, errorMessage });
        console.error('Failed to import book:', filename, error);
        return null;
      }
    };

    try {
      const concurrency = 4;
      for (let i = 0; i < files.length; i += concurrency) {
        if (options.signal?.aborted) break;
        const batch = files.slice(i, i + concurrency);
        const importedBooks = (await Promise.all(batch.map(processFile))).filter((book) => !!book);
        // Each import has already committed its identity and initial group under
        // the shared lock. Publish incrementally without saving a stale full snapshot.
        await updateBooks(envConfig, importedBooks, { skipSave: true });
        const completed = Math.min(i + batch.length, files.length);
        options.onProgress?.(completed, files.length);
        if (controller) setFileImportState((state) => state && { ...state, completed });
      }

      pushLibrary();

      if (options.throwOnFailure && failedImports.length) {
        throw new Error(
          failedImports[0]!.errorMessage || _('Couldn’t finish importing. Please try again.'),
        );
      }
      if (!options.silent && failedImports.length > 1) {
        setFailedImportsModal(failedImports);
      } else if (!options.silent && failedImports.length === 1) {
        const { filename, errorMessage } = failedImports[0]!;
        eventDispatcher.dispatch('toast', {
          message:
            _('Failed to import book(s): {{filenames}}', {
              filenames: listFormater(false).format([filename]),
            }) + (errorMessage ? `\n${errorMessage}` : ''),
          timeout: 5000,
          type: 'error',
        });
      }
      // Surface the success toast when books were imported. In silent (auto-import)
      // mode failures are suppressed, so show success independently of them; in
      // interactive mode keep the original behaviour (only when nothing failed).
      if (
        (!options.silent && successfulImports.length > 0) ||
        (options.silent && addedImports > 0)
      ) {
        eventDispatcher.dispatch('toast', {
          message: _('Added {{added}} · Already in library {{existing}} · Failed {{failed}}', {
            added: addedImports,
            existing: existingImports,
            failed: failedImports.length,
          }),
          timeout: 2000,
          type: 'success',
        });
      }

      if (controller) setFileImportState(null);
      return { failedPaths };
    } catch (error) {
      if (!controller) throw error;
      // Save failures keep selected files available for an explicit retry, even after Cancel.
      setFileImportState(
        (state) => state && { ...state, error: true, stopping: false, saving: false },
      );
      return { failedPaths };
    } finally {
      if (controller) fileImportController.current = null;
      setLoading(false);
    }
  };

  /**
   * Re-scan the given watched folders (the user's `autoImportFolders`) and
   * verify current file contents using the same identity transaction as manual
   * import. Existing records stay quiet; replaced editions can be imported.
   */
  const autoImportFromWatchedFolders = async (folders: string[]) => {
    if (!appService || loading || importFromFolderState) return;
    const { library } = useLibraryStore.getState();
    const osPlatform = appService.osPlatform;
    // Deleted/archived paths stay suppressed. Active paths must be verified:
    // their contents can change without a rename. Failed paths wait for retry.
    const existingPaths = collectKnownSourcePaths(
      library.filter((book) => !!book.deletedAt || !!book.duplicateOf),
      osPlatform,
    );
    for (const key of autoImportFailedPathsRef.current) existingPaths.add(key);
    const newFiles: SelectedFile[] = [];
    for (const folder of folders) {
      try {
        if (!autoImportGrantedFoldersRef.current.has(folder)) {
          await appService.allowPathsInScopes?.([folder], true);
          autoImportGrantedFoldersRef.current.add(folder);
        }
        const items = await appService.readDirectory(folder, 'None', SUPPORTED_BOOK_EXTS);
        const entries = items.map((item) => ({
          fullPath: joinScannedPath(folder, item.path),
          size: item.size,
        }));
        const fresh = selectNewImportableFiles(entries, {
          extensions: SUPPORTED_BOOK_EXTS,
          minSizeBytes: AUTO_IMPORT_MIN_SIZE_BYTES,
          existingPaths,
          osPlatform,
        });
        // Reproduce the folder's own "Folder Structure" choice: unless it was
        // imported flat, each file carries the watched folder as `basePath` so
        // `importBooks` seats the book in the group its subfolder implies —
        // the same group the folder's initial import used (issue #5423).
        newFiles.push(
          ...toWatchedFolderImports(
            folder,
            fresh,
            isFlattenedAutoImportFolder(folder),
            useSettingsStore.getState().settings.autoImportFolderGroups?.[normalizeRoot(folder)],
          ).map((file) => ({ ...file, resourceRoot: folder })),
        );
        for (const entry of fresh) {
          // Prevent the same file matching again via a later overlapping folder.
          const key = normalizeFilePathForIndex(entry.fullPath, osPlatform);
          if (key) existingPaths.add(key);
        }
      } catch (e) {
        // One unreadable/temporarily-missing folder must not abort the others
        // or nag the user (unlike the manual path, which nudges a re-pick).
        console.error('Auto-import: failed to scan folder', folder, e);
      }
    }
    if (newFiles.length > 0) {
      const { failedPaths } = await importBooks(newFiles, undefined, { silent: true });
      for (const p of failedPaths) {
        const key = normalizeFilePathForIndex(p, osPlatform);
        if (key) autoImportFailedPathsRef.current.add(key);
      }
    }
  };

  // Local-folder counterpart of useLibraryFileSync: re-scan the folders the
  // user opted into auto-import (a subset of externalLibraryFolders, chosen
  // per-folder in the Import-from-Folder dialog) and import newly-added books
  // on library open and app focus. Desktop + Android only (iOS security-scoped
  // bookmarks are out of scope).
  useAutoImportFolders({
    enabled:
      (settings.autoImportFolders?.length ?? 0) > 0 &&
      libraryLoaded &&
      isTauriAppPlatform() &&
      !appService?.isIOSApp,
    folders: settings.autoImportFolders ?? [],
    scanAndImport: autoImportFromWatchedFolders,
  });

  const updateBookTransferProgress = throttle((bookHash: string, progress: ProgressPayload) => {
    if (progress.total === 0) return;
    const progressPct = (progress.progress / progress.total) * 100;
    setBooksTransferProgress((prev) => ({
      ...prev,
      [bookHash]: progressPct,
    }));
  }, 500);

  const { handleBookUpload, handleBookDownload } = useBookTransferActions(
    envConfig,
    appService,
    updateBook,
    updateBookTransferProgress,
  );

  const removeBooks = async (
    books: Book[],
    options: {
      signal?: AbortSignal;
      onProgress?: (result: RemovalResult) => void;
    } = {},
    mode: 'trash' | 'purge' | 'local' = 'trash',
  ) => {
    if (!appService) throw new Error('Library unavailable');
    const result = await removeAppBooks(appService, books, mode, {
      ...options,
      cloudTargets: getEnabledFileSyncBackends(settings),
      onProgress: (progress) => {
        useLibraryStore.getState().setLibrary(progress.books);
        options.onProgress?.(progress);
      },
    });
    useLibraryStore.getState().setLibrary(result.books);
    const completed = result.completed;
    eventDispatcher.dispatch('toast', {
      type: result.failed.length ? 'error' : 'info',
      timeout: 8000,
      message: removalFeedback(result, mode, _),
      ...(mode === 'trash' && completed.length
        ? {
            action: {
              label: _('Undo'),
              onClick: () => {
                void restoreRemovedBooks(bookRemovalIO(appService), completed)
                  .then((rows) => {
                    useLibraryStore.getState().setLibrary(rows);
                    void pushLibrary();
                  })
                  .catch(() =>
                    eventDispatcher.dispatch('toast', {
                      type: 'error',
                      message: _('Could not restore books. Try again in Recently Deleted.'),
                    }),
                  );
              },
            },
          }
        : {}),
    });
    if (mode !== 'trash') for (const hash of completed) clearBookData(hash);
    void pushLibrary();
    return result;
  };
  const handleBookDelete =
    (action: Exclude<DeleteAction, 'cloud'>) => async (book: Book, signal?: AbortSignal) => {
      try {
        const result = await removeBooks(
          [book],
          { signal },
          action === 'purge' ? 'purge' : action === 'local' ? 'local' : 'trash',
        );
        return result.failed.length === 0 && result.pending.length === 0;
      } catch {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Removal failed. Your selection is kept. Try again.'),
        });
        return false;
      }
    };
  useEffect(() => {
    if (!appService) return;
    let active = true;
    const reload = () => {
      void appService
        .loadLibraryBooks()
        .then((rows) => {
          if (active) useLibraryStore.getState().setLibrary(rows);
        })
        .catch(() => {});
    };
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('glossa-library-removal');
    if (channel) channel.onmessage = reload;
    return () => {
      active = false;
      channel?.close();
    };
  }, [appService]);

  const handleUpdateMetadata = async (book: Book, metadata: BookMetadata, tags: string[]) => {
    // Build a NEW book object instead of mutating `book` in place. <BookCover>
    // is memoized and compares fields off the book, so mutating the existing
    // object (which React holds as the previous snapshot) makes the comparator
    // see no change and the library cover only refreshes after a full reload.
    const updatedBook = getBookWithUpdatedMetadata(book, metadata, tags);
    if (metadata.coverImageBlobUrl || metadata.coverImageUrl || metadata.coverImageFile) {
      try {
        await appService?.updateCoverImage(
          updatedBook,
          metadata.coverImageBlobUrl || metadata.coverImageUrl,
          metadata.coverImageFile,
        );
        // Cover-change sync (issue #4544): recompute the cover's content hash.
        // If it actually changed, bump coverHash + coverUpdatedAt so peers
        // re-download it (the book row already syncs via updatedAt).
        // computeCoverHash returns null for a '_blank' deletion — we skip the
        // bump there (cover deletion is intentionally not synced; peers keep
        // their cover until a new one is set).
        const newCoverHash = (await appService?.computeCoverHash(updatedBook)) ?? null;
        if (newCoverHash && newCoverHash !== book.coverHash) {
          // For a book already in the cloud, re-upload the cover FIRST and only
          // advertise the new version if it succeeded — otherwise peers would
          // try to fetch a cover that isn't there. A not-yet-uploaded book
          // carries the new cover on its first full upload, so the bump is safe.
          let coverUploaded = true;
          if (user && updatedBook.uploadedAt) {
            try {
              await appService?.uploadBookCover(updatedBook);
            } catch (uploadError) {
              console.warn('Failed to upload updated cover:', uploadError);
              coverUploaded = false;
            }
          }
          if (coverUploaded) {
            updatedBook.coverHash = newCoverHash;
            updatedBook.coverUpdatedAt = Date.now();
          }
        }
      } catch (error) {
        console.warn('Failed to update cover image:', error);
      }
    }
    if (isWebAppPlatform()) {
      // Clear HTTP cover image URL if cover is updated with a local file
      if (metadata.coverImageBlobUrl) {
        metadata.coverImageUrl = undefined;
      }
    } else {
      metadata.coverImageUrl = undefined;
    }
    metadata.coverImageBlobUrl = undefined;
    metadata.coverImageFile = undefined;
    await updateBook(envConfig, updatedBook);
  };

  const handleMetadataValueClick = (_type: 'tag', value: string) => {
    const groupBy = LibraryGroupByType.Tag;
    const targetGroup = createBookGroups(libraryBooks, groupBy).find(
      (item): item is BooksGroup => 'books' in item && item.name === value,
    );
    if (!targetGroup) return;
    const params = new URLSearchParams(window.location.search);
    params.set('groupBy', groupBy);
    params.set('group', targetGroup.id);
    params.delete('q');
    setShowDetailsBook(null);
    navigateToLibrary(router, params.toString());
  };

  const getImportTargetGroupId = () => {
    const groupBy = ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy);
    return groupBy === LibraryGroupByType.Group ? searchParams?.get('group') || '' : '';
  };

  const handleImportBooksFromFiles = async () => {
    setIsSelectMode(false);
    console.log('Importing books from files...');
    if (appService?.isAndroidApp) {
      // The dialog plugin's promise dies when Android tears down the activity
      // or process while the picker is in the foreground (#1217). Open the
      // native-bridge picker fire-and-forget instead; results arrive through
      // the replayable `file-picker-result` event consumed below.
      showFilePicker().catch((err) => console.error('Failed to open file picker:', err));
      return;
    }
    selectFiles({ type: 'books', multiple: true }).then((result) => {
      if (result.files.length === 0 || result.error) return;
      importBooks(result.files, getImportTargetGroupId());
    });
  };

  useAndroidPickedBooks(appService, (files) => {
    importBooks(files, getImportTargetGroupId());
  });

  const handleImportBookFromUrl = async (
    url: string,
    signal: AbortSignal,
    onStage: (stage: string) => void,
  ) => {
    if (
      !isTauriAppPlatform() ||
      !isPluginEnabled(useSettingsStore.getState().settings, 'webImport')
    )
      return;
    setIsSelectMode(false);
    const groupId = getImportTargetGroupId();
    const { importWebPage } = await pluginLoaders.webImport();
    signal.throwIfAborted();
    await importWebPage({
      url,
      translate: _,
      appService,
      signal,
      onStage,
      save: async (file, activeSignal) => {
        await importBooks([{ file }], groupId, {
          signal: activeSignal,
          onProgress: () => {},
          throwOnFailure: true,
        });
      },
    });
  };

  const handleImportBooksFromDirectory = async (dirPath?: string, destination?: string) => {
    if (!appService || !isTauriAppPlatform()) return;

    setIsSelectMode(false);

    if (dirPath) {
      try {
        await runFolderImport({ directory: dirPath, flatten: false }, destination);
      } catch {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Couldn’t finish importing. Please try again.'),
        });
      }
      return;
    }

    const ls = typeof window !== 'undefined' ? window.localStorage : null;
    setImportFromFolderState({
      initialDirectory: ls?.getItem(LAST_IMPORT_FOLDER_KEY) || '',
      initialFolderMode:
        ls?.getItem(LAST_IMPORT_FOLDER_MODE_KEY) === 'flatten' ? 'flatten' : 'keep',
    });
  };

  const scanImportDirectory = useCallback(
    async (directory: string, signal: AbortSignal): Promise<FileItem[]> => {
      if (!appService) throw new Error('App service unavailable');
      signal.throwIfAborted();
      await appService.allowPathsInScopes?.([directory], true);
      signal.throwIfAborted();
      const files = await appService.readDirectory(directory, 'None', SUPPORTED_BOOK_EXTS.slice());
      signal.throwIfAborted();
      return files.filter((file) =>
        SUPPORTED_BOOK_EXTS.includes(file.path.split('.').pop()?.toLowerCase() ?? ''),
      );
    },
    [appService],
  );

  /**
   * Pop the platform's native folder picker. Wrapped here (rather than
   * inlined into the dialog) so the same Android-permission / Tauri
   * dialog dance is shared between the dialog's "change folder" button
   * and any future programmatic import paths.
   */
  const pickImportDirectory = async (): Promise<string | undefined> => {
    if (!appService) return undefined;
    // Both mobile platforms now go through the native-bridge picker:
    // Android dispatches ACTION_OPEN_DOCUMENT_TREE, iOS presents
    // UIDocumentPickerViewController(forOpeningContentTypes: [.folder]).
    // Tauri's bundled dialog plugin still rejects mobile folder picks
    // with "FolderPickerNotImplemented", so the native-bridge route is
    // the only working path on either OS.
    let picked: string | undefined;
    if (appService.isAndroidApp || appService.isIOSApp) {
      // Android needs MANAGE_EXTERNAL_STORAGE for absolute-path reads;
      // iOS doesn't have an equivalent gate (the OS picker is itself
      // the permission grant), so the prompt is Android-only.
      if (appService.isAndroidApp && !(await requestStoragePermission())) return undefined;
      const response = await selectDirectory();
      picked = response.path || undefined;
    } else {
      picked = (await appService.selectDirectory?.('read')) || undefined;
    }
    if (picked && !validatePickedDirectory(picked)) {
      // Already toasted from inside the validator. Treat as "no
      // selection" so the caller leaves the dialog's old folder
      // value alone and the user can immediately try again.
      return undefined;
    }
    return picked;
  };

  /**
   * Sanity-check a path returned by the native folder picker before
   * we commit to scanning it. iOS in particular hands back POSIX paths
   * for "virtual" Files-app entries (the "On My iPhone" root, "Recents",
   * etc.) where {@link readDirectory} will then fail with a Tauri
   * fs_scope rejection. There's no way to disable those entries in the
   * picker itself, so we accept the pick, detect the known-bad shapes,
   * and show a clear toast asking the user to drill into a real
   * subfolder. Returns true if the path looks usable.
   */
  const validatePickedDirectory = (path: string): boolean => {
    if (!appService?.isIOSApp) return true;
    // iOS Files exposes "On My iPhone" as a virtual aggregator over
    // every app's `LSSupportsOpeningDocumentsInPlace` container. When
    // the user picks that root, the picker hands us a path whose
    // basename is exactly `File Provider Storage` (the placeholder
    // directory inside our own App Group container that the system
    // uses to materialise external file-provider contents on demand).
    // POSIX reads against it return either nothing or EPERM, and the
    // Tauri fs_scope refuses it outright because it's outside our
    // allowed globs. Drilling into a concrete subfolder produces a
    // normal, readable POSIX path, which is the path we want.
    //
    // These string anchors aren't localized — iOS keeps the on-disk
    // path in English regardless of the device language, so the
    // basename / segment match is stable.
    const trimmed = path.replace(/\/+$/, '');
    const basename = trimmed.split('/').pop() ?? '';
    const isOnMyIPhoneRoot = basename === 'File Provider Storage';
    if (isOnMyIPhoneRoot) {
      eventDispatcher.dispatch('toast', {
        type: 'warning',
        timeout: 6000,
        message: _(
          'iOS doesn\'t allow importing the "On My iPhone" root. Open it and pick a specific subfolder (e.g. Glossa, Downloads), then try again.',
        ),
      });
      return false;
    }
    return true;
  };

  /**
   * Normalize a path the same way `shouldImportInPlace` does so the
   * predicate / store helpers below stay consistent with the ingest
   * layer's own path-prefix matching. Trailing separators and Windows
   * backslashes are normalized; nothing else is touched.
   */
  const normalizeRoot = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

  const isAutoImportFolder = (directory: string): boolean => {
    const target = normalizeRoot(directory);
    return (
      !!target &&
      (useSettingsStore.getState().settings.autoImportFolders ?? []).some(
        (root) => normalizeRoot(root) === target,
      )
    );
  };

  const isFlattenedAutoImportFolder = (directory: string): boolean => {
    const target = normalizeRoot(directory);
    if (!target) return false;
    const roots = useSettingsStore.getState().settings.autoImportFlattenFolders ?? [];
    return roots.some((r) => normalizeRoot(r) === target);
  };

  /**
   * Add `directory` to `settings.externalLibraryFolders` (and persist
   * settings) so the ingest layer's `shouldImportInPlace` will pick
   * up subsequent imports from the same folder automatically. No-op
   * when the folder is already registered. A failed write keeps the
   * import open for retry rather than silently switching file handling.
   */
  const registerExternalLibraryFolder = async (directory: string): Promise<void> => {
    const target = normalizeRoot(directory);
    if (!target) return;
    const liveSettings = useSettingsStore.getState().settings;
    const existing = liveSettings.externalLibraryFolders ?? [];
    if (existing.some((r) => normalizeRoot(r) === target)) {
      return;
    }
    const next = [...existing, directory];
    const nextSettings = { ...liveSettings, externalLibraryFolders: next };
    setSettings(nextSettings);
    try {
      await saveSettings(envConfig, nextSettings);
    } catch (e) {
      const current = useSettingsStore.getState().settings;
      if (current.externalLibraryFolders === nextSettings.externalLibraryFolders) {
        setSettings({ ...current, externalLibraryFolders: liveSettings.externalLibraryFolders });
      }
      throw e;
    }
  };

  /**
   * Add or remove `directory` from `settings.autoImportFolders` (and persist)
   * according to the import defaults and existing per-folder watch state.
   * `flatten` records the same import's "Folder Structure" pick so later scans
   * can group newly-found books exactly like this import did — it is tracked in
   * a parallel list because only flattened folders need an entry. A no-op when
   * the folder is already in the desired state. Failed writes restore the
   * edited fields and let the user retry the import.
   */
  const setAutoImportFolder = async (
    directory: string,
    enabled: boolean,
    flatten: boolean,
    groupPath: string,
  ): Promise<void> => {
    const target = normalizeRoot(directory);
    if (!target) return;
    const liveSettings = useSettingsStore.getState().settings;
    const existing = liveSettings.autoImportFolders ?? [];
    const existingFlatten = liveSettings.autoImportFlattenFolders ?? [];
    const present = existing.some((r) => normalizeRoot(r) === target);
    const flattenPresent = existingFlatten.some((r) => normalizeRoot(r) === target);
    const flattenWanted = enabled && flatten;
    if (
      enabled === present &&
      flattenWanted === flattenPresent &&
      liveSettings.autoImportFolderGroups?.[target] === groupPath
    )
      return;
    // Append only when the folder isn't listed yet: re-adding an existing entry
    // would move it to the end and shuffle the Watched Folders list under the
    // user's finger every time they flip a row's structure.
    const without = (roots: string[]) => roots.filter((r) => normalizeRoot(r) !== target);
    const next = enabled ? (present ? existing : [...existing, directory]) : without(existing);
    const nextFlatten = flattenWanted
      ? flattenPresent
        ? existingFlatten
        : [...existingFlatten, directory]
      : without(existingFlatten);
    const nextSettings = {
      ...liveSettings,
      autoImportFolders: next,
      autoImportFlattenFolders: nextFlatten,
      autoImportFolderGroups: { ...liveSettings.autoImportFolderGroups, [target]: groupPath },
    };
    setSettings(nextSettings);
    try {
      await saveSettings(envConfig, nextSettings);
    } catch (e) {
      const current = useSettingsStore.getState().settings;
      setSettings({
        ...current,
        ...(current.autoImportFolders === nextSettings.autoImportFolders
          ? { autoImportFolders: liveSettings.autoImportFolders }
          : {}),
        ...(current.autoImportFlattenFolders === nextSettings.autoImportFlattenFolders
          ? { autoImportFlattenFolders: liveSettings.autoImportFlattenFolders }
          : {}),
        ...(current.autoImportFolderGroups === nextSettings.autoImportFolderGroups
          ? { autoImportFolderGroups: liveSettings.autoImportFolderGroups }
          : {}),
      });
      throw e;
    }
  };

  /** Use exactly the previewed files; direct ingress scans all supported formats. */
  const runFolderImport = async (
    result: ImportFromFolderResult,
    dropDestination?: string,
    options: FolderImportOptions = {},
  ) => {
    if (!appService || !result.directory) return;
    if (!validatePickedDirectory(result.directory)) throw new Error('Invalid import directory');
    const destination = dropDestination ?? getGroupName(getImportTargetGroupId()) ?? '';
    const root = droppedFolderPath(
      getFilename(result.directory.replace(/[\\/]+$/, '')),
      destination,
    );
    options.signal?.throwIfAborted();
    const files =
      result.files ??
      (await scanImportDirectory(result.directory, options.signal ?? new AbortController().signal));
    options.signal?.throwIfAborted();
    const liveSettings = useSettingsStore.getState().settings;
    const readInPlace = getFolderImportReadInPlace(liveSettings);
    if (readInPlace) await registerExternalLibraryFolder(result.directory);
    options.signal?.throwIfAborted();
    // Existing watched folders stay watched even when the defaults change.
    if (
      isAutoImportFolder(result.directory) ||
      (readInPlace && liveSettings.folderImportAutoImport)
    ) {
      await setAutoImportFolder(result.directory, true, result.flatten, root);
    }
    options.signal?.throwIfAborted();
    const filtered = files.filter((file) =>
      SUPPORTED_BOOK_EXTS.includes(file.path.split('.').pop()?.toLowerCase() ?? ''),
    );
    const entries = filtered.map((file) => ({
      fullPath: joinScannedPath(result.directory, file.path),
      size: file.size,
    }));
    // Same mapping the auto-import scan uses, so a folder's later scans group
    // newly-found books exactly like this import does.
    const toImportFiles: SelectedFile[] = toWatchedFolderImports(
      result.directory,
      entries,
      result.flatten,
      root,
    );
    for (const file of toImportFiles) {
      (file as SelectedFile).resourceRoot = result.directory;
      file.groupName = droppedFolderPath(file.groupName!, '');
    }
    if (!(await folders.ensure([root, ...toImportFiles.map((file) => file.groupName!)]))) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Unable to save folders. Please try again.'),
      });
      throw new Error('Unable to save folders. Please try again.');
    }
    if (toImportFiles.length === 0) {
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('No matching books found in the selected folder.'),
      });
      return;
    }
    options.signal?.throwIfAborted();
    await importBooks(toImportFiles, undefined, options);
  };

  const handleSetSelectMode = (selectMode: boolean) => {
    if (selectMode && appService?.hasHaptics) {
      impactFeedback('medium');
    }
    setIsSelectMode(selectMode);
    setIsSelectAll(false);
    setIsSelectNone(false);
  };

  const updateLibrarySearchUrl = (target: LibrarySearchTarget, config: LibrarySearchConfig) => {
    const params = new URLSearchParams(window.location.search);
    const query = pendingLibrarySearchQueryRef.current ?? librarySearchQuery;
    if (query) params.set('q', query);
    else params.delete('q');
    if (target === 'text') params.set('search', 'text');
    else params.delete('search');
    if (config.mode !== 'contains') params.set('mode', config.mode);
    else params.delete('mode');
    if (config.matchCase) params.set('matchCase', 'true');
    else params.delete('matchCase');
    if (config.matchDiacritics) params.set('matchDiacritics', 'true');
    else params.delete('matchDiacritics');
    if (config.mode === 'nearby-words' && config.nearbyWords !== DEFAULT_NEARBY_WORDS) {
      params.set('nearby', String(config.nearbyWords));
    } else {
      params.delete('nearby');
    }
    const value = params.toString();
    window.history.replaceState(null, '', `?${value}`);
    sessionStorage.setItem('lastLibraryParams', value);
  };

  const handleSearchTargetChange = (target: LibrarySearchTarget) => {
    librarySearchTargetRef.current = target;
    setLibrarySearchTarget(target);
    debouncedSearchUrlUpdate.cancel();
    updateLibrarySearchUrl(target, librarySearchConfigRef.current);
    if (target === 'text') handleSetSelectMode(false);
  };

  // The input itself stays instant; applying the query (URL, shelf filter,
  // content scans) debounces so typing does not re-filter the library or
  // restart searches on every keystroke.
  const updateLibrarySearchUrlRef = useRef<typeof updateLibrarySearchUrl>(null!);
  updateLibrarySearchUrlRef.current = updateLibrarySearchUrl;
  const debouncedSearchUrlUpdate = React.useMemo(
    () =>
      debounce(() => {
        updateLibrarySearchUrlRef.current(
          librarySearchTargetRef.current,
          librarySearchConfigRef.current,
        );
      }, 500),
    [],
  );
  useEffect(() => () => debouncedSearchUrlUpdate.cancel(), [debouncedSearchUrlUpdate]);

  // Immediate variant for history pills and other one-shot applications.
  const handleSearchQueryApply = (query: string) => {
    debouncedSearchUrlUpdate.cancel();
    const urlQuery = new URLSearchParams(window.location.search).get('q') ?? '';
    pendingLibrarySearchQueryRef.current = query === urlQuery ? null : query;
    setLibrarySearchQuery(query);
    updateLibrarySearchUrl(librarySearchTargetRef.current, librarySearchConfigRef.current);
  };

  const handleSearchQueryChange = (query: string) => {
    const urlQuery = new URLSearchParams(window.location.search).get('q') ?? '';
    pendingLibrarySearchQueryRef.current = query === urlQuery ? null : query;
    setLibrarySearchQuery(query);
    debouncedSearchUrlUpdate();
  };

  const handleSearchConfigChange = (config: LibrarySearchConfig) => {
    librarySearchConfigRef.current = config;
    React.startTransition(() => {
      setLibrarySearchConfig(config);
    });
    debouncedSearchUrlUpdate.cancel();
    updateLibrarySearchUrl(librarySearchTargetRef.current, config);
  };

  const handleSelectAll = () => {
    setIsSelectAll(true);
    setIsSelectNone(false);
  };

  const handleDeselectAll = () => {
    setIsSelectNone(true);
    setIsSelectAll(false);
  };

  const handleShowDetailsBook = (book: Book) => {
    setShowDetailsBook(book);
  };

  const handleNavigateToPath = (path: string | undefined) => {
    const group = path ? getGroupId(path) || '' : '';
    setIsSelectAll(false);
    setIsSelectNone(false);
    handleLibraryNavigation(group);
  };

  if (!appService || !insets || checkOpenWithBooks || checkLastOpenBooks) {
    return <div className='full-height bg-base-200' />;
  }

  const showBookshelf = libraryLoaded || libraryBooks.length > 0;

  return (
    <div
      ref={pageRef}
      aria-label={_('Your Library')}
      className={clsx(
        'library-page text-base-content full-height flex select-none flex-col overflow-hidden',
        viewSettings?.isEink ? 'bg-base-100' : 'bg-base-200',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <div
        className='relative top-0 z-40 w-full'
        role='banner'
        tabIndex={-1}
        aria-label={_('Library Header')}
      >
        <LibraryHeader
          isSidebarVisible={isLibrarySidebarVisible}
          onToggleSidebar={() => setIsLibrarySidebarVisible((visible) => !visible)}
          isSelectMode={isSelectMode}
          isSelectAll={isSelectAll}
          onImportBooks={setImportMenuAnchor}
          onPullLibrary={pullLibrary}
          onToggleSelectMode={() => handleSetSelectMode(!isSelectMode)}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          searchQuery={librarySearchQuery}
          searchTarget={librarySearchTarget}
          searchConfig={librarySearchConfig}
          onSearchConfigChange={handleSearchConfigChange}
          onSearchQueryChange={handleSearchQueryChange}
          onSearchTargetChange={handleSearchTargetChange}
        />
        <progress
          aria-label={_('Library Search Progress')}
          aria-hidden={librarySearchProgress != null ? 'false' : 'true'}
          className={clsx(
            'progress progress-success absolute bottom-0 left-0 right-0 h-1 translate-y-[2px] transition-opacity duration-200 sm:translate-y-[4px]',
            librarySearchProgress != null ? 'opacity-100' : 'opacity-0',
          )}
          value={librarySearchProgress ?? 0}
          max={100}
        />
        <progress
          aria-label={_('Library Sync Progress')}
          aria-hidden={isSyncing ? 'false' : 'true'}
          className={clsx(
            'progress progress-success absolute bottom-0 left-0 right-0 h-1 translate-y-[2px] transition-opacity duration-200 sm:translate-y-[4px]',
            isSyncing ? 'opacity-100' : 'opacity-0',
          )}
          value={syncProgress * 100}
          max='100'
        />
      </div>
      {((loading && !importFromFolderState && !fileImportState && !showImportFromUrl) ||
        isSyncing) && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )}
      <div className='glossa-library-workspace'>
        {isLibrarySidebarVisible && (
          <LibraryNavigation onNavigate={() => handleSetSelectMode(false)} />
        )}
        <div className='glossa-library-content'>
          {librarySearchTarget === 'text' &&
            !librarySearchQuery.trim() &&
            librarySearchHistory.length > 0 && (
              <div className='relative my-1 flex shrink-0 items-center px-4 sm:px-6'>
                <div className='no-scrollbar not-eink:[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%_-_12px),transparent)] flex flex-1 gap-1.5 overflow-x-auto'>
                  {librarySearchHistory.map((term) => (
                    <button
                      key={term}
                      type='button'
                      onClick={() => handleSearchQueryApply(term)}
                      className='bg-base-300/45 hover:bg-base-300/70 text-base-content/70 max-w-[60%] flex-shrink-0 whitespace-nowrap rounded-full px-3 py-0.5 text-xs'
                    >
                      <p className='truncate'>{term}</p>
                    </button>
                  ))}
                </div>
                <button
                  type='button'
                  onClick={() => {
                    clearLibrarySearchHistory();
                    setLibrarySearchHistory([]);
                  }}
                  title={_('Clear search history')}
                  aria-label={_('Clear search history')}
                  className='text-base-content/50 hover:text-base-content/80 flex h-6 w-8 shrink-0 items-center justify-center'
                >
                  <X className='h-4 w-4' />
                </button>
              </div>
            )}
          {currentVirtualGroup && (
            <GroupHeader
              groupBy={currentVirtualGroup.groupBy}
              groupName={currentVirtualGroup.groupName}
              groupId={searchParams?.get('group')}
            />
          )}
          {searchParams?.get('section') === 'recently-deleted' && <RecentlyDeleted />}
          {showBookshelf &&
            searchParams?.get('section') !== 'recently-deleted' &&
            (libraryBooks.some((book) => !book.deletedAt) ||
            ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy) ===
              LibraryGroupByType.Group ? (
              <div aria-label={_('Your Bookshelf')} className='flex min-h-0 flex-grow flex-col'>
                <div
                  ref={containerRef}
                  className={clsx(
                    'scroll-container drop-zone flex min-h-0 flex-grow flex-col',
                    isDragging && 'drag-over',
                  )}
                  style={{
                    paddingRight: `${insets.right}px`,
                    paddingLeft: `${insets.left}px`,
                  }}
                >
                  <DropIndicator />
                  <Bookshelf
                    libraryBooks={libraryBooks}
                    isSelectMode={isSelectMode}
                    isSelectAll={isSelectAll}
                    isSelectNone={isSelectNone}
                    onScrollerRef={handleScrollerRef}
                    renderGroupNavigation={
                      currentGroupPath
                        ? (openMenu) => (
                            <div className='glossa-shelf-breadcrumbs'>
                              <button
                                onClick={() => handleNavigateToPath(undefined)}
                                className='hover:bg-base-300 text-base-content/85 rounded px-2 py-1'
                              >
                                {_('All')}
                              </button>
                              {getBreadcrumbs(currentGroupPath).map((crumb, index, array) => {
                                const isLast = index === array.length - 1;
                                return (
                                  <React.Fragment key={index}>
                                    <ChevronRight
                                      size={iconSize}
                                      className='text-neutral-content rtl:rotate-180'
                                    />
                                    {isLast ? (
                                      <button
                                        type='button'
                                        className='glossa-folder-heading-action truncate rounded px-2 py-1'
                                        aria-haspopup='menu'
                                        aria-current='location'
                                        onClick={(event) => openMenu(event.currentTarget)}
                                      >
                                        {crumb.name}
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => handleNavigateToPath(crumb.path)}
                                        className='hover:bg-base-300 text-base-content/85 truncate rounded px-2 py-1'
                                      >
                                        {crumb.name}
                                      </button>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          )
                        : undefined
                    }
                    handleImportBooks={setImportMenuAnchor}
                    handleBookUpload={handleBookUpload}
                    handleBookDownload={handleBookDownload}
                    onRemoveBooks={removeBooks}
                    handleBookDelete={handleBookDelete('both')}
                    handleSetSelectMode={handleSetSelectMode}
                    handleShowDetailsBook={handleShowDetailsBook}
                    handleLibraryNavigation={handleLibraryNavigation}
                    booksTransferProgress={booksTransferProgress}
                    handlePushLibrary={pushLibrary}
                    onSearchContents={() => handleSearchTargetChange('text')}
                    onSearchProgress={setLibrarySearchProgress}
                    contentSearch={
                      librarySearchTarget === 'text'
                        ? { query: searchParams?.get('q') ?? '', config: librarySearchConfig }
                        : null
                    }
                  />
                </div>
              </div>
            ) : (
              <div className='hero drop-zone h-screen items-center justify-center'>
                <DropIndicator />
                <LibraryEmptyState onImport={setImportMenuAnchor} />
              </div>
            ))}
        </div>
      </div>
      {importMenuAnchor && (
        <ImportMenuPopup
          anchor={importMenuAnchor}
          onClose={() => setImportMenuAnchor(null)}
          onImportBooksFromFiles={handleImportBooksFromFiles}
          onImportBooksFromDirectory={
            appService?.canReadExternalDir ? handleImportBooksFromDirectory : undefined
          }
          onImportBookFromUrl={
            isTauriAppPlatform() && webImportEnabled ? () => setShowImportFromUrl(true) : undefined
          }
        />
      )}

      {showDetailsBook && (
        <BookDetailModal
          isOpen={!!showDetailsBook}
          book={showDetailsBook}
          onClose={() => setShowDetailsBook(null)}
          handleBookUpload={handleBookUpload}
          handleBookDownload={handleBookDownload}
          handleBookDelete={handleBookDelete('both')}
          handleBookDeleteLocalCopy={handleBookDelete('local')}
          handleBookPurge={handleBookDelete('purge')}
          handleBookMetadataUpdate={handleUpdateMetadata}
          onMetadataValueClick={handleMetadataValueClick}
        />
      )}
      {isTransferQueueOpen && (
        <ModalPortal>
          <TransferQueuePanel />
        </ModalPortal>
      )}
      <AboutWindow />
      <KeyboardShortcutsHelp />
      <UpdaterWindow />
      <MigrateDataWindow />
      <BackupWindow onPullLibrary={pullLibrary} />
      <CacheManagerWindow />
      {isSettingsDialogOpen && (
        <SettingsDialog bookKey={''} onSyncLibrary={() => void pullLibrary(true, true)} />
      )}

      {failedImportsModal && (
        <FailedImportsDialog
          failedImports={failedImportsModal}
          onClose={() => setFailedImportsModal(null)}
        />
      )}
      {importFromFolderState && (
        <ImportFromFolderDialog
          initialDirectory={importFromFolderState.initialDirectory}
          initialFolderMode={importFromFolderState.initialFolderMode}
          onPickDirectory={pickImportDirectory}
          onScanDirectory={scanImportDirectory}
          onCancel={() => setImportFromFolderState(null)}
          onConfirm={async (result, signal, onProgress) => {
            // Persist only confirmed choices; obsolete format/size filters are ignored.
            window.localStorage.setItem(LAST_IMPORT_FOLDER_KEY, result.directory);
            // A flat folder offers no grouping choice; don't overwrite the last explicit one.
            if (result.files?.some((file) => /[\\/]/.test(file.path))) {
              window.localStorage.setItem(
                LAST_IMPORT_FOLDER_MODE_KEY,
                result.flatten ? 'flatten' : 'keep',
              );
            }
            await runFolderImport(result, undefined, { signal, onProgress });
          }}
        />
      )}
      {fileImportState && (
        <FileImportDialog
          state={fileImportState}
          onRetry={() => retryFileImport.current?.()}
          onCancel={() => {
            if (fileImportController.current) {
              fileImportController.current.abort();
              setFileImportState((state) => state && { ...state, stopping: true });
            } else setFileImportState(null);
          }}
        />
      )}
      {showImportFromUrl && webImportEnabled && (
        <Suspense fallback={null}>
          <ImportFromUrlDialog
            isOpen
            onClose={() => setShowImportFromUrl(false)}
            onSubmit={handleImportBookFromUrl}
          />
        </Suspense>
      )}

      <ClipSignInAlert />
      <Toast />
    </div>
  );
};

const LibraryPage = () => {
  return (
    <Suspense fallback={<div className='full-height' />}>
      <LibraryPageWithSearchParams />
    </Suspense>
  );
};

export default LibraryPage;
