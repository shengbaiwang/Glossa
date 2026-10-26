import { withPurgedBookData } from './bookDataLifecycle';
/** Only stores whose records carry a verifiable book identity are scanned. No other book is cleared. */
const STORES = [
  ['glossa-conversations', 'books'],
  ['glossa-reading-mindmaps', 'mindmaps'],
  ['glossa-map-workspaces', 'workspaces'],
  ['glossa-map-inventories', 'inventories'],
  ['glossa-reading-inventories', 'inventories'],
  ['glossa-pdf-contents-history', 'inventories'],
  ['glossa-map-generation', 'checkpoints'],
] as const;
async function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let absent = false;
    request.onupgradeneeded = () => {
      absent = true;
      request.transaction!.abort();
    };
    request.onerror = () =>
      absent ? resolve(null) : reject(new Error('Could not clear book data.'));
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => reject(new Error('Book data is busy in another window.'));
  });
}
async function clearOwnedRows(bookId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    // A browser with unavailable storage cannot claim that personal data was erased.
    if (typeof window !== 'undefined') throw new Error('Book data storage is unavailable.');
    return;
  }
  for (const [name, store] of STORES) {
    const db = await openExisting(name);
    if (!db) continue;
    try {
      if (!db.objectStoreNames.contains(store)) throw new Error('Unrecognized book data storage.');
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const cursor = tx.objectStore(store).openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const value: unknown = row.value;
          if (value && typeof value === 'object' && 'bookId' in value && value.bookId === bookId)
            row.delete();
          row.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () =>
          reject(new Error('Could not clear book data. Retry deletion.'));
      });
    } finally {
      db.close();
    }
  }
}
export async function purgeBookBrowserData(
  bookId: string,
  revision = Date.now(),
  removeFiles: () => Promise<void> = async () => {},
): Promise<void> {
  await withPurgedBookData(bookId, revision, async () => {
    const { forgetPurgedConversations } = await import('@/glossa/conversation/store');
    forgetPurgedConversations(bookId);
    await removeFiles();
    await clearOwnedRows(bookId);
  });
}

export interface LegacyBrowserCache {
  database: string;
  store: string;
  key: IDBValidKey;
  snapshot: string;
}
const generatedStores = STORES.slice(3);
const unowned = (value: unknown) => !value || typeof value !== 'object' || !('bookId' in value);
/** Shared generated rows only; personal histories without an identity are never guessed. */
export async function inspectLegacyBrowserCaches(): Promise<LegacyBrowserCache[]> {
  if (typeof indexedDB === 'undefined') throw new Error('Book data storage is unavailable.');
  const rows: LegacyBrowserCache[] = [];
  for (const [name, store] of generatedStores) {
    const db = await openExisting(name);
    if (!db) continue;
    try {
      if (!db.objectStoreNames.contains(store)) throw new Error('Unrecognized book data storage.');
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store),
          request = tx.objectStore(store).openCursor();
        request.onsuccess = () => {
          const row = request.result;
          if (!row) return;
          if (unowned(row.value))
            rows.push({ database: name, store, key: row.key, snapshot: JSON.stringify(row.value) });
          row.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new Error('Could not read legacy shared data.'));
      });
    } finally {
      db.close();
    }
  }
  return rows;
}
export async function clearLegacyBrowserCaches(targets: LegacyBrowserCache[]): Promise<void> {
  for (const target of targets) {
    if (
      !generatedStores.some(([name, store]) => name === target.database && store === target.store)
    )
      throw new Error('Unrecognized book data storage.');
  }
  for (const [name, store] of generatedStores) {
    const selected = targets.filter((t) => t.database === name && t.store === store);
    if (!selected.length) continue;
    const db = await openExisting(name);
    if (!db) continue;
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite'),
          objectStore = tx.objectStore(store);
        let changed = false;
        for (const target of selected) {
          const request = objectStore.get(target.key);
          request.onsuccess = () => {
            if (request.result === undefined) return;
            if (!unowned(request.result) || JSON.stringify(request.result) !== target.snapshot) {
              changed = true;
              tx.abort();
              return;
            }
            objectStore.delete(target.key);
          };
        }
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(
            new Error(
              changed
                ? 'Shared data changed. Check it again before cleanup.'
                : 'Could not clear legacy shared data. Retry cleanup.',
            ),
          );
      });
    } finally {
      db.close();
    }
  }
}
