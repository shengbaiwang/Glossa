import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { getLibraryFilename } from '@/utils/book';
import { contentIdentity, fingerprintBook } from './bookIdentity';
import { withLibraryLock } from './libraryLock';
import { safeLoadJSON } from './persistence';
import { saveLibraryBooksUnlocked } from './libraryService';

type DownloadIO = Pick<
  FileSystem,
  'getPrefix' | 'exists' | 'openFile' | 'readDir' | 'readFile' | 'writeFile'
>;

/** Both cloud transports verify actual bytes and preserve legacy personal records. */
export async function registerBookDownload(io: DownloadIO, book: Book, live: Book[] = []) {
  return withLibraryLock(io, async () => {
    const actual = await fingerprintBook(io, book);
    if (!actual) throw new Error('Downloaded book file is unavailable');
    const disk = await safeLoadJSON<Book[]>(io, getLibraryFilename(), 'Books', []);
    const current = new Map(live.map((row) => [row.hash, row]));
    for (const row of Array.isArray(disk) ? disk : []) {
      const previous = current.get(row.hash);
      const latest =
        !previous || row.updatedAt >= previous.updatedAt ? { ...previous, ...row } : previous;
      current.set(row.hash, {
        ...latest,
        ...((row.duplicateUpdatedAt ?? 0) > (latest.duplicateUpdatedAt ?? 0)
          ? { duplicateOf: row.duplicateOf, duplicateUpdatedAt: row.duplicateUpdatedAt }
          : {}),
      });
    }
    const sameHash = current.get(book.hash);
    for (const row of [book, sameHash]) {
      if (!row) continue;
      const expected = row.storedContentFingerprint ?? contentIdentity(row);
      if (expected && expected !== actual) throw new Error('Downloaded book fingerprint mismatch');
    }
    const identity = contentIdentity(sameHash ?? book) ?? contentIdentity(book) ?? actual;
    let keeper: Book | undefined;
    for (const row of current.values()) {
      if (row.hash === book.hash || row.deletedAt || row.duplicateOf) continue;
      let known = contentIdentity(row);
      if (!known) {
        try {
          known = await fingerprintBook(io, row, undefined, false);
        } catch {
          /* Unavailable bytes do not prove identity. */
        }
      }
      if (known === identity) {
        keeper = row;
        break;
      }
    }
    const incoming: Book = {
      ...(sameHash ?? book),
      contentFingerprint: identity,
      storedContentFingerprint: actual,
      downloadedAt: book.downloadedAt ?? Date.now(),
      syncedAt: book.syncedAt ?? sameHash?.syncedAt,
      coverImageUrl: book.coverImageUrl ?? sameHash?.coverImageUrl,
      ...(keeper && !sameHash?.duplicateOf
        ? {
            duplicateOf: keeper.hash,
            duplicateUpdatedAt: Math.max(Date.now(), (sameHash?.duplicateUpdatedAt ?? 0) + 1),
          }
        : {}),
    };
    await saveLibraryBooksUnlocked(io, [incoming]);
    current.set(incoming.hash, incoming);
    return { book: incoming, books: [...current.values()] };
  });
}
