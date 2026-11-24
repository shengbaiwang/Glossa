import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { contentIdentity } from '@/services/bookIdentity';
import { withLibraryLock } from '@/services/libraryLock';
import { loadLibraryRows } from '@/services/libraryRepository';
import { saveLibraryBooksUnlocked } from '@/services/libraryService';
import { notifyLibraryUpdated } from '@/utils/libraryEvents';

export async function recordPublication(
  fs: FileSystem,
  hash: string,
  pointer: NonNullable<Book['glossaCloud']>,
  sha: string,
  stillCurrent: () => Promise<boolean>,
) {
  await withLibraryLock(fs, async () => {
    if (!(await stillCurrent())) throw new Error('sync_context_changed');
    const rows = await loadLibraryRows(fs, { strict: true });
    const row = rows.find((r) => r.hash === hash);
    if (!row || row.deletedAt || row.duplicateOf) throw new Error('book_unavailable');
    const prior = row.glossaCloud;
    if (
      prior &&
      (prior.origin !== pointer.origin ||
        prior.subject !== pointer.subject ||
        prior.book_id !== pointer.book_id ||
        prior.file_blake3 !== pointer.file_blake3)
    )
      throw new Error('cloud_binding_conflict');
    const expected = row.storedContentFingerprint ?? contentIdentity(row);
    if (expected && expected !== sha) throw new Error('book_identity_mismatch');
    await saveLibraryBooksUnlocked(
      fs,
      [{ ...row, glossaCloud: pointer, uploadedAt: Date.now(), storedContentFingerprint: sha }],
      undefined,
      rows,
    );
  });
  notifyLibraryUpdated([hash]);
}
