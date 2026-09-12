import { z } from 'zod';
import { validateProviderConfig } from '@/glossa/ai/provider';
import { stubTranslation as _ } from '@/utils/misc';
import {
  getGuideIdentity,
  READING_GUIDE_PROMPT_VERSION,
  READING_GUIDE_SCHEMA_VERSION,
} from './identity';
import { getPassageId } from './passages';
import {
  passageSourcesSchema,
  readingGuideBodySchema,
  validateReadingGuideSources,
} from './schema';
import { GuideError, throwIfAborted, type ReadingGuide } from './types';

const DATABASE_NAME = 'glossa-reading-guides';
const GUIDES = 'guides';
let databasePromise: Promise<IDBDatabase> | undefined;
const storageError = () =>
  new GuideError('storage', _('The guide could not be read or saved on this device.'));

const readingGuideSchema = readingGuideBodySchema
  .safeExtend({
    id: z.string().min(1).max(200),
    bookId: z.string().min(1).max(500),
    chapterId: z.string().min(1).max(500),
    passageId: z.string().min(1).max(600),
    createdAt: z.iso.datetime(),
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    promptVersion: z.literal(READING_GUIDE_PROMPT_VERSION),
    schemaVersion: z.literal(READING_GUIDE_SCHEMA_VERSION),
    provider: z
      .object({ id: z.string(), name: z.string(), baseUrl: z.string(), model: z.string() })
      .strict(),
    sources: passageSourcesSchema,
  })
  .strict();

async function validatedGuide(raw: unknown): Promise<ReadingGuide | null> {
  const parsed = readingGuideSchema.safeParse(raw);
  if (!parsed.success) return null;
  const guide = parsed.data;
  try {
    const provider = validateProviderConfig(guide.provider);
    if (
      !provider.model ||
      provider.baseUrl !== guide.provider.baseUrl ||
      !validateReadingGuideSources(guide, guide.sources) ||
      guide.passageId !== getPassageId(guide.chapterId, guide.sources)
    )
      return null;
    const identity = await getGuideIdentity(guide.bookId, guide.passageId, guide.sources, provider);
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

export async function loadReadingGuide(
  bookId: string,
  chapterId: string,
  passageId: string,
): Promise<ReadingGuide | null> {
  try {
    const db = await openDatabase();
    const raw: unknown = await new Promise((resolve, reject) => {
      const transaction = db.transaction(GUIDES, 'readonly');
      const request = transaction.objectStore(GUIDES).get([bookId, chapterId, passageId]);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(storageError());
    });
    const guide = await validatedGuide(raw);
    return guide?.bookId === bookId &&
      guide.chapterId === chapterId &&
      guide.passageId === passageId
      ? guide
      : null;
  } catch {
    throw storageError();
  }
}

export async function saveReadingGuide(guide: ReadingGuide, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const validated = await validatedGuide(guide);
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
