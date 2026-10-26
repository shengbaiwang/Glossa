import { withLibraryLock } from './libraryLock';
import {
  saveBookDataConflict,
  BookDataConflictSaved,
  bookDataEditTime,
  type BookDataEdit,
  type BookDataConflict,
} from './bookDataConflicts';

type Barrier = { bookId: string; cutoff: number; blocked: boolean; blockedAt?: number };
const storageError = () =>
  new Error('This book was permanently deleted. Reopen the restored book before saving.');
const locked = <T>(bookId: string, action: () => Promise<T>) =>
  withLibraryLock({ getPrefix: async () => bookId }, action, 'book-data');
async function barrier(bookId: string, next?: Barrier | null): Promise<Barrier | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('glossa-book-data-lifecycle', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('books', { keyPath: 'bookId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(storageError());
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('books', next !== undefined ? 'readwrite' : 'readonly');
      const request =
        next === null
          ? tx.objectStore('books').delete(bookId)
          : next
            ? tx.objectStore('books').put(next)
            : tx.objectStore('books').get(bookId);
      tx.oncomplete = () => {
        const value = next ?? (request.result as Barrier | undefined);
        if (
          value &&
          (value.bookId !== bookId ||
            !Number.isFinite(value.cutoff) ||
            value.cutoff <= 0 ||
            typeof value.blocked !== 'boolean' ||
            (value.blockedAt !== undefined &&
              (!Number.isFinite(value.blockedAt) || value.blockedAt <= 0)))
        )
          reject(storageError());
        else resolve(value);
      };
      tx.onerror = tx.onabort = () => reject(storageError());
    });
  } finally {
    db.close();
  }
}

/** The caller's book snapshot supplies the generation; later reimport cannot revive an old writer. */
export async function withBookDataWrite<T>(
  bookId: string,
  revision: number,
  action: (cutoff: number) => Promise<T>,
  edit?: BookDataEdit & Pick<BookDataConflict, 'kind' | 'data'>,
): Promise<T> {
  if (typeof indexedDB === 'undefined') return action(0);
  return locked(bookId, async () => {
    const current = await barrier(bookId);
    if (current && (current.blocked || revision < current.cutoff)) {
      // Only the timestamp captured at a user action can preserve a new draft.
      // An automatic completion/retry cannot turn pre-deletion content into a new edit.
      if (edit && edit.editedAt > (current.blockedAt ?? current.cutoff)) {
        await saveBookDataConflict({
          ...edit,
          version: 1,
          bookId,
          dataRevision: revision,
          cutoff: current.cutoff,
        });
        throw new BookDataConflictSaved();
      }
      throw storageError();
    }
    return action(current?.cutoff ?? 0);
  });
}
export async function activateBookData(bookId: string, revision: number): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await locked(bookId, async () => {
    const current = await barrier(bookId);
    if (!current) return;
    if (revision <= current.cutoff) {
      if (current.blocked) throw storageError();
      return;
    }
    await barrier(bookId, { ...current, bookId, cutoff: revision, blocked: false });
  });
}
/** Explicit recovery advances the generation while excluding every old reader and writer. */
export async function withBookDataRecovery<T>(
  bookId: string,
  revision: number,
  action: (revision: number, published: () => void) => Promise<T>,
  verify: () => Promise<void> = async () => {},
): Promise<T> {
  return locked(bookId, async () => {
    await verify();
    const current = typeof indexedDB === 'undefined' ? undefined : await barrier(bookId);
    const next = Math.max(Date.now(), revision + 1, (current?.cutoff ?? 0) + 1);
    if (typeof indexedDB !== 'undefined')
      await barrier(bookId, { ...current, bookId, cutoff: next, blocked: false });
    let published = false;
    try {
      return await action(next, () => {
        published = true;
      });
    } catch (cause) {
      // No data is written until the library publishes this generation. If that
      // publication fails, release the provisional barrier under the same lock.
      if (!published && typeof indexedDB !== 'undefined') await barrier(bookId, current ?? null);
      throw cause;
    }
  });
}
export async function withPurgedBookData(
  bookId: string,
  revision: number,
  action: () => Promise<void>,
): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    if (typeof window !== 'undefined') throw new Error('Book data storage is unavailable.');
    return action();
  }
  await locked(bookId, async () => {
    const current = await barrier(bookId);
    if (current && (revision < current.cutoff || (!current.blocked && revision <= current.cutoff)))
      throw storageError();
    await barrier(bookId, {
      bookId,
      cutoff: Math.max(revision, current?.cutoff ?? 0),
      blocked: true,
      blockedAt:
        current && revision <= current.cutoff
          ? (current.blockedAt ?? current.cutoff)
          : bookDataEditTime(),
    });
    await action();
  });
}
