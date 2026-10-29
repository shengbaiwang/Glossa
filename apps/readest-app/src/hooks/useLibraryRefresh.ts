import { useEffect } from 'react';
import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';
import { LIBRARY_UPDATED_EVENT } from '@/utils/libraryEvents';

/** Reader saves reach the library while the reader is still open; focus covers missed events. */
export function useLibraryRefresh(
  appService: Pick<AppService, 'loadLibraryBooks'> | null | undefined,
) {
  useEffect(() => {
    if (!appService) return;
    let sequence = 0;
    let active = true;
    const reload = () => {
      const request = ++sequence;
      void appService
        .loadLibraryBooks()
        .then((rows) => {
          if (active && request === sequence) useLibraryStore.getState().setLibrary(rows, true);
        })
        .catch(() => {});
    };
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LIBRARY_UPDATED_EVENT);
    if (channel) channel.onmessage = reload;
    window.addEventListener('focus', reload);
    return () => {
      active = false;
      channel?.close();
      window.removeEventListener('focus', reload);
    };
  }, [appService]);
}
