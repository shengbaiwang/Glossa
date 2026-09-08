import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Check, Circle, CloudUpload, CloudDownload, Headphones, Info } from 'lucide-react';

import { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { navigateToLogin } from '@/utils/nav';
import { isReadestCloudStorageActive } from '@/services/sync/cloudSyncProvider';
import { isFeedBook } from '@/services/rss/feedBookUrl';
import { formatAuthors, formatDescription, formatSeries } from '@/utils/book';
import ReadingProgress from './ReadingProgress';
import BookCover from '@/components/BookCover';

interface BookItemProps {
  book: Book;
  mode: LibraryViewModeType;
  coverFit: LibraryCoverFitType;
  isSelectMode: boolean;
  bookSelected: boolean;
  transferProgress: number | null;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  showBookDetailsModal: (book: Book) => void;
  showTimeRemaining: boolean;
}

const BookItem: React.FC<BookItemProps> = ({
  book,
  mode,
  coverFit,
  isSelectMode,
  bookSelected,
  transferProgress,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
  showTimeRemaining,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const iconSize15 = useResponsiveSize(15);

  const [coverAspect, setCoverAspect] = useState<number | null>(null);
  useEffect(() => {
    setCoverAspect(null);
  }, [book.hash, book.metadata?.coverImageUrl, book.coverImageUrl]);

  const CELL_ASPECT_RATIO = 28 / 41;
  const fitCoverInGrid = mode === 'grid' && coverFit === 'fit' && coverAspect !== null;
  const shouldShrinkWidth = fitCoverInGrid && coverAspect! < CELL_ASPECT_RATIO;
  const bookitemMainStyle = fitCoverInGrid
    ? {
        aspectRatio: coverAspect!,
        ...(shouldShrinkWidth ? { width: `${(coverAspect! / CELL_ASPECT_RATIO) * 100}%` } : {}),
      }
    : undefined;

  const seriesText = formatSeries(book.metadata?.series, book.metadata?.seriesIndex);

  return (
    <div
      role='none'
      className={clsx(
        'book-item flex',
        mode === 'grid' && 'h-full flex-col justify-end',
        mode === 'list' && 'min-h-28 flex-row gap-4 overflow-hidden',
        mode === 'list' ? 'library-list-item' : 'library-grid-item',
        appService?.hasContextMenu ? 'cursor-pointer' : '',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={clsx(
          'bookitem-main relative flex justify-center overflow-hidden rounded',
          !fitCoverInGrid && 'aspect-[28/41]',
          coverFit === 'crop' && 'glossa-cover-shadow',
          mode === 'grid' && 'items-end',
          mode === 'list' && 'min-w-20 items-center',
        )}
        style={bookitemMainStyle}
      >
        <BookCover
          mode={mode}
          book={book}
          coverFit={coverFit}
          showSpine={settings.librarySkeuomorphicCovers}
          imageClassName={clsx(
            'glossa-cover-shadow',
            settings.librarySkeuomorphicCovers ? 'rounded-none' : 'rounded',
          )}
          onAspectRatioChange={setCoverAspect}
        />
        {bookSelected && <div className='glossa-book-selection-overlay absolute inset-0'></div>}
        {isSelectMode && (
          <div
            className={clsx(
              'glossa-book-selection absolute bottom-2 end-2',
              bookSelected && 'glossa-book-selection-checked',
            )}
          >
            {bookSelected ? (
              <Check size={16} aria-hidden='true' />
            ) : (
              <Circle size={18} aria-hidden='true' />
            )}
          </div>
        )}
      </div>
      <div
        className={clsx(
          'glossa-book-metadata flex min-w-0 w-full flex-col p-0',
          mode === 'grid' && 'pt-2',
          mode === 'list' && 'gap-1 py-0',
        )}
      >
        <div className={clsx('min-w-0 flex-1', mode === 'list' && 'flex flex-col gap-1')}>
          <h4
            className={clsx(
              'glossa-book-title font-medium',
              mode === 'grid' && 'line-clamp-2',
              mode === 'list' && 'line-clamp-2 text-base',
            )}
          >
            {book.title}
          </h4>
          <p className='glossa-book-author line-clamp-1'>
            {formatAuthors(book.author, book.primaryLanguage) || '\u00a0'}
          </p>
        </div>
        {mode === 'list' && seriesText && (
          <p className='text-neutral-content line-clamp-1 text-sm'>{seriesText}</p>
        )}
        {mode === 'list' && (
          <p className='glossa-book-description text-neutral-content line-clamp-1 text-sm'>
            {formatDescription(book.metadata?.description)}
          </p>
        )}
        <div
          className={clsx(
            'glossa-book-status flex items-center',
            book.progress || book.readingStatus ? 'justify-between' : 'justify-end',
          )}
          style={{
            height: `${iconSize15}px`,
            minHeight: `${iconSize15}px`,
          }}
        >
          {(book.progress || book.readingStatus) && (
            <ReadingProgress book={book} showTimeRemaining={showTimeRemaining} />
          )}
          <div className='flex shrink-0 items-center justify-center gap-x-3'>
            {!appService?.isMobile && (
              <button
                aria-label={_('Show Book Details')}
                className='show-detail-button glossa-book-detail-button'
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  showBookDetailsModal(book);
                }}
              >
                <div className='pt-[2px] sm:pt-[1px]'>
                  <Info size={iconSize15} />
                </div>
              </button>
            )}
            {book.hasNarration && (
              <div
                className='pt-[2px] sm:pt-[1px]'
                title={_('Includes narration')}
                aria-label={_('Includes narration')}
              >
                <Headphones size={iconSize15} />
              </div>
            )}
            {transferProgress !== null ? (
              transferProgress === 100 ? null : (
                <div
                  className='radial-progress'
                  style={
                    {
                      '--value': transferProgress,
                      '--size': `${iconSize15}px`,
                      '--thickness': '2px',
                    } as React.CSSProperties
                  }
                  role='progressbar'
                ></div>
              )
            ) : (
              // A feed book has no file to move either way, so it never gets a
              // cloud badge — it would only queue a transfer that fails (#5307).
              !isFeedBook(book) &&
              (!book.uploadedAt || (book.uploadedAt && !book.downloadedAt)) && (
                <button
                  aria-label={!book.uploadedAt ? _('Upload Book') : _('Download Book')}
                  className='show-cloud-button glossa-book-cloud-button'
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (!user) {
                      navigateToLogin(router);
                      return;
                    }
                    if (!book.uploadedAt) {
                      handleBookUpload(book);
                    } else if (!book.downloadedAt) {
                      handleBookDownload(book, { queued: true });
                    }
                  }}
                >
                  {!book.uploadedAt && isReadestCloudStorageActive(settings) && (
                    <CloudUpload size={iconSize15} />
                  )}
                  {book.uploadedAt && !book.downloadedAt && <CloudDownload size={iconSize15} />}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookItem;
