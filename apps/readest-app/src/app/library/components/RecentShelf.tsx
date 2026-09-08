import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Book } from '@/types/book';
import { LibraryCoverFitType } from '@/types/settings';
import { useTranslation } from '@/hooks/useTranslation';
import { useLongPress } from '@/hooks/useLongPress';
import BookItem from './BookItem';

/**
 * How many recently-read books the top shelf holds. Fixed (no user option) so
 * the row stays a compact quick-resume strip rather than a second library.
 */
export const RECENT_SHELF_BOOK_COUNT = 12;

interface RecentShelfProps {
  books: Book[];
  coverFit: LibraryCoverFitType;
  isSelectMode: boolean;
  selectedBooks: ReadonlySet<string>;
  onOpenBook: (book: Book) => void;
  toggleSelection: (hash: string) => void;
  handleSetSelectMode: (selectMode: boolean) => void;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  showBookDetailsModal: (book: Book) => void;
  showTimeRemaining: boolean;
}

type RecentSlideProps = Pick<
  RecentShelfProps,
  | 'coverFit'
  | 'isSelectMode'
  | 'onOpenBook'
  | 'toggleSelection'
  | 'handleSetSelectMode'
  | 'handleBookUpload'
  | 'handleBookDownload'
  | 'showBookDetailsModal'
  | 'showTimeRemaining'
> & { book: Book; bookSelected: boolean };

const RecentSlide: React.FC<RecentSlideProps> = ({
  book,
  coverFit,
  isSelectMode,
  bookSelected,
  onOpenBook,
  toggleSelection,
  handleSetSelectMode,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
  showTimeRemaining,
}) => {
  // Same select vocabulary as the grid (`BookshelfItem`): long-press enters
  // select mode and selects; while in select mode a tap toggles instead of
  // opening the book.
  const handleSelect = () => {
    if (!isSelectMode) handleSetSelectMode(true);
    toggleSelection(book.hash);
  };

  const handleActivate = () => {
    if (isSelectMode) {
      handleSelect();
    } else {
      onOpenBook(book);
    }
  };

  // Pointer-based tap, exactly like the grid (`BookItem` stops click
  // propagation). A swipe-to-scroll moves past useLongPress's moveThreshold and
  // cancels the tap, so horizontal scrolling never opens a book.
  const { pressing, handlers } = useLongPress(
    { onTap: handleActivate, onLongPress: handleSelect },
    [book, isSelectMode, onOpenBook, toggleSelection, handleSetSelectMode],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivate();
    }
  };

  return (
    <div className='glossa-recent-slide min-w-0 shrink-0'>
      <div
        className={clsx(
          'glossa-book-card glossa-resume-card eink-bordered group flex h-full cursor-pointer select-none flex-col',
          pressing && 'glossa-book-card-pressing',
          bookSelected && 'glossa-book-card-selected',
        )}
        role='button'
        tabIndex={0}
        aria-label={book.title}
        aria-pressed={isSelectMode ? bookSelected : undefined}
        onKeyDown={handleKeyDown}
        {...handlers}
      >
        <div className='flex h-full flex-col justify-end'>
          <BookItem
            mode='list'
            book={book}
            coverFit={coverFit}
            isSelectMode={isSelectMode}
            bookSelected={bookSelected}
            transferProgress={null}
            handleBookUpload={handleBookUpload}
            handleBookDownload={handleBookDownload}
            showBookDetailsModal={showBookDetailsModal}
            showTimeRemaining={showTimeRemaining}
          />
        </div>
      </div>
    </div>
  );
};

/** A compact quick-resume row, separate from the collection's cover grid. */
const RecentShelf: React.FC<RecentShelfProps> = ({
  books,
  coverFit,
  isSelectMode,
  selectedBooks,
  onOpenBook,
  toggleSelection,
  handleSetSelectMode,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
  showTimeRemaining,
}) => {
  const _ = useTranslation();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const offset = Math.abs(el.scrollLeft);
    setShowLeft(offset > 1);
    setShowRight(offset + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateArrows);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateArrows, books]);

  const scrollByPage = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const reduceMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset['eink'] === 'true';
    el.scrollBy({
      left: direction * (rtl ? -1 : 1) * el.clientWidth * 0.8,
      behavior: reduceMotion ? 'instant' : 'smooth',
    });
  };

  return (
    <section
      className='recent-shelf glossa-recent-shelf select-none'
      aria-label={_('Continue reading')}
    >
      <div className='glossa-recent-heading'>
        <div>
          <h2>{_('Continue reading')}</h2>
          <p>{_('Continue reading where you left off.')}</p>
        </div>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            aria-label={_('Scroll left')}
            disabled={!showLeft}
            onClick={() => scrollByPage(-1)}
            className='touch-target glossa-icon-button'
          >
            <ArrowLeft size={18} className='rtl:rotate-180' aria-hidden='true' />
          </button>
          <button
            type='button'
            aria-label={_('Scroll right')}
            disabled={!showRight}
            onClick={() => scrollByPage(1)}
            className='touch-target glossa-icon-button'
          >
            <ArrowRight size={18} className='rtl:rotate-180' aria-hidden='true' />
          </button>
        </div>
      </div>
      <div
        ref={scrollerRef}
        onScroll={updateArrows}
        data-spatial-navigation='recent'
        className='glossa-recent-scroller no-scrollbar overflow-x-auto overflow-y-hidden overscroll-x-contain'
      >
        <div className='flex gap-4'>
          {books.map((book) => (
            <RecentSlide
              key={book.hash}
              book={book}
              coverFit={coverFit}
              isSelectMode={isSelectMode}
              bookSelected={selectedBooks.has(book.hash)}
              onOpenBook={onOpenBook}
              toggleSelection={toggleSelection}
              handleSetSelectMode={handleSetSelectMode}
              handleBookUpload={handleBookUpload}
              handleBookDownload={handleBookDownload}
              showBookDetailsModal={showBookDetailsModal}
              showTimeRemaining={showTimeRemaining}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default RecentShelf;
