import clsx from 'clsx';
import Image from 'next/image';
import { CSSProperties, memo, useEffect, useRef, useState } from 'react';
import { Book } from '@/types/book';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { formatAuthors, formatTitle } from '@/utils/book';
import { LIBRARY_REFRESHED_EVENT } from '@/utils/libraryEvents';
import { recordLibraryDiagnostic } from '@/utils/libraryDiagnostics';

// Cache-bust local files only. Remote URLs may carry a query-bound signature.
function imageSource(url: string, version: string, attempt: number) {
  if (/^(data|blob):/.test(url) || (!version && !attempt)) return url;
  const source = new URL(url, window.location.href);
  if (
    source.protocol !== 'asset:' &&
    !['asset.localhost', '127.0.0.1', 'localhost'].includes(source.hostname)
  )
    return url;
  source.searchParams.set('glossa-cover', `${version}:${attempt}`);
  return source.href;
}

type CoverSource = { identity: string; url: string; version: string };
type LoadedCover = CoverSource & { ratio: number };

function CoverRequest({
  identity,
  url,
  version,
  title,
  className,
  onLoad,
  onError,
}: {
  identity: string;
  url: string;
  version: string;
  title: string;
  className: string;
  onLoad: (cover: LoadedCover) => void;
  onError: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const currentAttempt = useRef(attempt);
  currentAttempt.current = attempt;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (status !== 'error') return;
    const retry = () => {
      setAttempt((value) => value + 1);
      setStatus('loading');
    };
    // One automatic retry. Subsequent retries require focus or a completed refresh.
    const timer = attempt === 0 ? window.setTimeout(retry, 750) : undefined;
    window.addEventListener('focus', retry);
    window.addEventListener(LIBRARY_REFRESHED_EVENT, retry);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', retry);
      window.removeEventListener(LIBRARY_REFRESHED_EVENT, retry);
    };
  }, [status, attempt]);
  const src = imageSource(url, version, attempt);
  if (status === 'error') return null;
  return (
    <Image
      key={src + attempt}
      src={src}
      alt={title}
      fill
      sizes='(max-width: 640px) 50vw, 240px'
      loading='lazy'
      draggable={false}
      aria-hidden={status !== 'loaded'}
      className={clsx(className, status !== 'loaded' && 'invisible')}
      onLoad={(event) => {
        if (!alive.current || currentAttempt.current !== attempt) return;
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (!naturalWidth || !naturalHeight) return;
        setStatus('loaded');
        onLoad({ identity, url, version, ratio: naturalWidth / naturalHeight });
        recordLibraryDiagnostic('cover-loaded', {
          attempt,
          width: naturalWidth,
          height: naturalHeight,
        });
      }}
      onError={() => {
        if (!alive.current || currentAttempt.current !== attempt) return;
        setStatus('error');
        onError();
        recordLibraryDiagnostic('cover-error', {
          attempt,
          protocol: url.split(':')[0] ?? 'relative',
        });
      }}
    />
  );
}

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

function BookCoverContent({
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
  const version =
    book.coverHash || book.coverUpdatedAt
      ? `${book.coverHash ?? ''}:${book.coverUpdatedAt ?? ''}`
      : '';
  const identity = JSON.stringify([book.hash, coverUrl, version]);
  const current = useRef(identity);
  current.current = identity;
  const [loaded, setLoaded] = useState<LoadedCover>();
  useEffect(() => {
    if (!coverUrl) setLoaded(undefined);
  }, [coverUrl]);
  const imageLoaded = !!coverUrl && !!loaded;
  const author = formatAuthors(book.author || book.metadata?.author || '');

  const handleImageLoad = (cover: LoadedCover) => {
    if (cover.identity !== current.current) return;
    setLoaded(cover);
    onAspectRatioChange?.(cover.ratio);
  };
  const imageClasses = clsx(
    'cover-image',
    coverFit === 'crop' ? 'crop-cover-img object-cover' : 'fit-cover-img object-contain',
    imageClassName,
  );
  // Keep the successful request mounted until its replacement has decoded.
  const requests: CoverSource[] = coverUrl
    ? [
        ...(loaded && loaded.identity !== identity ? [loaded] : []),
        { identity, url: coverUrl, version },
      ]
    : [];

  return (
    <div
      className={clsx('book-cover-container relative flex h-full w-full', className)}
      data-fit={coverFit}
      data-mode={mode}
      data-preview={isPreview || undefined}
      style={{ '--book-cover-ratio': coverUrl && loaded ? loaded.ratio : 28 / 41 } as CSSProperties}
    >
      <div className='book-cover-surface'>
        <div className='book-cover-face'>
          {requests.map((request) => (
            <CoverRequest
              key={request.identity}
              {...request}
              title={book.title}
              className={imageClasses}
              onLoad={handleImageLoad}
              onError={() => {
                setLoaded((previous) =>
                  previous?.identity === request.identity ? undefined : previous,
                );
                if (current.current === request.identity) onImageError?.();
              }}
            />
          ))}
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
}

const BookCover = memo(function BookCover(props: BookCoverProps) {
  return <BookCoverContent key={props.book.hash} {...props} />;
});

export default BookCover;
