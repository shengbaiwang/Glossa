'use client';

import { clearPDFThumbnails } from '@/services/pdfThumbnails';

import ReadingSpeechPlayer from './tts/ReadingSpeechPlayer';

import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTransferStore } from '@/store/transferStore';
import { useGamepad } from '@/hooks/useGamepad';
import { useTranslation } from '@/hooks/useTranslation';
import { SystemSettings } from '@/types/settings';
import { parseOpenWithFiles } from '@/helpers/openWith';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { UnlistenFn } from '@tauri-apps/api/event';
import { tauriHandleClose, tauriHandleOnCloseWindow } from '@/utils/window';
import { uniqueId } from '@/utils/misc';
import { isPluginEnabled } from '@/glossa/plugins/registry';
import {
  closeReadingSession,
  pauseReadingActivity,
  startReadingActivity,
  supportsReadingTime,
} from '@/glossa/plugins/readingActivity';
import { eventDispatcher } from '@/utils/event';
import {
  closeReaderWindowOrGoToLibrary,
  openLibraryForBrowsing,
  navigateToLibrary,
} from '@/utils/nav';

import { BOOK_IDS_SEPARATOR } from '@/services/constants';

import useBooksManager from '../hooks/useBooksManager';
import useBookShortcuts from '../hooks/useBookShortcuts';
import { useReaderPaletteCommands } from '../hooks/useReaderPaletteCommands';
import Spinner from '@/components/Spinner';
import CloudHeadPreview from './CloudHeadPreview';
import SideBar from './sidebar/SideBar';
import Notebook from './notebook/Notebook';
import BooksGrid from './BooksGrid';
import { BackupWindow } from '@/app/library/components/BackupWindow';
import { CacheManagerWindow } from '@/app/library/components/CacheManagerWindow';
import { MigrateDataWindow } from '@/app/library/components/MigrateDataWindow';
import ModalPortal from '@/components/ModalPortal';

const SettingsDialog = lazy(() => import('@/components/settings/SettingsDialog'));
const BookDetailModal = lazy(() => import('@/components/metadata/BookDetailModal'));
const TransferQueuePanel = lazy(() => import('@/app/library/components/TransferQueuePanel'));

