import { getUserID } from '@/utils/access';
import { syncOrigin } from './config';
import { CloudReaderFile } from './readerFile';
import { searchCodec } from './searchSidecar';
import { cachedCloudSectionCount, persistCloudSearchSections } from '@/services/librarySearchIndex';
import type { AppService } from '@/types/system';
import type { DatabaseService } from '@/types/database';
import type { Book } from '@/types/book';
import type { ClosableFile } from '@/utils/file';

export async function cloudSearchIndex(
  app: Pick<AppService, 'loadBookContent'>,
  book: Book,
  db: DatabaseService | null,
  signal?: AbortSignal,
) {
  const p = book.glossaCloud;
  if (!p || book.deletedAt || book.duplicateOf || (book.format !== 'EPUB' && book.format !== 'PDF'))
    return;
  const checkOwner = async () => {
    signal?.throwIfAborted();
    if (p.origin !== syncOrigin() || p.subject !== (await getUserID()))
      throw new Error('sync_account_changed');
  };
  await checkOwner();
  const language = book.primaryLanguage ?? '';
  const scope = JSON.stringify([
    p.origin,
    p.subject,
    p.book_id,
    p.manifest_id,
    p.file_blake3,
    book.format,
    language,
    searchCodec,
  ]);
  const cached = db && (await cachedCloudSectionCount(db, scope));
  if (cached) return { scope, count: cached, checkOwner };
  const { file } = await app.loadBookContent(book);
  const close = () => (file as Partial<ClosableFile>).close?.();
  const abortRead = () => {
    void close();
  };
  signal?.addEventListener('abort', abortRead, { once: true });
  try {
    signal?.throwIfAborted();
    if (!(file instanceof CloudReaderFile)) return;
    const rows = await file.searchSections(book.format === 'PDF' ? 'pdf' : 'epub', language);
    if (!rows) return;
    await checkOwner();
    if (db) {
      await persistCloudSearchSections(db, scope, rows, signal);
      return { scope, count: rows.length, checkOwner };
    }
    return { scope, count: rows.length, rows, checkOwner };
  } finally {
    signal?.removeEventListener('abort', abortRead);
    await close();
  }
}
