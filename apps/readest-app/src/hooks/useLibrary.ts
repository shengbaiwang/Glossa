import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { mergeLibraryBook } from '@/utils/libraryMerge';
import type { Book } from '@/types/book';

// A complete read owns membership, while current rows can carry newer personal
// edits, newly imported books, or explicitly transient "Open with" records.
function publishRows(rows: Book[], complete: boolean, previousHashes: Set<string>) {
  const store = useLibraryStore.getState();
  const merged = new Map(rows.map((book) => [book.hash, book]));
  for (const current of store.library) {
    const disk = merged.get(current.hash);
    if (disk) {
      merged.set(current.hash, mergeLibraryBook(current, disk));
    } else if (
      !complete ||
      !previousHashes.has(current.hash) ||
      (current.filePath && current.deletedAt && !current.removal)
    ) {
      merged.set(current.hash, current);
    }
  }
  store.setLibrary([...merged.values()], complete);
}

export const useLibrary = (bookIds?: string[]) => {
  const { envConfig } = useEnv();
  const storeLibraryLoaded = useLibraryStore((state) => state.libraryLoaded);
  const { setSettings } = useSettingsStore();
  const requested = bookIds?.length ? [...new Set(bookIds)] : undefined;
  const requestKey = requested?.join('\0') ?? '';
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(
    storeLibraryLoaded ? requestKey : null,
  );
  const libraryLoaded = storeLibraryLoaded || loadedRequestKey === requestKey;
  const readerReady = useReaderStore((state) =>
    Object.values(state.viewStates).some(
      (view) => view.inited && requested?.some((id) => view.key.startsWith(`${id}-`)),
    ),
  );

  useEffect(() => {
    if (storeLibraryLoaded) return;
    let active = true;
    const initLibrary = async () => {
      const appService = await envConfig.getAppService();
      const settings = await appService.loadSettings();
      if (!active) return;
      setSettings(settings);
      const previousHashes = new Set(useLibraryStore.getState().library.map((book) => book.hash));
      const rows = requested
        ? await appService.loadLibraryBooks(requested)
        : await appService.loadLibraryBooks();
      if (!active) return;
      publishRows(rows, !requested, previousHashes);
      setLoadedRequestKey(requestKey);
    };

    void initLibrary().catch((error) => {
      if (active) console.warn('Could not load library:', error);
    });
    return () => {
      active = false;
    };
    // Depend on route contents, not each render's array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeLibraryLoaded, requestKey]);

  useEffect(() => {
    if (!requested || !libraryLoaded || !readerReady || storeLibraryLoaded) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => {
        const previousHashes = new Set(useLibraryStore.getState().library.map((book) => book.hash));
        void envConfig
          .getAppService()
          .then((service) => service.loadLibraryBooks())
          .then((rows) => {
            if (active) publishRows(rows, true, previousHashes);
          })
          .catch((error) => {
            if (active) console.warn('Could not finish background library load:', error);
          });
      }, 0);
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryLoaded, readerReady, storeLibraryLoaded, requestKey]);

  return { libraryLoaded };
};
