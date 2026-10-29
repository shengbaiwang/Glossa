import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { CloudUpload, CloudDownload, Headphones, Info } from '@/components/GlossaIcons';

import InlineTextEditor from '@/components/InlineTextEditor';
import BookContextMenuPopup from './BookContextMenuPopup';
import { Book, ReadingStatus } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { navigateToLogin } from '@/utils/nav';
import {
  getActiveFileSyncBackends,
  isReadestCloudStorageActive,
} from '@/services/sync/cloudSyncProvider';
import { isFeedBook } from '@/services/rss/feedBookUrl';
import { formatAuthors, formatDescription, formatSeries } from '@/utils/book';
import ReadingProgress from './ReadingProgress';
import BookCover from '@/components/BookCover';

interface BookItemProps {
  book: Book;
  mode: LibraryViewModeType;
  coverFit: LibraryCoverFitType;
  bookSelected: boolean;
  transferProgress: number | null;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  showBookDetailsModal: (book: Book) => void;
  showTimeRemaining: boolean;
  onRename?: (book: Book, title: string) => Promise<boolean>;
  onUpdateStatus?: (book: Book, status: ReadingStatus | undefined) => void;
}

const BookItem: React.FC<BookItemProps> = ({
  book,
  mode,
  coverFit,
  bookSelected,
  transferProgress,
  handleBookUpload,
  handleBookDownload,
  showBookDetailsModal,
  showTimeRemaining,
  onRename,
  onUpdateStatus,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const hasFileProvider = getActiveFileSyncBackends(settings).length > 0;
  const iconSize15 = useResponsiveSize(15);

  const [statusPosition, setStatusPosition] = useState<{ x: number; y: number } | null>(null);
  const [coverAspect, setCoverAspect] = useState<number | null>(null);
  useEffect(() => {
    setCoverAspect(null);
  }, [book.hash, book.metadata?.coverImageUrl, book.coverImageUrl]);

  const CELL_ASPECT_RATIO = 28 / 41;
  const fitCoverInGrid = mode === 'grid' && coverFit === 'fit' && coverAspect !== null;
  const shouldShrinkWidth = fitCoverInGrid && coverAspect! < CELL_ASPECT_RATIO;
  const bookitemMainStyle = fitCoverInGrid
    ? {
        width: '100%',
        aspectRatio: coverAspect!,
        ...(shouldShrinkWidth ? { width: `${(coverAspect! / CELL_ASPECT_RATIO) * 100}%` } : {}),
      }
    : mode === 'grid'
      ? { width: '100%' }
      : undefined;

  const seriesText = formatSeries(book.metadata?.series, book.metadata?.seriesIndex);

  return (
    <div
      role='none'
      data-selecting={bookSelected || undefined}
      className={clsx(
        'book-item flex',
        mode === 'grid' && 'h-full flex-col',
        mode === 'list' && 'min-h-28 flex-row gap-4',
        mode === 'list' ? 'library-list-item' : 'library-grid-item',
        appService?.hasContextMenu ? 'cursor-pointer' : '',
      )}
    >
      <div
        className={mode === 'grid' ? 'glossa-book-cover-stage aspect-[28/41] w-full' : 'contents'}
      >
        <div
          className={clsx(
            'bookitem-main glossa-book-cover-shell relative flex justify-center',
            !fitCoverInGrid && 'aspect-[28/41]',
            mode === 'grid' && 'items-start',
            mode === 'list' && 'min-w-20 items-center',
          )}
          style={bookitemMainStyle}
        >
          <BookCover
            mode={mode}
            book={book}
            coverFit={coverFit}
            onImageError={() => setCoverAspect(null)}
            onAspectRatioChange={setCoverAspect}
          />
          {bookSelected && <div className='glossa-book-selection-overlay absolute inset-0'></div>}
        </div>
      </div>
      <div
        className={clsx(
          'glossa-book-metadata flex min-w-0 w-full flex-col p-0',
          mode === 'grid' && 'pt-2',
          mode === 'list' && 'gap-1 py-0',
        )}
      >
        <div
          className={clsx(
            'glossa-book-copy min-w-0 flex-1',
            mode === 'list' && 'flex flex-col gap-1',
          )}
        >
          <h4
            className={clsx(
              'glossa-book-title font-medium',
              mode === 'grid' && 'line-clamp-2',
              mode === 'list' && 'line-clamp-2 text-base',
            )}
          >
            {onRename ? (
              <InlineTextEditor
                value={book.title}
                label={_('Title')}
                onSave={(title) => onRename(book, title)}
              />
            ) : (
              book.title
            )}
          </h4>
          {settings.libraryShowAuthor !== false && (
            <p className='glossa-book-author line-clamp-1'>
              {formatAuthors(book.author, book.primaryLanguage) || '\u00a0'}
            </p>
          )}
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
            settings.libraryShowProgress !== false &&
              (onUpdateStatus || book.progress || book.readingStatus)
              ? 'justify-between'
              : 'justify-end',
          )}
        >
          {settings.libraryShowProgress !== false &&
            (onUpdateStatus ? (
              <button
                type='button'
                className='glossa-reading-status-button'
                aria-label={_('Reading Status')}
                aria-haspopup='menu'
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setStatusPosition({ x: r.left, y: r.bottom });
                }}
              >
                {book.progress || book.readingStatus ? (
                  <ReadingProgress book={book} showTimeRemaining={showTimeRemaining} />
                ) : (
                  <span>{_('Unread')}</span>
                )}
              </button>
            ) : (
              (book.progress || book.readingStatus) && (
                <ReadingProgress book={book} showTimeRemaining={showTimeRemaining} />
              )
            ))}
          {settings.libraryShowProgress !== false && statusPosition && (
            <BookContextMenuPopup
              position={statusPosition}
              onClose={() => setStatusPosition(null)}
              items={[
                { text: _('Mark as Unread'), action: () => onUpdateStatus?.(book, 'unread') },
                { text: _('Mark as Finished'), action: () => onUpdateStatus?.(book, 'finished') },
                { text: _('Mark as On hold'), action: () => onUpdateStatus?.(book, 'abandoned') },
                ...(book.readingStatus
                  ? [{ text: _('Clear Status'), action: () => onUpdateStatus?.(book, undefined) }]
                  : []),
              ]}
            />
          )}
          <div className='glossa-book-actions flex shrink-0 items-center justify-center gap-x-3'>
            {
              <button
                type='button'
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
            }
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
              ((!book.uploadedAt && (isReadestCloudStorageActive(settings) || hasFileProvider)) ||
                (book.uploadedAt && !book.downloadedAt)) && (
                <button
                  type='button'
                  aria-label={!book.uploadedAt ? _('Upload Book') : _('Download Book')}
                  className='show-cloud-button glossa-book-cloud-button'
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (!user && !hasFileProvider) {
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
                  {!book.uploadedAt &&
                    (isReadestCloudStorageActive(settings) || hasFileProvider) && (
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
