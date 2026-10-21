import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { Check, Circle, ChevronRight, ChevronLeft, BookCollection } from '@/components/GlossaIcons';
import FolderNameEditor from './FolderNameEditor';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { BooksGroup } from '@/types/book';
import { LibraryViewModeType } from '@/types/settings';
import BookCover from '@/components/BookCover';
import { MISSING_AUTHOR_GROUP_ID } from '../utils/libraryUtils';
import { useSettingsStore } from '@/store/settingsStore';

interface GroupItemProps {
  mode: LibraryViewModeType;
  group: BooksGroup;
  isSelectMode: boolean;
  groupSelected: boolean;
  renaming?: boolean;
  onStartRename?: () => void;
  onCancelRename?: (restoreFocus?: boolean) => void;
  onRename?: (name: string) => Promise<boolean>;
}

const GroupItem: React.FC<GroupItemProps> = ({
  mode,
  group,
  isSelectMode,
  groupSelected,
  renaming,
  onStartRename,
  onCancelRename,
  onRename,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const displayName =
    group.id === MISSING_AUTHOR_GROUP_ID ? _('Author not set') : group.displayName;
  const name =
    renaming && onRename && onCancelRename ? (
      <FolderNameEditor initialName={displayName} onSave={onRename} onCancel={onCancelRename} />
    ) : (
      <span
        className='glossa-folder-label'
        onPointerDown={
          onStartRename && !isSelectMode
            ? (event) => {
                if (event.pointerType === 'mouse') event.stopPropagation();
              }
            : undefined
        }
        onPointerUp={
          onStartRename && !isSelectMode
            ? (event) => {
                if (event.pointerType === 'mouse') event.stopPropagation();
              }
            : undefined
        }
        onDoubleClick={!isSelectMode ? onStartRename : undefined}
      >
        <span className='line-clamp-2' title={displayName}>
          {displayName}
        </span>
      </span>
    );

  const checkScrollArrows = () => {
    if (mode === 'list' && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const hasOverflow = container.scrollWidth > container.clientWidth;

      if (hasOverflow) {
        const isAtStart = container.scrollLeft <= 5;
        const isAtEnd = container.scrollLeft >= container.scrollWidth - container.clientWidth - 5;
        setShowLeftArrow(!isAtStart);
        setShowRightArrow(!isAtEnd);
      } else {
        setShowLeftArrow(false);
        setShowRightArrow(false);
      }
    } else {
      setShowLeftArrow(false);
      setShowRightArrow(false);
    }
  };

  useEffect(() => {
    checkScrollArrows();
    if (mode === 'list' && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      setTimeout(() => {
        container.style.transform = 'translateZ(0)';
        container.scrollLeft = 0;
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, group.books.length, scrollContainerRef.current]);

  const handleScroll = () => {
    checkScrollArrows();
  };

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const scrollAmount = container.clientWidth * 0.5;
      const currentScroll = container.scrollLeft;
      const targetScroll = Math.max(0, currentScroll - scrollAmount);
      container.scrollTo({ left: targetScroll, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const scrollAmount = container.clientWidth * 0.5;
      const currentScroll = container.scrollLeft;
      const maxScroll = container.scrollWidth - container.clientWidth;
      const targetScroll = Math.min(maxScroll, currentScroll + scrollAmount);
      container.scrollTo({ left: targetScroll, behavior: 'smooth' });
    }
  };

  const stopEvent = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleLeftArrowClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    scrollLeft();
  };

  const handleRightArrowClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    scrollRight();
  };

  return (
    <div className={clsx('group-item', appService?.hasContextMenu ? 'cursor-pointer' : '')}>
      <div
        className={clsx(
          'groupitem-main relative flex overflow-hidden rounded',
          mode === 'grid' &&
            'glossa-group-cover eink-bordered aspect-[28/41] items-center justify-center',
          mode === 'list' && 'items-center justify-start gap-4 py-2',
        )}
      >
        {group.books.length === 0 && (
          <div className='glossa-empty-folder-cover'>
            <BookCollection size={48} strokeWidth={1.3} aria-hidden='true' />
          </div>
        )}
        <div
          className={clsx(
            mode === 'grid' && 'flex h-full w-full',
            group.books.length === 0 && 'hidden',
            mode === 'list' && 'relative min-w-0 max-w-[85%]',
          )}
        >
          <div
            ref={mode === 'list' ? scrollContainerRef : undefined}
            className={clsx(
              mode === 'grid' && 'glossa-group-stack relative h-full w-full',
              mode === 'list' && 'flex h-28 gap-2 overflow-x-auto overflow-y-hidden',
              mode === 'list' ? 'library-list-item' : 'library-grid-item',
            )}
            style={
              mode === 'list'
                ? {
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    WebkitOverflowScrolling: 'touch',
                    transform: 'translateZ(0)',
                    willChange: 'scroll-position',
                  }
                : undefined
            }
            onScroll={mode === 'list' ? handleScroll : undefined}
          >
            {group.books.slice(0, mode === 'grid' ? 3 : undefined).map((book, index) => (
              <div
                key={book.hash}
                style={
                  mode === 'grid'
                    ? ({
                        '--cover-offset': `${index * 6}px`,
                        '--stack-inset': `${(Math.min(group.books.length, 3) - 1) * 6}px`,
                        zIndex: 3 - index,
                      } as React.CSSProperties)
                    : undefined
                }
                className={clsx(
                  'relative aspect-[28/41] h-full',
                  mode === 'grid' && 'glossa-group-stack-cover',
                  mode === 'list' && 'flex-shrink-0',
                )}
              >
                <BookCover
                  book={book}
                  isPreview
                  showSpine={settings.librarySkeuomorphicCovers}
                  imageClassName='rounded-[2px]'
                />
              </div>
            ))}
          </div>
          {mode === 'list' && showLeftArrow && (
            <div className='absolute left-[-0.5px] top-0 h-full w-12'>
              <button
                aria-label={_('Scroll left')}
                onClick={handleLeftArrowClick}
                onPointerDown={(e) => stopEvent(e)}
                onPointerUp={(e) => stopEvent(e)}
                onPointerMove={(e) => stopEvent(e)}
                onPointerCancel={(e) => stopEvent(e)}
                onPointerLeave={(e) => stopEvent(e)}
                className='absolute left-2 top-1/2 -translate-y-1/2'
              >
                <div className='bg-base-100 border-base-content/10 hover:border-base-content/30 rounded-full border p-1 shadow-sm transition-colors duration-200'>
                  <ChevronLeft
                    size={16}
                    className='text-base-content/50 hover:text-base-content/70'
                  />
                </div>
              </button>
            </div>
          )}
          {mode === 'list' && showRightArrow && (
            <div className='absolute right-[-0.5px] top-0 h-full w-12'>
              <button
                aria-label={_('Scroll right')}
                onClick={handleRightArrowClick}
                onPointerDown={(e) => stopEvent(e)}
                onPointerUp={(e) => stopEvent(e)}
                onPointerMove={(e) => stopEvent(e)}
                onPointerCancel={(e) => stopEvent(e)}
                onPointerLeave={(e) => stopEvent(e)}
                className='absolute right-2 top-1/2 -translate-y-1/2'
              >
                <div className='bg-base-100 border-base-content/10 hover:border-base-content/30 rounded-full border p-1 shadow-sm transition-colors duration-200'>
                  <ChevronRight
                    size={16}
                    className='text-base-content/50 hover:text-base-content/70'
                  />
                </div>
              </button>
            </div>
          )}
        </div>
        {mode === 'list' && (
          <div className='text-base-content/75 w-28 min-w-24 max-w-40 overflow-hidden text-ellipsis text-base font-semibold'>
            {name}
          </div>
        )}
        {groupSelected && <div className='glossa-book-selection-overlay absolute inset-0'></div>}
        {isSelectMode && (
          <div
            className={clsx(
              'glossa-book-selection absolute bottom-2 end-2',
              groupSelected && 'glossa-book-selection-checked',
            )}
          >
            {groupSelected ? (
              <Check size={16} aria-hidden='true' />
            ) : (
              <Circle size={18} aria-hidden='true' />
            )}
          </div>
        )}
      </div>
      {mode === 'grid' && (
        <div className='glossa-book-metadata flex w-full flex-col pt-3'>
          <div className='min-w-0 flex-1'>
            <div className='glossa-book-title min-h-[2.9em] font-medium'>{name}</div>
          </div>
          <p className='glossa-book-author'>
            {_('{{count}} books', { count: group.books.length })}
          </p>
        </div>
      )}
    </div>
  );
};

export default GroupItem;
