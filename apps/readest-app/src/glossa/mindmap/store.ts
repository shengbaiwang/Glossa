import { validateProviderConfig } from '@/glossa/ai/provider';
import { stubTranslation as _ } from '@/utils/misc';
import { getMindmapIdentity } from './identity';
import { getPassageId } from '@/glossa/passages/passages';
import { readingMindmapSchema, validateMindmapSources } from './schema';
import { PassageError, throwIfAborted } from '@/glossa/passages/types';
import type { ReadingMindmap } from './types';

const DATABASE_NAME = 'glossa-reading-mindmaps';
const GUIDES = 'mindmaps';
let databasePromise: Promise<IDBDatabase> | undefined;
const storageError = () =>
  new PassageError('storage', _('The mind map could not be read or saved on this device.'));

export async function validateSavedMindmap(raw: unknown): Promise<ReadingMindmap | null> {
  const parsed = readingMindmapSchema.safeParse(raw);
  if (!parsed.success) return null;
  const guide = parsed.data;
  try {
    const provider = validateProviderConfig(guide.provider);
    if (
      !provider.model ||
      provider.baseUrl !== guide.provider.baseUrl ||
      !validateMindmapSources(guide, guide.sources) ||
      guide.passageId !== getPassageId(guide.chapterId, guide.sources)
    )
      return null;
    const identity = await getMindmapIdentity(
      guide.bookId,
      guide.passageId,
      guide.sources,
      provider,
      guide.promptVersion,
    );
    if (identity.contentHash !== guide.contentHash || identity.cacheKey !== guide.cacheKey)
      return null;
    return { ...guide, provider };
  } catch {
    return null;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(storageError());
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(GUIDES, { keyPath: ['bookId', 'chapterId', 'passageId'] });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          databasePromise = undefined;
        };
        resolve(db);
      };
      request.onerror = request.onblocked = () => reject(storageError());
    }).catch(() => {
      databasePromise = undefined;
      throw storageError();
    });
  }
  return databasePromise;
}

export async function loadMindmap(
  bookId: string,
  chapterId: string,
  passageId: string,
): Promise<ReadingMindmap | null> {
  try {
    const db = await openDatabase();
    const raw: unknown = await new Promise((resolve, reject) => {
      const transaction = db.transaction(GUIDES, 'readonly');
      const request = transaction.objectStore(GUIDES).get([bookId, chapterId, passageId]);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(storageError());
    });
    if (raw === undefined) return null;
    const guide = await validateSavedMindmap(raw);
    if (!guide) throw storageError();
    return guide?.bookId === bookId &&
      guide.chapterId === chapterId &&
      guide.passageId === passageId
      ? guide
      : null;
  } catch {
    throw storageError();
  }
}

export async function saveMindmap(guide: ReadingMindmap, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const validated = await validateSavedMindmap(guide);
  throwIfAborted(signal);
  if (!validated) throw storageError();
  try {
    const db = await openDatabase();
    throwIfAborted(signal);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(GUIDES, 'readwrite');
      const abort = () => {
        try {
          transaction.abort();
        } catch {
          /* Already committed. */
        }
      };
      const clean = () => signal?.removeEventListener('abort', abort);
      transaction.oncomplete = () => {
        clean();
        resolve();
      };
      transaction.onerror = transaction.onabort = () => {
        clean();
        reject(
          signal?.aborted
            ? new DOMException('Generation cancelled.', 'AbortError')
            : storageError(),
        );
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      // IndexedDB commits the replacement atomically; abort leaves the prior result intact.
      transaction.objectStore(GUIDES).put(validated);
    });
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw storageError();
  }
}

/** Read-only archive access; one book only, with the original validation intact. */
export async function listSavedMindmaps(bookId: string): Promise<ReadingMindmap[]> {
  const db = await openDatabase();
  const raw: unknown[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(GUIDES, 'readonly');
    const rows: unknown[] = [];
    const request = tx.objectStore(GUIDES).openCursor(IDBKeyRange.bound([bookId], [bookId, []]));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      rows.push(cursor.value);
      cursor.continue();
    };
    tx.oncomplete = () => resolve(rows);
    tx.onerror = tx.onabort = () => reject(storageError());
  });
  const maps = await Promise.all(raw.map(validateSavedMindmap));
  if (maps.some((map) => !map || map.bookId !== bookId)) throw storageError();
  return (maps as ReadingMindmap[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
