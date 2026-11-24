import type { Book } from '@/types/book';
import type { AppPlatform, FileSystem } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
import { getUserID } from '@/utils/access';
import { getLocalBookFilename } from '@/utils/book';
import { notifyLibraryUpdated } from '@/utils/libraryEvents';
import { fingerprintPath } from '@/services/bookIdentity';
import { resolveBookContentSource } from '@/services/bookContent';
import { withLibraryLock } from '@/services/libraryLock';
import { loadLibraryRows } from '@/services/libraryRepository';
import { saveLibraryBooksUnlocked } from '@/services/libraryService';
import { blake3 } from '@noble/hashes/blake3';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { openCloudBook } from './cloudBook';

export async function downloadGlossaBook(fs: FileSystem, platform: AppPlatform, book: Book) {
  const p = book.glossaCloud;
  if (!p || book.deletedAt || !fs.moveFile) throw new Error('cloud_book_unavailable');
  const root = await fs.getPrefix('Books');
  const temporary = '.glossa-download-' + crypto.randomUUID() + '.part';
  const file = await openCloudBook(book);
  try {
    // IndexedDB persists the native Blob payload, so a lazy File subclass must be materialized first.
    const body =
      platform === 'web' ? new File([await new Response(file.stream()).blob()], file.name) : file;
    await fs.writeFile(temporary, 'Books', body);
    const stored = await fs.openFile(temporary, 'Books');
    const hash = blake3.create(),
      sha = sha256.create();
    try {
      if (stored.size !== file.size) throw new Error('download_length_mismatch');
      const stream = stored.stream().getReader();
      try {
        for (;;) {
          const { value, done } = await stream.read();
          if (done) break;
          hash.update(value);
          sha.update(value);
        }
      } finally {
        await stream.cancel();
        stream.releaseLock();
      }
    } finally {
      await (stored as Partial<ClosableFile>).close?.();
    }
    if (bytesToHex(hash.digest()) !== p.file_blake3) throw new Error('download_hash_mismatch');
    const fingerprint = 'sha256:' + bytesToHex(sha.digest());
    await withLibraryLock(fs, async () => {
      if ((await getUserID()) !== p.subject || (await fs.getPrefix('Books')) !== root)
        throw new Error('sync_context_changed');
      const rows = await loadLibraryRows(fs, { strict: true });
      const row = rows.find((r) => r.hash === book.hash),
        binding = row?.glossaCloud;
      if (
        !row ||
        row.deletedAt ||
        row.duplicateOf ||
        !binding ||
        binding.origin !== p.origin ||
        binding.subject !== p.subject ||
        binding.book_id !== p.book_id ||
        binding.manifest_id !== p.manifest_id ||
        binding.file_blake3 !== p.file_blake3
      )
        throw new Error('cloud_binding_conflict');
      const expected = row.storedContentFingerprint ?? row.contentFingerprint;
      if (expected && expected !== fingerprint) throw new Error('book_identity_mismatch');
      const source = await resolveBookContentSource(fs, row);
      if (source.kind === 'missing') {
        await fs.createDir(row.hash, 'Books', true);
        await fs.moveFile!(temporary, 'Books', getLocalBookFilename(row), 'Books');
      } else if (
        (source.kind !== 'external' && source.kind !== 'managed') ||
        (await fingerprintPath(fs, source.path, source.base)) !== fingerprint
      ) {
        throw new Error('local_file_changed');
      }
      await saveLibraryBooksUnlocked(
        fs,
        [
          {
            ...row,
            storedContentFingerprint: fingerprint,
            downloadedAt: Math.max(
              Date.now(),
              (row.localRemoval?.requestedAt ?? 0) + 1,
              (row.downloadedAt ?? 0) + 1,
            ),
          },
        ],
        undefined,
        rows,
      );
    });
    notifyLibraryUpdated([book.hash]);
  } finally {
    await file.close();
    if (await fs.exists(temporary, 'Books')) await fs.removeFile(temporary, 'Books');
  }
}
