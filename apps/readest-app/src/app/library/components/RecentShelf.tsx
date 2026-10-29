import { Book, ReadingStatus } from '@/types/book';
import { LibraryCoverFitType } from '@/types/settings';
import { useTranslation } from '@/hooks/useTranslation';
import BookshelfItem from './BookshelfItem';
import type { LibrarySelectionOptions } from '../utils/librarySelection';

/**
 * How many recently-read books the top shelf holds. Fixed (no user option) so
 * the row stays a compact quick-resume strip rather than a second library.
 */
export const RECENT_SHELF_BOOK_COUNT = 12;

interface RecentShelfProps {
  books: Book[];
  coverFit: LibraryCoverFitType;
  selectedBooks: ReadonlySet<string>;
  onOpenBook: (book: Book) => void;
  selectItem: (id: string, options?: LibrarySelectionOptions) => void;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  showBookDetailsModal: (book: Book) => void;
  showTimeRemaining: boolean;
  handleRenameBook?: (book: Book, title: string) => Promise<boolean>;
  handleUpdateReadingStatus?: (book: Book, status: ReadingStatus | undefined) => void;
  handleGroupBooks?: () => void;
}

/** A compact quick-resume row, separate from the collection's cover grid. */
const RecentShelf: React.FC<RecentShelfProps> = ({
  books,
  coverFit,
  selectedBooks,
  onOpenBook,
  selectItem,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
  showTimeRemaining,
  handleRenameBook,
  handleUpdateReadingStatus,
  handleGroupBooks,
}) => {
  const _ = useTranslation();

  return (
    <section
      className='recent-shelf glossa-recent-shelf select-none'
      aria-label={_('Continue reading')}
    >
      <div className='glossa-recent-heading'>
        <h2>{_('Continue reading')}</h2>
      </div>
      <div
        data-spatial-navigation='recent'
        className='glossa-recent-scroller no-scrollbar overflow-x-auto overflow-y-hidden overscroll-x-contain'
      >
        <div className='flex gap-4'>
          {books.map((book) => (
            <div key={book.hash} className='glossa-recent-slide min-w-0 shrink-0'>
              <BookshelfItem
                mode='list'
                item={book}
                coverFit={coverFit}
                itemSelected={selectedBooks.has(book.hash)}
                selectItem={(id, options) =>
                  selectItem(id, { ...options, order: books.map((book) => book.hash) })
                }
                handleBookUpload={async (b) => {
                  await handleBookUpload(b);
                  return true;
                }}
                handleBookDownload={async (b, o) => {
                  await handleBookDownload(b, o);
                  return true;
                }}
                handleShowDetailsBook={showBookDetailsModal}
                showTimeRemaining={showTimeRemaining}
                handleRenameBook={handleRenameBook}
                handleUpdateReadingStatus={handleUpdateReadingStatus ?? (() => {})}
                handleGroupBooks={handleGroupBooks ?? (() => {})}
                handleBookDelete={async () => false}
                handleLibraryNavigation={() => {}}
                setLoading={() => {}}
                transferProgress={null}
                onOpenBook={onOpenBook}
                resume
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default RecentShelf;
