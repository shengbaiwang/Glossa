import { isPinned, releaseDays, recoveryScope, isDue, localReleaseDue } from './releasePolicy';
import { z } from 'zod';
import { blake3 } from '@noble/hashes/blake3';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { readerTransport } from '@glossa/sync-contracts/reader';
import { SqliteReplica } from '@glossa/sync-contracts/replica';
import { fingerprintPath, libraryIdentityIO } from '@/services/bookIdentity';
import { resolveBookContentSource } from '@/services/bookContent';
import { BookRemovalError } from '@/services/bookRemovalState';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { getUserID } from '@/utils/access';
import { openCloudBook, syncAccess, syncDeviceId } from './cloudBook';
import { syncOrigin } from './config';
import { withUnusedBook } from './bookUse';

const header = z.object({
  book_rev: z.int().positive(),
  manifest_id: z.uuid(),
  file_blake3: z.string().regex(/^[a-f0-9]{64}$/),
  manifest_digest: z.string().regex(/^[a-f0-9]{64}$/),
  file_bytes: z.int().positive(),
  status: z.enum(['unread', 'reading', 'finished']),
  finished_at: z.int().nullable(),
});
const unavailable = () =>
  new BookRemovalError('unavailable-copy', 'Current cloud recovery could not be verified.');
const changed = () =>
  new BookRemovalError('changed-file', 'The managed copy or its binding changed.');

async function verifyOriginal(
  file: File,
  expectedHash: string,
  size: number,
  signal?: AbortSignal,
) {
  const b3 = blake3.create(),
    sha = sha256.create();
  const stream = file.stream().getReader();
  let total = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await stream.read();
      if (done) break;
      total += value.length;
      if (total > size) throw unavailable();
      b3.update(value);
      sha.update(value);
    }
    if (total !== size || bytesToHex(b3.digest()) !== expectedHash) throw unavailable();
    return 'sha256:' + bytesToHex(sha.digest());
  } finally {
    await stream.cancel().catch(() => {});
    stream.releaseLock();
  }
}

export async function prepareCloudRelease(app: AppService, book: Book, signal?: AbortSignal) {
  const p = book.glossaCloud;
  if (
    !p ||
    !book.localRemoval ||
    !['PDF', 'EPUB'].includes(book.format) ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(book.hash)
  )
    throw unavailable();
  const scope = recoveryScope(p);
  const intent = book.localRemoval;
  const root = await app.resolveFilePath('', 'Books');
  const io = libraryIdentityIO(app);
  const context = async () => {
    signal?.throwIfAborted();
    if (
      syncOrigin() !== p.origin ||
      (await getUserID()) !== p.subject ||
      (await app.resolveFilePath('', 'Books')) !== root
    )
      throw unavailable();
  };
  const readHeader = async () => {
    await context();
    const control = readerTransport(p.origin, () => syncAccess(p.origin, p.subject));
    const timeout = AbortSignal.timeout(15000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const row = header.parse(
      await control.control(
        '/books/' +
          z.uuid().parse(p.book_id) +
          '/manifest?manifest_id=' +
          z.uuid().parse(p.manifest_id) +
          '&limit=1',
        undefined,
        requestSignal,
      ),
    );
    if (row.manifest_id !== p.manifest_id || row.file_blake3 !== p.file_blake3) throw changed();
    if (
      intent.releaseAfterDays &&
      (row.status !== 'finished' || !isDue(row.finished_at, intent.releaseAfterDays))
    )
      throw changed();
    return row;
  };
  const checkRow = (row: Book) => {
    if (
      isPinned(p) ||
      (intent.releaseAfterDays &&
        (releaseDays(p) !== intent.releaseAfterDays ||
          !localReleaseDue(row, intent.releaseAfterDays)))
    )
      throw changed();
    if (
      row.deletedAt ||
      row.duplicateOf ||
      row.glossaDiscovery?.available === false ||
      !row.glossaCloud ||
      recoveryScope(row.glossaCloud) !== scope ||
      row.localRemoval?.id !== intent.id ||
      intent.cloudScope !== scope ||
      (row.downloadedAt ?? null) !== intent.downloadedAt
    )
      throw changed();
  };
  checkRow(book);
  const meta = await readHeader();
  const source = await resolveBookContentSource(io, book);
  let sha: string | undefined;
  if (source.kind === 'managed') {
    // Exercise the current signed object path even when a previous release succeeded.
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      const file = await openCloudBook(book, controller);
      try {
        sha = await verifyOriginal(file, p.file_blake3, meta.file_bytes, signal);
      } finally {
        await file.close();
      }
    } catch {
      signal?.throwIfAborted();
      throw unavailable();
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  return async (latest: Book) =>
    withUnusedBook(book.hash, async () => {
      checkRow(latest);
      await context();
      const current = await resolveBookContentSource(io, latest);
      if (current.kind === 'managed') {
        if (
          source.kind !== 'managed' ||
          current.path !== source.path ||
          current.path.split('/').length !== 2 ||
          !current.path.startsWith(book.hash + '/') ||
          /[\\\0]/.test(current.path) ||
          !sha ||
          ((latest.storedContentFingerprint ?? latest.contentFingerprint) &&
            (latest.storedContentFingerprint ?? latest.contentFingerprint) !== sha) ||
          (await fingerprintPath(io, current.path, 'Books', signal)) !== sha
        )
          throw changed();
      } else if (source.kind === 'managed') throw changed();
      const db = await app.openDatabase('glossa-sync', 'glossa-sync.db', 'Data');
      try {
        const replica = await SqliteReplica.open(db, {
          issuer: p.origin,
          user: p.subject,
          device: await syncDeviceId(p.origin),
        });
        if (await replica.hasBookDrafts(p.book_id)) throw unavailable();
      } finally {
        await db.close();
      }
      const final = await readHeader();
      if (
        final.book_rev !== meta.book_rev ||
        final.manifest_digest !== meta.manifest_digest ||
        final.file_bytes !== meta.file_bytes
      )
        throw changed();
      await context();
      checkRow(latest);
      if (current.kind === 'managed') await app.deleteFile(current.path, 'Books');
    });
}
