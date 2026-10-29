import { Book } from '@/types/book';
import { AppService, BaseDir } from '@/types/system';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { getCoverFilename, getLocalBookFilename, getConfigFilename } from '@/utils/book';
import { LocalStore } from './localStore';
import { libraryIdentityIO } from '@/services/bookIdentity';
import { registerBookDownload } from '@/services/bookDownloadIdentity';
import { bookRemovalIO, cleanRemovedBook } from '@/services/appBookRemoval';
import {
  acknowledgeRemoval,
  applyPeerRemoval,
  loadRemovalBooks,
  withCurrentRemoval,
} from '@/services/bookRemovalService';
import { getEnabledFileSyncBackends } from '@/services/sync/cloudSyncProvider';
import { withLibraryLock } from '@/services/libraryLock';
import { withBookDataWrite } from '@/services/bookDataLifecycle';
import { mergeLibraryBook } from '@/utils/libraryMerge';

/**
 * Where this device's copy of the book actually is, or null when it holds none
 * (the engine's `no-source` verdict). In-place imports keep their bytes outside
 * `Books/<hash>/`, so `book.filePath` is a valid fallback — but only a fallback.
 * The managed copy wins, exactly as `resolveBookContentSource` puts it:
 * "book.filePath is device-local and can outlive a prior in-place/import mode".
 *
 * Preferring `filePath` blindly is what kept #5084 alive into #5265. A row
 * poisoned by a pre-#5087 client carries a PEER's absolute path; probing only
 * that path reports `no-source` for a book whose managed copy is sitting right
 * there, so the engine never confirms the file on the remote and never stamps
 * `uploadedAt` — leaving the row classified as a purely-local book, the state
 * that turns "Remove from Device Only" into a cloud-and-device delete.
 */
const resolveLocalSource = async (
  appService: AppService,
  book: Book,
): Promise<{ path: string; base: BaseDir } | null> => {
  const managed = getLocalBookFilename(book);
  if (await appService.exists(managed, 'Books')) return { path: managed, base: 'Books' };
  if (book.filePath && (await appService.exists(book.filePath, 'None'))) {
    return { path: book.filePath, base: 'None' };
  }
  return null;
};

/**
 * The app-backed {@link LocalStore} used by every file-sync consumer (the
 * reader hook and the library "Sync now" form). Consolidating the buffered +
 * streaming book/cover loaders here is the whole reason the bridge exists:
 * the logic used to be copy-pasted across both consumers.
 */
