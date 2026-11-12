import { useEffect, useEffectEvent } from 'react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { warn } from '@tauri-apps/plugin-log';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { getImportErrorMessage } from '@/services/errors';
import { ingestFiles, type IngestFileResult } from '@/services/ingestService';
import { useLibraryStore } from '@/store/libraryStore';
import { eventDispatcher } from '@/utils/event';
import {
  ensureMainLibraryWindow,
  navigateToReader,
  showLibraryWindow,
  showReaderWindow,
} from '@/utils/nav';
import { getFilename } from '@/utils/path';

interface FileOpenRequest {
  files: string[];
  temporary: boolean;
}

export default function MacFileOpen({ enabled }: { enabled: boolean }) {
  const { appService, envConfig } = useEnv();
  const { user } = useAuth();
  const router = useRouter();
  const _ = useTranslation();

  const open = useEffectEvent(async function openFiles({ files, temporary }: FileOpenRequest) {
    if (!appService || !files.length) return;
    if (temporary) {
      showLibraryWindow(appService, files, true);
      return;
    }
    const notifyFailure = (paths: string[], reason?: string) => {
      eventDispatcher.dispatch('mac-file-open-toast', {
        type: 'error',
        message:
          _('Failed to import book(s): {{filenames}}', {
            filenames: paths.map(getFilename).join(', '),
          }) + (reason ? `\n${_(getImportErrorMessage(reason))}` : ''),
        timeout: 8000,
        action: { label: _('Retry'), onClick: () => void openFiles({ files: paths, temporary }) },
      });
    };
    try {
      const settings = await appService.loadSettings();
      const books = useLibraryStore.getState().library;
      const received = new Map<number, IngestFileResult>();
      let first = 0;
      let opened = false;
      let publication = Promise.resolve();
      const results = await ingestFiles(
        files.map((file, index) => ({
          file,
          books,
          forceCopy: true,
          onComplete: (result) => {
            publication = publication.then(async () => {
              if (result.book)
                await useLibraryStore.getState().updateBooks(envConfig, [result.book], {
                  skipSave: true,
                });
              if (opened) return;
              received.set(index, result);
              // Respect the system's order even if later files finish preparing first.
              while (received.has(first)) {
                const candidate = received.get(first++)!;
                if (!candidate.book) continue;
                const ids = [candidate.book.hash];
                if (settings.openBookInNewWindow || location.pathname.startsWith('/reader')) {
                  showReaderWindow(appService, ids);
                } else {
                  await ensureMainLibraryWindow(appService);
                  navigateToReader(router, ids);
                }
                opened = true;
                break;
              }
            });
            // The final await reports a publication failure to the user.
            void publication.catch(() => {});
          },
        })),
        { appService, settings, isLoggedIn: !!user },
      );
      await publication;
      const failed = files.filter((_, index) => !results[index]?.book);
      if (failed.length) {
        if (!opened) await ensureMainLibraryWindow(appService);
        notifyFailure(failed, results.find((result) => result.error)?.error?.message);
      } else if (results.some((result) => result.status === 'added')) {
        eventDispatcher.dispatch('mac-file-open-toast', {
          type: 'success',
          message: _('Added to library'),
          timeout: 1800,
        });
      }
    } catch (error) {
      void warn('Failed to finish opening a macOS document').catch(() => {});
      await ensureMainLibraryWindow(appService).catch(() => {});
      notifyFailure(files, error instanceof Error ? error.message : undefined);
    }
  });

  useEffect(() => {
    if (!enabled || !appService?.isMacOSApp) return;
    const window = getCurrentWindow();
    if (window.label !== 'main') return;
    let disposed = false;
    let draining = false;
    let pending = false;
    const drain = async () => {
      pending = true;
      if (draining || disposed) return;
      draining = true;
      try {
        while (pending && !disposed) {
          pending = false;
          const requests = await invoke<FileOpenRequest[]>('take_mac_file_opens');
          for (const request of requests) await open(request);
        }
      } catch (error) {
        console.error('Failed to receive macOS file opens', error);
        void warn(`Failed to receive macOS document requests: ${String(error)}`).catch(() => {});
      } finally {
        draining = false;
      }
    };
    const listener = listen('mac-file-open', () => void drain());
    // Drain immediately, then close the registration race once subscribed.
    // The queue lives outside the WebView and holds cold-start or locked opens.
    void drain();
    void listener.then(drain).catch((error) => {
      void warn(`Failed to listen for macOS document requests: ${String(error)}`).catch(() => {});
    });
    return () => {
      disposed = true;
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [appService, enabled]);

  return null;
}
