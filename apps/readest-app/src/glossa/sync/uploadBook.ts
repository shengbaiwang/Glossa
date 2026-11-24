import { HeadPreviewBuilder } from './headPreview';
import { SearchPackBuilder } from './searchSidecar';
import { prepareFile, publishFile, uploadTransport } from '@glossa/sync-contracts/publisher';
import { httpTransport, SqliteReplica } from '@glossa/sync-contracts/replica';
import type { Book } from '@/types/book';
import type { AppService, FileSystem } from '@/types/system';
import { getUserID } from '@/utils/access';
import type { ClosableFile } from '@/utils/file';
import { recordPublication } from './recordPublication';
import { contentIdentity } from '@/services/bookIdentity';
import { resolveBookContentSource } from '@/services/bookContent';
import { withLibraryLock } from '@/services/libraryLock';
import { syncAccess, syncDeviceId } from './cloudBook';
import { syncOrigin } from './config';

export async function uploadGlossaBook(
  app: Pick<AppService, 'openDatabase'>,
  fs: FileSystem,
  book: Book,
) {
  const origin = syncOrigin(),
    subject = await getUserID();
  if (!origin || !subject) throw new Error('sync_login_required');
  if (book.deletedAt || book.duplicateOf) throw new Error('book_unavailable');
  if (
    book.glossaCloud &&
    (book.glossaCloud.origin !== origin || book.glossaCloud.subject !== subject)
  )
    throw new Error('sync_account_changed');
  const libraryRoot = await fs.getPrefix('Books');
  if (book.format !== 'PDF' && book.format !== 'EPUB') throw new Error('unsupported_cloud_format');
  const source = await resolveBookContentSource(fs, book);
  const expected = book.storedContentFingerprint ?? contentIdentity(book);
  if (source.kind !== 'managed' && (source.kind !== 'external' || !expected))
    throw new Error('local_identity_unavailable');
  const file = await fs.openFile(source.path, source.base);
  try {
    const prepared = await prepareFile(file);
    if (
      (expected && prepared.sha256 !== expected) ||
      (book.glossaCloud && book.glossaCloud.file_blake3 !== prepared.file_blake3)
    )
      throw new Error('book_identity_mismatch');
    const token = () => syncAccess(origin, subject);
    const transport = httpTransport(origin, token);
    const candidate = book.glossaCloud?.book_id ?? crypto.randomUUID();
    const readRegistration = (register: boolean) =>
      withLibraryLock(
        fs,
        async () => {
          const db = await app.openDatabase('glossa-sync', 'glossa-sync.db', 'Data');
          try {
            const replica = await SqliteReplica.open(db, {
              issuer: origin,
              user: subject,
              device: await syncDeviceId(origin),
            });
            if (register && !book.glossaCloud) {
              await replica.edit(
                {
                  op_id: crypto.randomUUID(),
                  entity_id: candidate,
                  kind: 'book.create',
                  data: {
                    title: book.title,
                    authors: book.author ? [book.author] : [],
                    format: book.format.toLowerCase(),
                    language: book.primaryLanguage ?? null,
                    file_hash: prepared.file_blake3,
                  },
                },
                { title: book.title },
              );
            }
            await replica.synchronize(transport);
            const { confirmed } = await replica.inspect('book', candidate);
            if (
              !confirmed ||
              confirmed.deleted_at != null ||
              confirmed.file_hash !== prepared.file_blake3
            )
              throw new Error('cloud_book_unavailable');
            return {
              book_id: String(confirmed.id),
              manifest_id: confirmed.manifest_id as string | undefined,
              file_blake3: prepared.file_blake3,
            };
          } finally {
            await db.close();
          }
        },
        'sync-replica',
      );
    const current = await readRegistration(true);
    let manifest = current.manifest_id;
    if (!manifest) {
      try {
        const search = new SearchPackBuilder({
          source_file_blake3: prepared.file_blake3,
          file_bytes: prepared.file_bytes,
          format: book.format === 'PDF' ? 'pdf' : 'epub',
          language: book.primaryLanguage ?? '',
        });
        const preview = new HeadPreviewBuilder(prepared, book.format === 'PDF' ? 'pdf' : 'epub');
        const layout =
          book.format === 'EPUB'
            ? await (await import('./buildEpubLayout')).buildEpubLayout(
                file,
                prepared,
                search,
                preview,
              )
            : await (await import('./buildPdfLayout')).buildPdfLayout(
                file,
                prepared,
                search,
                preview,
              );
        const searchPack = await search.finish();
        manifest = (
          await publishFile(
            uploadTransport(origin, token),
            current.book_id,
            file,
            prepared,
            [layout, searchPack, preview.finish()].filter((a) => a !== undefined),
          )
        ).manifest_id;
      } catch (error) {
        // Another importer may have committed, or the commit response may have been lost.
        manifest = (await readRegistration(false)).manifest_id;
        if (!manifest) throw error;
      }
    }
    const pointer = { ...current, manifest_id: manifest, origin, subject };
    await recordPublication(
      fs,
      book.hash,
      pointer,
      prepared.sha256,
      async () => (await getUserID()) === subject && (await fs.getPrefix('Books')) === libraryRoot,
    );
  } finally {
    await (file as Partial<ClosableFile>).close?.();
  }
}
