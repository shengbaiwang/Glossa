import { describe, expect, it } from 'vitest';
import { getBookContextMenuItemIds } from '@/app/library/utils/libraryUtils';
import { buildFeedBookUrl } from '@/services/rss/feedBookUrl';
import type { Book } from '@/types/book';
const book: Book = {
  hash: 'book',
  title: 'Book',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};
describe('quiet book context menu', () => {
  it.each([
    undefined,
    'finished',
    'unread',
    'abandoned',
  ] as const)('keeps status %s on the book card', (readingStatus) => {
    expect(getBookContextMenuItemIds({ ...book, downloadedAt: 1, readingStatus })).toEqual([
      'group',
      'showInFinder',
      'delete',
    ]);
  });
  it('omits file location for a cloud-only book', () => {
    expect(getBookContextMenuItemIds({ ...book, uploadedAt: 1 })).toEqual(['group', 'delete']);
  });
  it('allows revealing an in-place imported file', () => {
    expect(getBookContextMenuItemIds({ ...book, filePath: '/books/book.epub' })).toEqual([
      'group',
      'showInFinder',
      'delete',
    ]);
  });
  it('omits file actions for a fileless feed', () => {
    expect(
      getBookContextMenuItemIds({
        ...book,
        downloadedAt: 1,
        url: buildFeedBookUrl('https://example.com/feed'),
      }),
    ).toEqual(['group', 'delete']);
  });
});
