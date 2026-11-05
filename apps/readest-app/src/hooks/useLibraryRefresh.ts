import { useCallback, useEffect, useRef } from 'react';
import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';
import { LIBRARY_REFRESHED_EVENT, LIBRARY_UPDATED_EVENT } from '@/utils/libraryEvents';
import { recordLibraryDiagnostic } from '@/utils/libraryDiagnostics';

/** Reader saves reach the library while the reader is still open; focus covers missed events. */
export function useLibraryRefresh(
  appService: Pick<AppService, 'loadLibraryBooks'> | null | undefined,
) {
  const requestRefresh = useRef<() => void>(() => {});
  useEffect(() => {
    if (!appService) return;
    let active = true;
    let running = false;
    let queued = false;
    let pending: Set<string> | null = new Set();
    const flush = async () => {
      queued = false;
      if (!active || running) return;
      const hashes = pending ? [...pending] : undefined;
      pending = new Set();
      running = true;
      recordLibraryDiagnostic('library-refresh-start', {
        targeted: !!hashes,
        count: hashes?.length ?? 0,
      });
      try {
        const rows = await (hashes
          ? appService.loadLibraryBooks(hashes)
          : appService.loadLibraryBooks());
        // A later invalidation needs a fresh snapshot, never publish the stale one.
        if (active && pending !== null && !pending.size) {
          const store = useLibraryStore.getState();
          if (hashes && store.libraryLoaded) {
            const changed = new Map(rows.map((book) => [book.hash, book]));
            const requested = new Set(hashes);
            const combined = store.library
              .filter((book) => !requested.has(book.hash) || changed.has(book.hash))
              .map((book) => {
                const next = changed.get(book.hash);
                changed.delete(book.hash);
                return next ?? book;
              });
            store.setLibrary([...combined, ...changed.values()], true);
          } else store.setLibrary(rows, true);
          // A progress-only notification is not an instruction to retry missing artwork.
          if (!hashes) window.dispatchEvent(new Event(LIBRARY_REFRESHED_EVENT));
          recordLibraryDiagnostic('library-refresh-complete', { count: rows.length });
        }
      } catch {
        console.warn('Library refresh failed; keeping the current shelf.');
        recordLibraryDiagnostic('library-refresh-error');
      } finally {
        running = false;
        if (active && (pending === null || pending.size)) {
          // The discarded request's identities still need to be refreshed too.
          if (!hashes) pending = null;
          else if (pending) for (const hash of hashes) pending.add(hash);
          void flush();
        }
      }
    };
    const reload = (event?: { data?: unknown }) => {
      const data = event?.data;
      const hashes = data && typeof data === 'object' && 'hashes' in data ? data.hashes : null;
      if (
        !Array.isArray(hashes) ||
        !hashes.every((hash) => typeof hash === 'string') ||
        !useLibraryStore.getState().libraryLoaded
      )
        pending = null;
      else if (pending) for (const hash of hashes) pending.add(hash);
      if (!running && !queued) {
        queued = true;
        queueMicrotask(() => void flush());
      }
    };
    const fullReload = () => reload();
    requestRefresh.current = fullReload;
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LIBRARY_UPDATED_EVENT);
    if (channel) channel.onmessage = reload;
    const removal =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('glossa-library-removal');
    if (removal) removal.onmessage = fullReload;
    window.addEventListener('focus', fullReload);
    return () => {
      active = false;
      requestRefresh.current = () => {};
      channel?.close();
      removal?.close();
      window.removeEventListener('focus', fullReload);
    };
  }, [appService]);
  return useCallback(() => requestRefresh.current(), []);
}
