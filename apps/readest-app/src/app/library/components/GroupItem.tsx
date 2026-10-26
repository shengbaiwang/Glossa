import clsx from 'clsx';
import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Circle, BookCollection } from '@/components/GlossaIcons';
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
  const firstBook = group.books[0];
  const [coverAspect, setCoverAspect] = useState<number | null>(null);
  useEffect(() => {
    setCoverAspect(null);
  }, [firstBook?.hash, firstBook?.coverImageUrl, firstBook?.metadata?.coverImageUrl]);
  const coverStyle =
    mode === 'grid' && coverAspect
      ? {
          width: `${Math.min(1, coverAspect / (28 / 41)) * 100}%`,
          aspectRatio: coverAspect,
        }
      : undefined;
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

  return (
    <div
      className={clsx(
        'group-item flex min-w-0',
        mode === 'grid' ? 'library-grid-item flex-col' : 'library-list-item flex-row gap-4',
        appService?.hasContextMenu && 'cursor-pointer',
      )}
    >
      <div
        className={mode === 'grid' ? 'glossa-book-cover-stage aspect-[28/41] w-full' : 'contents'}
      >
        <div
          className='groupitem-main glossa-group-cover relative aspect-[28/41] w-full'
          style={coverStyle}
        >
          {group.books.length === 0 ? (
            <div className='glossa-empty-folder-cover'>
              <BookCollection size={40} aria-hidden='true' />
            </div>
          ) : (
            <div className='glossa-group-stack relative h-full w-full'>
              {group.books.slice(0, 3).map((book, index) => (
                <div
                  key={book.hash}
                  className='glossa-group-stack-cover'
                  style={
                    {
                      '--cover-offset': `${index * 3}px`,
                      '--stack-inset': `${(Math.min(group.books.length, 3) - 1) * 3}px`,
                      zIndex: 3 - index,
                    } as CSSProperties
                  }
                >
                  <BookCover
                    book={book}
                    isPreview
                    mode={mode}
                    coverFit='fit'
                    onAspectRatioChange={index === 0 ? setCoverAspect : undefined}
                    onImageError={index === 0 ? () => setCoverAspect(null) : undefined}
                    showSpine={settings.librarySkeuomorphicCovers}
                    imageClassName='rounded-[2px]'
                  />
                </div>
              ))}
            </div>
          )}
          {groupSelected && <div className='glossa-book-selection-overlay absolute inset-0' />}
          {isSelectMode && (
            <div
              className={clsx(
                'glossa-book-selection absolute bottom-2 end-2',
                groupSelected && 'glossa-book-selection-checked',
              )}
            >
              {groupSelected ? <Check size={16} /> : <Circle size={18} />}
            </div>
          )}
        </div>
      </div>
      <div
        className={clsx(
          'glossa-book-metadata flex min-w-0 w-full flex-col',
          mode === 'grid' ? 'pt-2' : 'justify-start',
        )}
      >
        <div className='glossa-book-title line-clamp-2 font-medium'>{name}</div>
        <p className='glossa-book-author'>{_('{{count}} books', { count: group.books.length })}</p>
      </div>
    </div>
  );
};

export default GroupItem;
