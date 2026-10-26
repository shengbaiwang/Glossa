import { expect, it } from 'vitest';
import { removeFolders } from '@/app/library/utils/libraryFolders';
import type { Book } from '@/types/book';
it('dissolves selected containers once and keeps every nested book and personal field', () => {
  const books: Book[] = [
    {
      hash: 'one',
      title: 'Mine',
      author: 'A',
      format: 'EPUB',
      createdAt: 1,
      updatedAt: 1,
      groupName: 'A/B/C',
      progress: [3, 9],
    },
  ];
  const result = removeFolders(books, ['A', 'A/B', 'A/B/C'], ['A', 'A/B']);
  expect(result.paths).toEqual(['C']);
  expect(result.books).toHaveLength(1);
  expect(result.books[0]).toMatchObject({ title: 'Mine', groupName: 'C', progress: [3, 9] });
  expect(result.books[0]?.deletedAt).toBeUndefined();
});
