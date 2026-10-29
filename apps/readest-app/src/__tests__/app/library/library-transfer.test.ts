import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { md5Fingerprint } from '@/utils/md5';
import {
  captureLibraryTransfer,
  isLibraryTransferCurrent,
} from '@/app/library/utils/libraryTransfer';

const books = [
  { hash: 'one', groupName: 'A', title: 'Original' },
  { hash: 'two', groupName: 'A/Child' },
  { hash: 'three', groupName: 'Other' },
] as Book[];
const paths = ['A', 'A/Child', 'Other'];

describe('library transfer snapshots', () => {
  it('keeps mixed selection identities without expanding groups into duplicate records', () => {
    const snapshot = captureLibraryTransfer(books, paths, [md5Fingerprint('A'), 'three']);
    expect(snapshot?.selection).toEqual([md5Fingerprint('A'), 'three']);
    expect(isLibraryTransferCurrent(snapshot, books, paths)).toBe(true);
    expect(
      isLibraryTransferCurrent(
        snapshot,
        books.map((book) => ({ ...book, title: 'Later', progress: [5, 9] })),
        paths,
      ),
    ).toBe(true);
  });

  it('rejects stale membership, deleted books and replaced branches before moving anything', () => {
    const snapshot = captureLibraryTransfer(books, paths, [md5Fingerprint('A'), 'three']);
    expect(
      isLibraryTransferCurrent(
        snapshot,
        [...books, { hash: 'new', groupName: 'A' } as Book],
        paths,
      ),
    ).toBe(false);
    expect(
      isLibraryTransferCurrent(
        snapshot,
        books.map((book) => (book.hash === 'three' ? { ...book, deletedAt: 10 } : book)),
        paths,
      ),
    ).toBe(false);
    expect(isLibraryTransferCurrent(snapshot, books, [...paths, 'A/New'])).toBe(false);
    expect(captureLibraryTransfer(books, paths, ['missing', 'one'])).toBeUndefined();
  });
});
