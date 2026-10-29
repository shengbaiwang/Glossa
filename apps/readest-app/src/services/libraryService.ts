import { notifyLibraryUpdated } from '@/utils/libraryEvents';
import { FileSystem, SaveLibraryBooksOptions } from '@/types/system';
import { Book } from '@/types/book';
import { removeBookSubjectMetadata } from '@/utils/bookMetadata';
import { repairImportedMetadata } from '@/utils/importMetadata';
import type { JSONFileSystem } from './persistence';
import { loadLibraryRows, writeLibraryRows } from './libraryRepository';
import { withLibraryLock } from './libraryLock';
import { mergeLibraryBook } from '@/utils/libraryMerge';
export { mergeLibraryBook } from '@/utils/libraryMerge';
import { contentIdentity } from './bookIdentity';

const COVER_CONCURRENCY = 20;

async function processInBatches<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

export async function loadLibraryBooks(
  fs: FileSystem,
  generateCoverImageUrl: (book: Book) => Promise<string>,
  hashes?: string[],
): Promise<Book[]> {
  if (!(await fs.exists('', 'Books'))) {
    await fs.createDir('', 'Books', true);
  }

  const books = await loadLibraryRows(fs, { hashes });

  let removedSubjects = false;
  await processInBatches(books, COVER_CONCURRENCY, async (book) => {
    // Cleanup does not alter the metadata or reading clocks.
    if (book.metadata) {
      const metadata = removeBookSubjectMetadata(book.metadata);
      removedSubjects ||= metadata !== book.metadata;
      book.metadata = metadata;
    }
    repairImportedMetadata(book);
    book.coverImageUrl = await generateCoverImageUrl(book);
    book.updatedAt ??= book.lastUpdated || Date.now();
  });

  // Re-read the latest disk rows and remove only retired fields. Do not write
  // the load snapshot over an edit another window made while covers loaded.
  if (removedSubjects) {
    try {
      await saveLibraryBooks(fs, []);
    } catch {
      // Reading remains available; the next load or routine save retries cleanup.
      console.warn('Could not persist retired book subject cleanup.');
    }
  }
  return books;
}

export async function saveLibraryBooks(
  fs: FileSystem,
  books: Book[],
  options?: SaveLibraryBooksOptions,
): Promise<Book[]> {
  const saved = await withLibraryLock(fs, () => saveLibraryBooksUnlocked(fs, books, options));
  notifyLibraryUpdated();
  return saved;
}

/** Caller must hold withLibraryLock; import commits share this transaction boundary. */
export async function saveLibraryBooksUnlocked(
  fs: JSONFileSystem,
  books: Book[],
  options?: SaveLibraryBooksOptions,
  diskSnapshot?: Book[],
): Promise<Book[]> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const incoming = books.map(({ coverImageUrl, ...rest }) => ({
    ...rest,
    ...(rest.metadata ? { metadata: removeBookSubjectMetadata(rest.metadata) } : {}),
  }));

  if (options?.replace) {
    await writeLibraryRows(fs, incoming, diskSnapshot);
    return incoming;
  }

  // Merge-floor: treat the on-disk library as a floor. A routine save may add
  // new books or modify existing rows (including setting `deletedAt`
  // tombstones), but it must never silently drop a book that exists on disk.
  // This stops a stale or partially-loaded in-memory library (e.g. the
  // cold-start "Open with" race) from wiping library.json. Deliberate removals
  // must go through `{ replace: true }`.
  const existing = diskSnapshot ?? (await loadLibraryRows(fs));
  const merged = new Map<string, Book>();
  for (const book of Array.isArray(existing) ? existing : []) {
    const metadata = book.metadata && removeBookSubjectMetadata(book.metadata);
    merged.set(book.hash, metadata !== book.metadata ? { ...book, metadata } : book);
  }
  for (const book of incoming) {
    const previous = merged.get(book.hash);
    if (
      previous &&
      contentIdentity(previous) &&
      contentIdentity(book) &&
      contentIdentity(previous) !== contentIdentity(book)
    ) {
      throw new Error('Book content identity conflict');
    }
    merged.set(book.hash, {
      ...(previous ? mergeLibraryBook(previous, book) : book),
      contentFingerprint: book.contentFingerprint ?? previous?.contentFingerprint,
      storedContentFingerprint: book.storedContentFingerprint ?? previous?.storedContentFingerprint,
      ...((previous?.duplicateUpdatedAt ?? 0) > (book.duplicateUpdatedAt ?? 0)
        ? { duplicateOf: previous?.duplicateOf, duplicateUpdatedAt: previous?.duplicateUpdatedAt }
        : {}),
    });
  }
  const persisted = Array.from(merged.values());
  await writeLibraryRows(fs, persisted, existing);
  return persisted;
}
