import type { AppService } from '@/types/system';
import type { Book, ZoteroSource } from '@/types/book';
import { libraryIdentityIO } from '@/services/bookIdentity';
import { ingestFile } from '@/services/ingestService';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { readingSpaces } from '@/utils/readingSpaces';
import { withLibraryLock } from '@/services/libraryLock';
import { loadLibraryRows } from '@/services/libraryRepository';
import { saveLibraryBooksUnlocked } from '@/services/libraryService';
import { notifyLibraryUpdated } from '@/utils/libraryEvents';
import { mergeLibraryBook } from '@/utils/libraryMerge';
/** Import a verified copy; even registered external folders never make Zotero files writable. */
export async function importZoteroAttachment(
  appService: AppService,
  path: string,
  source: ZoteroSource,
  signal: AbortSignal,
): Promise<Book> {
  signal.throwIfAborted();
  const book = await ingestFile(
    {
      file: path,
      books: useLibraryStore.getState().library,
      forceCopy: true,
      readingSpace: 'academic',
      zoteroSource: source,
      signal,
    },
    { appService, settings: useSettingsStore.getState().settings, isLoggedIn: false },
  );
  if (!book) throw new Error('Could not import the Zotero attachment.');
  // New files already carry these fields atomically. Existing identities gain membership
  // under the same library lock; personal metadata, deletion state and progress are re-read.
  const io = libraryIdentityIO(appService);
  const linked = await withLibraryLock(io, async () => {
    signal.throwIfAborted();
    const rows = await loadLibraryRows(io);
    const current = rows.find((b) => b.hash === book.hash);
    if (!current || current.deletedAt) throw new Error('This book has changed. Please retry.');
    const spaces = readingSpaces(current);
    const next: Book = {
      ...current,
      zoteroSource: current.zoteroSource ?? source,
      ...(!spaces.includes('academic')
        ? {
            readingSpaces: [...spaces, 'academic'],
            readingSpacesUpdatedAt: Math.max(Date.now(), current.readingSpacesUpdatedAt ?? 0) + 1,
          }
        : {}),
    };
    const saved = await saveLibraryBooksUnlocked(io, [next], undefined, rows);
    return saved.find((b) => b.hash === book.hash)!;
  });
  notifyLibraryUpdated([linked.hash]);
  const store = useLibraryStore.getState();
  const previous = store.library.find((b) => b.hash === linked.hash);
  store.setLibrary(
    previous
      ? store.library.map((b) => (b.hash === linked.hash ? mergeLibraryBook(b, linked) : b))
      : [...store.library, { ...book, ...linked }],
  );
  return { ...book, ...linked };
}