const ReaderContent: React.FC<{ ids?: string; settings: SystemSettings }> = ({ ids, settings }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { bookKeys, dismissBook, getNextBookKey } = useBooksManager();
  const { sideBarBookKey, setSideBarBookKey } = useSidebarStore();
  const { saveSettings } = useSettingsStore();
  const { getConfig, getBookData, saveConfig } = useBookDataStore();
  const { getView, setBookKeys, getViewSettings } = useReaderStore();
  const { initViewState, getViewState, clearViewState } = useReaderStore();
  const { isSettingsDialogOpen, settingsDialogBookKey } = useSettingsStore();
  const isTransferQueueOpen = useTransferStore((state) => state.isTransferQueueOpen);
  const [showDetailsBook, setShowDetailsBook] = useState<Book | null>(null);

  const isInitiating = useRef(false);
  const closingBooks = useRef<Promise<void> | null>(null);
  const closingViews = useRef(new Map<string, Promise<void>>());
  const [loading, setLoading] = useState(false);
  const [errorLoading, setErrorLoading] = useState(false);

  useBookShortcuts({ sideBarBookKey, bookKeys });
  useGamepad();
  const timeEnabled = useSettingsStore((s) => isPluginEnabled(s.settings, 'readingTime'));
  const hasBooks = bookKeys.length > 0;
  useEffect(() => {
    if (!appService || !supportsReadingTime(appService) || !timeEnabled || !hasBooks) return;
    const lifetime = new AbortController();
    void startReadingActivity(appService, lifetime.signal).catch(() => {});
    return () => lifetime.abort();
  }, [appService, timeEnabled, hasBooks]);

  useEffect(() => {
    if (showDetailsBook || isTransferQueueOpen) pauseReadingActivity();
  }, [showDetailsBook, isTransferQueueOpen]);

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;

    const pathname = window.location.pathname;
    const bookIds = ids || searchParams?.get('ids') || pathname.split('/reader/')[1] || '';
    const initialIds = bookIds.split(BOOK_IDS_SEPARATOR).filter(Boolean);
    const initialBookKeys = initialIds.map((id) => `${id}-${uniqueId()}`);
    setBookKeys(initialBookKeys);
    const uniqueIds = new Set<string>();
    console.log('Initialize books', initialBookKeys);
    initialBookKeys.forEach((key, index) => {
      const id = key.split('-')[0]!;
      const isPrimary = !uniqueIds.has(id);
      uniqueIds.add(id);
      if (!getViewState(key)) {
        initViewState(envConfig, id, key, isPrimary).catch((error) => {
          console.log('Error initializing book', key, error);
          setErrorLoading(true);
          eventDispatcher.dispatch('toast', {
            message: _('Unable to open book'),
            callback: async () => {
              const service = await envConfig.getAppService();
              await closeReaderWindowOrGoToLibrary(service, router);
            },
            timeout: 2000,
            type: 'error',
          });
        });
        if (index === 0) setSideBarBookKey(key);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleShowBookDetails = (event: CustomEvent) => {
      setShowDetailsBook(event.detail as Book);
      return true;
    };
    eventDispatcher.onSync('show-book-details', handleShowBookDetails);

    return () => {
      eventDispatcher.offSync('show-book-details', handleShowBookDetails);
    };
  }, []);

  useEffect(() => {
    if (bookKeys && bookKeys.length > 0) {
      const settings = useSettingsStore.getState().settings;
      const lastOpenBooks = bookKeys.map((key) => key.split('-')[0]!);
      if (settings.lastOpenBooks?.toString() !== lastOpenBooks.toString()) {
        settings.lastOpenBooks = lastOpenBooks;
        saveSettings(envConfig, settings);
      }
    }

    let unlistenOnCloseWindow: Promise<UnlistenFn>;
    if (appService?.hasWindow) {
      unlistenOnCloseWindow = tauriHandleOnCloseWindow(handleCloseBooks).catch((error) => {
        console.info('Failed to register close-window listener:', error);
        return () => {};
      });
    }
    const beforeUnload = () => {
      void handleCloseBooks().catch((error) => console.warn('Could not save the reader:', error));
    };
    window.addEventListener('beforeunload', beforeUnload);
    eventDispatcher.on('beforereload', handleCloseBooks);
    eventDispatcher.on('close-reader', handleCloseReaderToLibrary);
    eventDispatcher.on('quit-app', handleCloseBooks);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      eventDispatcher.off('beforereload', handleCloseBooks);
      eventDispatcher.off('close-reader', handleCloseReaderToLibrary);
      eventDispatcher.off('quit-app', handleCloseBooks);
      unlistenOnCloseWindow?.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKeys, appService?.hasWindow]);

  const saveBookConfig = async (bookKey: string) => {
    const config = getConfig(bookKey);
    const { book } = getBookData(bookKey) || {};
    const { isPrimary } = getViewState(bookKey) || {};
    if (isPrimary && book && config) {
      const settings = useSettingsStore.getState().settings;
      eventDispatcher.dispatch('sync-book-progress', { bookKey });
      eventDispatcher.dispatch('flush-kosync', { bookKey });
      await saveConfig(envConfig, bookKey, config, settings);
    }
  };

  const saveConfigAndCloseBook = (bookKey: string, keepTTSAlive = false) => {
    const pending = closingViews.current.get(bookKey);
    if (pending) return pending;
    if (!getViewState(bookKey)) return Promise.resolve();
    const close = async () => {
      const view = getView(bookKey);
      const { bookDoc } = getBookData(bookKey) ?? {};
      await Promise.all([saveBookConfig(bookKey), closeReadingSession(bookKey)]);
      try {
        view?.close();
      } catch (error) {
        console.warn('Could not release the book renderer:', error);
      } finally {
        view?.remove();
        if (bookDoc) clearPDFThumbnails(bookDoc);
        // A pane that keeps the WebView alive can keep a live TTS session.
        void eventDispatcher
          .dispatch(keepTTSAlive ? 'tts-close-book' : 'tts-stop', { bookKey })
          .catch((error) => console.warn('Could not release reading audio:', error));
        clearViewState(bookKey);
      }
    };
    const task = close().finally(() => closingViews.current.delete(bookKey));
    closingViews.current.set(bookKey, task);
    return task;
  };

  const navigateBackToLibrary = () => {
    navigateToLibrary(router, '', undefined, true);
  };

  const saveSettingsAndGoToLibrary = () => {
    saveSettings(envConfig, settings);
    navigateBackToLibrary();
  };

  const handleCloseReaderToLibrary = () => {
    return handleCloseBooks(true);
  };

  // Also wired directly to beforeunload/quit-app/window-close, which pass an
  // event object: only a literal `true` keeps TTS alive.
  const handleCloseBooks = (keepTTSAlive?: unknown) => {
    if (closingBooks.current) return closingBooks.current;
    const close = async () => {
      const settings = useSettingsStore.getState().settings;
      await saveSettings(envConfig, settings);
      await Promise.all(bookKeys.map((key) => saveConfigAndCloseBook(key, keepTTSAlive === true)));
    };
    closingBooks.current = close().finally(() => {
      closingBooks.current = null;
    });
    return closingBooks.current;
  };

  const handleGoToLibrary = async () => {
    if (appService?.hasWindow) {
      const reportFailure = () => {
        void eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Could not open the library window.'),
        });
      };
      try {
        openLibraryForBrowsing(appService, reportFailure);
      } catch {
        reportFailure();
      }
      return;
    }
    await handleCloseBooks(true);
    navigateBackToLibrary();
  };

  const handleCloseBook = async (bookKey: string) => {
    // Header X / pane close: an SPA-side close on web and the main window.
    // The Tauri reader-window branches below destroy their webview, which
    // takes the per-window TTS with it either way.
    await saveConfigAndCloseBook(bookKey, true);
    if (sideBarBookKey === bookKey) {
      setSideBarBookKey(getNextBookKey(sideBarBookKey));
    }
    dismissBook(bookKey);
    if (bookKeys.filter((key) => key !== bookKey).length == 0) {
      const openWithFiles = (await parseOpenWithFiles(appService)) || [];
      if (appService?.hasWindow) {
        if (openWithFiles.length > 0) return await tauriHandleClose();
        const currentWindow = getCurrentWindow();
        if (currentWindow.label.startsWith('reader')) {
          return await currentWindow.close();
        }
      }
      saveSettingsAndGoToLibrary();
    }
  };
  useReaderPaletteCommands(sideBarBookKey, bookKeys, handleCloseBook);

  const primaryKey = bookKeys?.[0];
  const bookData = primaryKey ? getBookData(primaryKey) : null;
  const viewSettings = primaryKey ? getViewSettings(primaryKey) : null;
  const waiting = !bookData?.book || !bookData.bookDoc || !viewSettings;
  useEffect(() => {
    if (!primaryKey || !waiting) return;
    setLoading(false);
    const timer = setTimeout(() => setLoading(true), 200);
    return () => clearTimeout(timer);
  }, [primaryKey, waiting]);
  if (!primaryKey) return null;
  if (waiting) {
    return errorLoading ? null : (
      <CloudHeadPreview bookKey={primaryKey}>
        {loading && (
          <div className='hero hero-content full-height'>
            <Spinner loading={true} />
          </div>
        )}
      </CloudHeadPreview>
    );
  }

  return (
    <div className='reader-content full-height flex'>
      <SideBar />
      <BooksGrid
        bookKeys={bookKeys}
        onCloseBook={handleCloseBook}
        onGoToLibrary={handleGoToLibrary}
      />
      <BackupWindow />
      <CacheManagerWindow />
      <MigrateDataWindow />
      {isTransferQueueOpen && (
        <ModalPortal>
          <Suspense fallback={<Spinner loading={true} />}>
            <TransferQueuePanel />
          </Suspense>
        </ModalPortal>
      )}
      {isSettingsDialogOpen && (
        <Suspense fallback={<Spinner loading={true} />}>
          <SettingsDialog bookKey={settingsDialogBookKey} />
        </Suspense>
      )}
      <Notebook />
      <ReadingSpeechPlayer />

      {showDetailsBook && (
        <Suspense fallback={<Spinner loading={true} />}>
          <BookDetailModal
            isOpen={!!showDetailsBook}
            book={showDetailsBook}
            onClose={() => setShowDetailsBook(null)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default ReaderContent;
