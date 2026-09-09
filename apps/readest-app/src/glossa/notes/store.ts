import { z } from 'zod';
import { stubTranslation as _ } from '@/utils/misc';
import { studyNoteBodySchema, validateStudyNoteSources } from './schema';
import { NotesError, throwIfAborted, type ChapterNotes, type StudyNoteVersion } from './types';

const DATABASE_NAME = 'glossa-study-notes';
const VERSIONS = 'versions';
const PERSONAL = 'personal';
let databasePromise: Promise<IDBDatabase> | undefined;

const versionSchema = studyNoteBodySchema
  .safeExtend({
    id: z.string().min(1),
    bookId: z.string().min(1),
    bookTitle: z.string(),
    chapterId: z.string().min(1),
    chapterTitle: z.string(),
    createdAt: z.iso.datetime(),
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    provider: z
      .object({ id: z.string(), name: z.string(), baseUrl: z.string(), model: z.string() })
      .strict(),
    promptVersion: z.string().min(1),
    schemaVersion: z.literal(1),
    sources: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          text: z.string(),
          kind: z.enum(['heading', 'paragraph', 'list', 'table', 'quote']),
          anchor: z
            .object({
              sectionIndex: z.number().int().nonnegative(),
              cfi: z.string().min(1),
              quote: z
                .object({ exact: z.string(), prefix: z.string(), suffix: z.string() })
                .strict(),
            })
            .strict(),
        })
        .strict(),
    ),
  })
  .strict();

const chapterKey = (bookId: string, chapterId: string) => JSON.stringify([bookId, chapterId]);
const storageError = () =>
  new NotesError('storage', _('Study notes could not be read or saved on this device.'));

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(storageError());
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const versions = db.createObjectStore(VERSIONS, { keyPath: 'id' });
        versions.createIndex('chapterKey', 'chapterKey', { unique: false });
        db.createObjectStore(PERSONAL, { keyPath: 'chapterKey' });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          databasePromise = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(storageError());
      request.onblocked = () => reject(storageError());
    }).catch((error: unknown) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

function commit(transaction: IDBTransaction, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      try {
        transaction.abort();
      } catch {
        /* The transaction has already completed. */
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    const clean = () => signal?.removeEventListener('abort', abort);
    transaction.oncomplete = () => {
      clean();
      resolve();
    };
    transaction.onabort = () => {
      clean();
      reject(
        signal?.aborted ? new DOMException('Generation cancelled.', 'AbortError') : storageError(),
      );
    };
    transaction.onerror = () => {
      clean();
      reject(
        signal?.aborted ? new DOMException('Generation cancelled.', 'AbortError') : storageError(),
      );
    };
    if (signal?.aborted) abort();
  });
}

export async function loadChapterNotes(bookId: string, chapterId: string): Promise<ChapterNotes> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([VERSIONS, PERSONAL], 'readonly');
    const key = chapterKey(bookId, chapterId);
    const versionsRequest = transaction.objectStore(VERSIONS).index('chapterKey').getAll(key);
    const personalRequest = transaction.objectStore(PERSONAL).get(key);
    transaction.oncomplete = () => {
      const versions: StudyNoteVersion[] = [];
      for (const raw of versionsRequest.result as unknown[]) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const { chapterKey: _key, ...candidate } = raw as Record<string, unknown>;
        const result = versionSchema.safeParse(candidate);
        if (
          result.success &&
          result.data.bookId === bookId &&
          result.data.chapterId === chapterId &&
          validateStudyNoteSources(result.data, result.data.sources)
        ) {
          versions.push(result.data);
        }
      }
      versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const personal: unknown = personalRequest.result;
      const personalNote =
        personal &&
        typeof personal === 'object' &&
        'text' in personal &&
        typeof personal.text === 'string'
          ? personal.text
          : '';
      resolve({ versions, personalNote });
    };
    transaction.onerror = () => reject(storageError());
    transaction.onabort = () => reject(storageError());
  });
}

export async function saveStudyNote(
  version: StudyNoteVersion,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const parsed = versionSchema.safeParse(version);
  if (!parsed.success || !validateStudyNoteSources(version, version.sources)) throw storageError();
  const db = await openDatabase();
  throwIfAborted(signal);
  const transaction = db.transaction(VERSIONS, 'readwrite');
  // Add, rather than put, prevents an accidental version-ID collision from
  // overwriting an existing generated note.
  transaction
    .objectStore(VERSIONS)
    .add({ ...parsed.data, chapterKey: chapterKey(version.bookId, version.chapterId) });
  await commit(transaction, signal);
}

export function savePersonalNote(bookId: string, chapterId: string, text: string): Promise<void> {
  // All callers await the same opening promise; callbacks create transactions
  // in call order, so a slower earlier keystroke cannot replace a newer one.
  return openDatabase().then((db) => {
    const transaction = db.transaction(PERSONAL, 'readwrite');
    transaction.objectStore(PERSONAL).put({ chapterKey: chapterKey(bookId, chapterId), text });
    return commit(transaction);
  });
}

export async function deleteStudyNote(versionId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(VERSIONS, 'readwrite');
  transaction.objectStore(VERSIONS).delete(versionId);
  await commit(transaction);
}