export const createAppLocalStore = ({
  appService,
  settings,
  envConfig,
}: {
  appService: AppService;
  settings: SystemSettings;
  envConfig: EnvConfigType;
}): LocalStore => ({
  loadConfig: (book) => appService.loadBookConfig(book, settings),
  saveBookConfig: (book, config) => appService.saveBookConfig(book, config, settings),
  saveDownloadedConfig: (book, config) => {
    const io = libraryIdentityIO(appService);
    return withLibraryLock(io, async () => {
      if (!(await appService.exists(getConfigFilename(book), 'Books'))) {
        await appService.saveBookConfig(book, config, settings);
      }
    });
  },

  loadBookFile: async (book) => {
    const source = await resolveLocalSource(appService, book);
    if (!source) return null;
    const file = await appService.openFile(source.path, source.base);
    const bytes = await file.arrayBuffer();
    return { bytes, size: bytes.byteLength };
  },

  resolveLocalBookPath: async (book) => {
    const source = await resolveLocalSource(appService, book);
    if (!source) return null;
    const { path: fp, base } = source;
    const file = await appService.openFile(fp, base);
    const size = file.size;
    // Release the FD before streaming so the Tauri side can re-open the path
    // for the PUT without contending.
    const closable = file as { close?: () => Promise<void> };
    if (closable.close) await closable.close();
    const path = await appService.resolveFilePath(fp, base);
    return { path, size };
  },

  saveBookFile: async (book, bytes) => {
    await withBookDataWrite(book.hash, book.removal?.revision ?? 0, () =>
      appService.writeFile(getLocalBookFilename(book), 'Books', bytes),
    );
  },

  prepareLocalBookPath: async (book) => {
    // The Rust downloader writes the file verbatim and does NOT create parent
    // dirs — make sure the per-hash folder under Books exists first.
    try {
      if (!(await appService.exists(book.hash, 'Books'))) {
        await appService.createDir(book.hash, 'Books', true);
      }
    } catch (e) {
      console.warn('createAppLocalStore: mkdir failed', book.hash, e);
    }
    return appService.resolveFilePath(getLocalBookFilename(book), 'Books');
  },

  loadBookCover: async (book) => {
    const fp = getCoverFilename(book);
    if (!(await appService.exists(fp, 'Books'))) return null;
    const file = await appService.openFile(fp, 'Books');
    const bytes = await file.arrayBuffer();
    return { bytes, size: bytes.byteLength };
  },

  saveBookCover: async (book, bytes) => {
    await withBookDataWrite(book.hash, book.removal?.revision ?? 0, () =>
      appService.writeFile(getCoverFilename(book), 'Books', bytes),
    );
  },

  addBookToLibrary: async (book) => {
    try {
      book.coverImageUrl = await appService.generateCoverImageUrl(book);
    } catch (e) {
      // Missing/broken cover shouldn't block adding the book — the bookshelf
      // renders a placeholder when coverImageUrl is empty.
      console.warn('createAppLocalStore: cover URL generation failed', book.hash, e);
      book.coverImageUrl = null;
    }
    book.syncedAt = Date.now();
    book.downloadedAt = Date.now();
    if (!book.metaHash) book.metaHash = book.hash;
    const io = libraryIdentityIO(appService);
    const registered = await registerBookDownload(io, book, useLibraryStore.getState().library);
    useLibraryStore.getState().setLibrary(registered.books);
    return registered.book;
  },

  updateBookMetadata: async (book) => {
    if (book.removal) {
      await applyPeerRemoval(
        bookRemovalIO(appService),
        book,
        cleanRemovedBook(appService),
        getEnabledFileSyncBackends(settings),
      );
      useLibraryStore.getState().setLibrary(await loadRemovalBooks(bookRemovalIO(appService)));
      return;
    }
    // The cover bytes were just refreshed via saveBookCover, so regenerate the
    // device-local blob URL the bookshelf renders.
    try {
      book.coverImageUrl = await appService.generateCoverImageUrl(book);
    } catch (e) {
      console.warn('createAppLocalStore: cover URL generation failed', book.hash, e);
    }
    book.syncedAt = Date.now();
    // Hydrate before updating: updateBook merges against the in-memory library,
    // so an unloaded store would persist an empty (or single-book) library and
    // clobber the disk. See the same guard in addBookToLibrary.
    if (!useLibraryStore.getState().libraryLoaded) {
      useLibraryStore.getState().setLibrary(await appService.loadLibraryBooks(), true);
    }
    const current = useLibraryStore.getState().getBookByHash(book.hash);
    if (current) book = mergeLibraryBook(current, book);
    // updateBook persists via saveLibraryBooks and refreshes the store, so the
    // new title / author / cover show up without a reload.
    await useLibraryStore.getState().updateBook(envConfig, book);
  },

  markBooksUploaded: async (hashes, uploadedAt) => {
    if (!hashes.length) return;
    if (!useLibraryStore.getState().libraryLoaded) {
      useLibraryStore.getState().setLibrary(await appService.loadLibraryBooks(), true);
    }
    // Stamp the LIVE rows (see the LocalStore contract): a book the user read
    // while the sync was running must keep the progress it saved meanwhile.
    const wanted = new Set(hashes);
    const rows = useLibraryStore
      .getState()
      .library.filter((book) => wanted.has(book.hash) && !book.uploadedAt && !book.deletedAt)
      .map((book) => ({ ...book, uploadedAt }));
    if (!rows.length) return;
    await useLibraryStore.getState().updateBooks(envConfig, rows);
  },

  getCurrentBook: async (hash) =>
    (await loadRemovalBooks(bookRemovalIO(appService))).find((b) => b.hash === hash),
  acknowledgeRemoval: async (book, backend, status) => {
    useLibraryStore
      .getState()
      .setLibrary(await acknowledgeRemoval(bookRemovalIO(appService), book, backend, status));
  },
  withCurrentRemoval: (book, action) => withCurrentRemoval(bookRemovalIO(appService), book, action),
  withBookFileWrite: (book, action) =>
    withBookDataWrite(book.hash, book.removal?.revision ?? 0, action),
  deleteBookLocally: async (book) => {
    if (book.removal) {
      const applied = await applyPeerRemoval(
        bookRemovalIO(appService),
        book,
        cleanRemovedBook(appService),
        getEnabledFileSyncBackends(settings),
      );
      useLibraryStore.getState().setLibrary(await loadRemovalBooks(bookRemovalIO(appService)));
      return applied;
    }
    // Legacy tombstones still propagate, but failed filesystem work must remain retryable.
    await appService.deleteBook(book, 'local');
    book.coverImageUrl = null;
    book.syncedAt = Date.now();
    if (!useLibraryStore.getState().libraryLoaded) {
      useLibraryStore.getState().setLibrary(await appService.loadLibraryBooks(), true);
    }
    const current = useLibraryStore.getState().getBookByHash(book.hash);
    if (current) book = mergeLibraryBook(current, book);
    await useLibraryStore.getState().updateBook(envConfig, book);
    return book;
  },
});
