import { z } from 'zod';
import type { BookNote } from '@/types/book';

const editSchema = z.object({ id: z.string().uuid(), editedAt: z.number().finite().positive() });
export type BookDataEdit = z.infer<typeof editSchema>;
// Only explicit note actions mark their exact array; spreading a config keeps this identity.
export const bookNoteEdits = new WeakMap<BookNote[], BookDataEdit>();
const conflictSchema = editSchema
  .extend({
    version: z.literal(1),
    bookId: z.string().min(1).max(500),
    kind: z.enum(['notes', 'conversations', 'question', 'mindmaps']),
    dataRevision: z.number().int().nonnegative(),
    cutoff: z.number().finite().positive(),
    data: z.unknown(),
  })
  .strict();
export type BookDataConflict = z.infer<typeof conflictSchema>;
export const bookDataEditTime = () =>
  typeof performance === 'undefined' ? Date.now() : performance.timeOrigin + performance.now();
export const newBookDataEdit = (): BookDataEdit => ({
  id: crypto.randomUUID(),
  editedAt: bookDataEditTime(),
});
export class BookDataConflictSaved extends Error {
  constructor() {
    super('New edits are preserved in Recently Deleted. Review the conflicting draft.');
  }
}

async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('glossa-book-data-conflicts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () =>
      reject(new Error('Could not save conflicting edits.'));
  });
}
function notify() {
  window.dispatchEvent(new Event('glossa-book-data-conflicts'));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('glossa-book-data-conflicts');
    channel.postMessage('changed');
    channel.close();
  }
}
/** Immutable, independent drafts: a stale pane can never overwrite the restored book. */
export async function saveBookDataConflict(input: BookDataConflict): Promise<void> {
  const draft = conflictSchema.parse(input);
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'),
        store = tx.objectStore('drafts');
      const request = store.get(draft.id);
      request.onsuccess = () => {
        if (request.result === undefined) store.add(draft);
        else {
          const previous = conflictSchema.safeParse(request.result);
          // A later restore advances the barrier but cannot change this draft's identity.
          if (
            !previous.success ||
            JSON.stringify({ ...previous.data, cutoff: draft.cutoff }) !== JSON.stringify(draft)
          )
            tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('Could not save conflicting edits.'));
    });
  } finally {
    db.close();
  }
  notify();
}
export async function loadBookDataConflicts(): Promise<BookDataConflict[]> {
  // Node/isolated UI tests have no browser storage; a real browser must report storage failures.
  if (typeof indexedDB === 'undefined') return [];
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readonly'),
        request = tx.objectStore('drafts').getAll();
      tx.oncomplete = () => {
        try {
          resolve(
            z
              .array(conflictSchema)
              .parse(request.result)
              .sort((a, b) => a.editedAt - b.editedAt || a.id.localeCompare(b.id)),
          );
        } catch (error) {
          reject(error);
        }
      };
      tx.onerror = tx.onabort = () => reject(new Error('Could not read conflicting edits.'));
    });
  } finally {
    db.close();
  }
}
/** The user discards one reviewed immutable draft, never the whole book or another pane's edit. */
export async function discardBookDataConflict(id: string): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('Could not discard conflicting edits.'));
    });
  } finally {
    db.close();
  }
  notify();
}
