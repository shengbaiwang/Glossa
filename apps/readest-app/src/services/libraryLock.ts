import type { FileSystem } from '@/types/system';

type LockFileSystem = Pick<FileSystem, 'getPrefix'>;
const queues = new Map<string | LockFileSystem, Promise<unknown>>();

/** A live read/write transaction is exclusive across windows and drops on close/crash. */
async function withDatabaseLock<T>(
  prefix: string,
  task: () => Promise<T>,
  database: string,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('mutex');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('mutex', 'readwrite');
      const store = transaction.objectStore('mutex');
      let started = false;
      let done = false;
      let result: T;
      let failure: unknown;
      const keepAlive = () => {
        const request = store.get(prefix);
        request.onsuccess = () => {
          if (!started) {
            started = true;
            void Promise.resolve()
              .then(task)
              .then(
                (value) => {
                  result = value;
                  done = true;
                },
                (error: unknown) => {
                  failure = error;
                  done = true;
                  transaction.abort();
                },
              );
          }
          if (!done) keepAlive();
        };
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(failure ?? transaction.error ?? new Error('Library lock interrupted'));
      transaction.onerror = () => reject(failure ?? transaction.error);
      keepAlive();
    });
  } finally {
    db.close();
  }
}

/** Same lock for import commits, library writes, and duplicate cleanup. */
export async function withLibraryLock<T>(
  fs: LockFileSystem,
  task: () => Promise<T>,
  namespace: 'library' | 'book-data' = 'library',
): Promise<T> {
  const prefix = await fs.getPrefix('Books');
  const key = prefix ? `${namespace}:${prefix}` : fs;
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      if (prefix && typeof navigator !== 'undefined' && navigator.locks) {
        return navigator.locks.request(`glossa-${namespace}:${prefix}`, task);
      }
      if (prefix && typeof indexedDB !== 'undefined')
        return withDatabaseLock(prefix, task, `glossa-${namespace}-locks`);
      if (prefix && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        throw new Error('Could not lock the library. Please retry.');
      }
      // Node and isolated in-memory adapters share the process queue above.
      return task();
    });
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}
