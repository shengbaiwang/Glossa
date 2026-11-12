import { expect, it } from 'vitest';
import type { Book } from '@/types/book';
import {
  bookInReadingSpace,
  readingSpaces,
  readingSpaceFolders,
  readingSpaceView,
} from '@/utils/readingSpaces';
import { mergeLibraryBook } from '@/utils/libraryMerge';
const book = { hash: 'one', title: 'Personal', updatedAt: 1, progress: [5, 100] } as Book;
it('remembers only navigation and display settings, never an import action URL', () => {
  expect(
    readingSpaceView(
      'groupBy=group&sort=title&q=history&url=https%3A%2F%2Fexample.org%2Fbook.epub&action=import',
    ),
  ).toBe('groupBy=group&sort=title&q=history');
});
it('keeps legacy books in leisure without modifying or duplicating records', () => {
  expect(readingSpaces(book)).toEqual(['leisure']);
  expect(bookInReadingSpace(book, 'academic')).toBe(false);
  expect(bookInReadingSpace(book, 'all')).toBe(true);
  expect(book).not.toHaveProperty('readingSpaces');
});
it('allows the same identity in both spaces and tolerates invalid persisted values', () => {
  expect(bookInReadingSpace({ ...book, readingSpaces: ['leisure', 'academic'] }, 'academic')).toBe(
    true,
  );
  expect(readingSpaces({ ...book, readingSpaces: ['invalid'] } as unknown as Book)).toEqual([
    'leisure',
  ]);
  expect(readingSpaces({ readingSpaces: {} } as unknown as Book)).toEqual(['leisure']);
});
it('shows shared and empty groups while hiding branches belonging only to the other space', () => {
  const books = [
    { ...book, groupName: 'Research/Papers', readingSpaces: ['academic'] },
    { ...book, hash: 'two', groupName: 'Shared', readingSpaces: ['academic', 'leisure'] },
  ] as Book[];
  expect(
    readingSpaceFolders(books, ['Research', 'Research/Papers', 'Shared', 'Empty'], 'leisure'),
  ).toEqual(['Shared', 'Empty']);
});
it('a later progress save cannot revert space membership or a Zotero link', () => {
  const current = {
    ...book,
    readingSpaces: ['academic'],
    readingSpacesUpdatedAt: 4,
    zoteroSource: { itemKey: 'ABCD1234', attachmentKey: 'EFGH5678', title: 'Source' },
  } as Book;
  const merged = mergeLibraryBook(current, {
    ...book,
    updatedAt: 20,
    progress: [9, 100],
    readingSpaces: ['leisure'],
  });
  expect(merged.readingSpaces).toEqual(['academic']);
  expect(merged.zoteroSource).toEqual(current.zoteroSource);
  expect(merged.progress).toEqual([9, 100]);
  expect(merged.title).toBe('Personal');
});
