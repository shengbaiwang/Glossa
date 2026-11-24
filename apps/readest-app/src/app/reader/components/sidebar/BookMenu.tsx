import { Columns2, BookOpen } from '@/components/GlossaIcons';
import MenuItem from '@/components/MenuItem';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { useReaderStore } from '@/store/readerStore';
import { FIXED_LAYOUT_FORMATS } from '@/types/book';
import useBooksManager from '../../hooks/useBooksManager';
import ReaderCommandItem from '../ReaderCommandItem';

export default function ParallelReadMenu({
  bookKey,
  setIsDropdownOpen,
}: {
  bookKey: string;
  setIsDropdownOpen?: (open: boolean) => void;
}) {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(16);
  const { bookKeys } = useReaderStore();
  const { getVisibleLibrary } = useLibraryStore();
  const { openParallelView } = useBooksManager();
  const { parallelViews } = useParallelViewStore();
  const books = getVisibleLibrary()
    .filter((book) => !FIXED_LAYOUT_FORMATS.has(book.format) && !!book.downloadedAt)
    .slice(0, 20);
  const handleParallelView = (id: string) => {
    if (!useReaderStore.getState().bookKeys.includes(bookKey)) return;
    openParallelView(id, bookKey);
    setIsDropdownOpen?.(false);
  };

  return (
    <MenuItem
      label={_('Parallel Read')}
      buttonClass={bookKeys.length > 1 ? 'lg:tooltip lg:tooltip-bottom' : ''}
      disabled={!books.length && bookKeys.length < 2}
      Icon={<Columns2 size={iconSize} />}
    >
      <ul className='max-h-60 overflow-y-auto'>
        {books.map((book) => (
          <MenuItem
            key={book.hash}
            Icon={
              <img
                src={book.coverImageUrl!}
                alt={book.title}
                width={56}
                height={80}
                className='aspect-auto max-h-8 max-w-4 rounded-sm shadow-md'
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            }
            label={book.title}
            labelClass='max-w-36'
            onClick={() => handleParallelView(book.hash)}
          />
        ))}
        {bookKeys.length > 1 && (
          <ReaderCommandItem
            id={parallelViews.length > 0 ? 'exitParallel' : 'enterParallel'}
            bookKey={bookKey}
            icon={
              parallelViews.length > 0 ? <BookOpen size={iconSize} /> : <Columns2 size={iconSize} />
            }
            onClose={() => setIsDropdownOpen?.(false)}
          />
        )}
      </ul>
    </MenuItem>
  );
}
