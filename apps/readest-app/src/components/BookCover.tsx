import clsx from 'clsx';
import Image from 'next/image';
import { CSSProperties, memo, useState } from 'react';
import { Book } from '@/types/book';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { formatAuthors, formatTitle } from '@/utils/book';

interface BookCoverProps {
  book: Book;
  mode?: LibraryViewModeType;
  coverFit?: LibraryCoverFitType;
  className?: string;
  imageClassName?: string;
  isPreview?: boolean;
  onImageError?: () => void;
  onAspectRatioChange?: (ratio: number) => void;
}

const BookCover = memo(function BookCover({
  book,
  mode = 'grid',
  coverFit = 'crop',
  className,
  imageClassName,
  isPreview,
  onImageError,
  onAspectRatioChange,
}: BookCoverProps) {
  const coverUrl = book.metadata?.coverImageUrl || book.coverImageUrl;
  const [imageState, setImageState] = useState<{
    url: string;
    status: 'loaded' | 'error';
    ratio?: number;
  }>();
  // A replacement image starts with its own paper cover, even if the previous
  // request finishes late. No imperative visibility state survives a URL change.
  const currentImage = imageState?.url === coverUrl ? imageState : undefined;
  const imageLoaded = currentImage?.status === 'loaded';
  const author = formatAuthors(book.author || book.metadata?.author || '');

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    const ratio = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : undefined;
    setImageState({ url: coverUrl!, status: 'loaded', ratio });
    if (ratio) onAspectRatioChange?.(ratio);
  };

  return (
    <div
      className={clsx('book-cover-container relative flex h-full w-full', className)}
      data-fit={coverFit}
      data-mode={mode}
      data-preview={isPreview || undefined}
      style={{ '--book-cover-ratio': currentImage?.ratio ?? 28 / 41 } as CSSProperties}
    >
      <div className='book-cover-surface'>
        <div className='book-cover-face'>
          {coverUrl && currentImage?.status !== 'error' && (
            <Image
              key={coverUrl}
              src={coverUrl}
              alt={book.title}
              fill
              sizes='(max-width: 640px) 50vw, 240px'
              loading='lazy'
              draggable={false}
              aria-hidden={!imageLoaded}
              className={clsx(
                'cover-image',
                coverFit === 'crop'
                  ? 'crop-cover-img object-cover'
                  : 'fit-cover-img object-contain',
                !imageLoaded && 'invisible',
                imageClassName,
              )}
              onLoad={handleImageLoad}
              onError={() => {
                setImageState({ url: coverUrl, status: 'error' });
                onImageError?.();
              }}
            />
          )}
          <div
            className={clsx('fallback-cover', imageLoaded && 'invisible')}
            role='img'
            aria-label={[formatTitle(book.title), author].filter(Boolean).join(' — ')}
            aria-hidden={imageLoaded}
          >
            <span className={clsx('book-cover-title', isPreview ? 'line-clamp-2' : 'line-clamp-3')}>
              {formatTitle(book.title)}
            </span>
            <span className='book-cover-author line-clamp-2'>{author}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default BookCover;
