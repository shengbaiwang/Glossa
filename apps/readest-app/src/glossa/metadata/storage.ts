import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import { withBookDataWrite } from '@/services/bookDataLifecycle';
import { metadataRecognitionSchema, type MetadataRecognition } from './types';

export const METADATA_ALGORITHM = 'local-metadata-1';
const cachePath = (book: Book) => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(book.hash)) throw new Error('metadata_invalid_book');
  return `${book.hash}/metadata-recognition.json`;
};
export const metadataFingerprint = (book: Book) =>
  book.storedContentFingerprint || book.contentFingerprint;

/** A candidate cache is never a replacement for the currently adopted metadata. */
export async function loadMetadataRecognition(
  book: Book,
  envConfig: EnvConfigType,
): Promise<MetadataRecognition | null> {
  if (book.deletedAt) return null;
  try {
    const app = await envConfig.getAppService();
    const raw = await app.readFile(cachePath(book), 'Books', 'text');
    if (typeof raw !== 'string' || raw.length > 320000) return null;
    const envelope: unknown = JSON.parse(raw);
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      !('algorithm' in envelope) ||
      envelope.algorithm !== METADATA_ALGORITHM ||
      !('result' in envelope)
    )
      return null;
    const parsed = metadataRecognitionSchema.safeParse(envelope.result);
    return parsed.success &&
      (!metadataFingerprint(book) || parsed.data.fingerprint === metadataFingerprint(book))
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export async function saveMetadataRecognition(
  book: Book,
  envConfig: EnvConfigType,
  result: MetadataRecognition,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (book.deletedAt) throw new Error('metadata_book_deleted');
  const parsed = metadataRecognitionSchema.parse(result);
  if (metadataFingerprint(book) && parsed.fingerprint !== metadataFingerprint(book))
    throw new Error('metadata_source_changed');
  const raw = JSON.stringify({ algorithm: METADATA_ALGORITHM, result: parsed });
  if (raw.length > 320000) throw new Error('metadata_cache_limit');
  const app = await envConfig.getAppService();
  signal?.throwIfAborted();
  await withBookDataWrite(book.hash, book.removal?.revision ?? 0, async () => {
    signal?.throwIfAborted();
    await app.createDir(book.hash, 'Books', true);
    signal?.throwIfAborted();
    const path = cachePath(book);
    const previous = signal
      ? await app.readFile(path, 'Books', 'text').catch(() => undefined)
      : undefined;
    signal?.throwIfAborted();
    await app.writeFile(path, 'Books', raw);
    if (signal?.aborted) {
      // Native file writes cannot be interrupted. Restore under the same book-data
      // lock before releasing a cancelled writer to any later task or deletion.
      if (typeof previous === 'string' && previous.length <= 320000)
        await app.writeFile(path, 'Books', previous);
      else await app.deleteFile(path, 'Books');
      signal.throwIfAborted();
    }
  });
  signal?.throwIfAborted();
}
