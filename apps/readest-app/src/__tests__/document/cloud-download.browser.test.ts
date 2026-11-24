import { expect, it, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { blake3 } from '@noble/hashes/blake3';
import type { Book } from '@/types/book';

const session = vi.hoisted(() => ({ subject: 'offline-test', bytes: 'original epub fixture' }));
vi.mock('@/utils/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/access')>()),
  getUserID: async () => session.subject,
}));
vi.mock('@/glossa/sync/cloudBook', () => ({
  openCloudBook: async () => {
    const bytes = new TextEncoder().encode(session.bytes);
    // Same native empty Blob backing as a CloudReaderFile. IDB must persist the streamed bytes.
    return new (class extends File {
      override stream() {
        return new Blob([bytes]).stream();
      }
      override get size() {
        return bytes.length;
      }
      async close() {}
    })([], 'fixture.epub');
  },
}));
import { WebAppService } from '@/services/webAppService';
import { getLocalBookFilename } from '@/utils/book';
import { loadLibraryRows } from '@/services/libraryRepository';
import { saveLibraryBooks } from '@/services/libraryService';
import { downloadGlossaBook } from '@/glossa/sync/downloadBook';

it('restores a verified cloud book into IndexedDB and preserves the copy on later failure', async () => {
  const app = new WebAppService();
  const original = session.bytes;
  const row: Book = {
    hash: crypto.randomUUID(),
    format: 'EPUB',
    title: 'Cloud test',
    author: 'Author',
    createdAt: 1,
    updatedAt: 1,
    glossaCloud: {
      origin: 'https://fixture.invalid',
      subject: session.subject,
      book_id: crypto.randomUUID(),
      manifest_id: crypto.randomUUID(),
      file_blake3: bytesToHex(blake3(new TextEncoder().encode(original))),
    },
  };
  await saveLibraryBooks(app.fs, [row]);
  session.bytes = 'wrong';
  await expect(downloadGlossaBook(app.fs, 'web', row)).rejects.toThrow('download_hash_mismatch');
  const path = getLocalBookFilename(row);
  expect(await app.fs.exists(path, 'Books')).toBe(false);
  expect((await loadLibraryRows(app.fs, { hashes: [row.hash] }))[0]?.downloadedAt).toBeUndefined();
  session.bytes = original;
  await downloadGlossaBook(app.fs, 'web', row);
  expect(await (await app.fs.openFile(path, 'Books')).text()).toBe(original);
  expect((await loadLibraryRows(app.fs, { hashes: [row.hash] }))[0]?.downloadedAt).toBeTypeOf(
    'number',
  );
  session.subject = 'other-account';
  await expect(downloadGlossaBook(app.fs, 'web', row)).rejects.toThrow('sync_context_changed');
  expect(await (await app.fs.openFile(path, 'Books')).text()).toBe(original);
});
