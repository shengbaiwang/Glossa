import type { AppService } from '@/types/system';
import { bookRemovalIO, removeAppBooks } from './appBookRemoval';
import { loadRemovalBooks } from './bookRemovalService';

/** Whole-library deletion has the same recoverable meaning as selecting all books. */
export const deleteAllBooks = async (app: AppService, cloudTargets: string[] = []) => {
  const books = (await loadRemovalBooks(bookRemovalIO(app))).filter(
    (book) => !book.deletedAt && !book.duplicateOf,
  );
  return books.length ? removeAppBooks(app, books, 'trash', { cloudTargets }) : null;
};
