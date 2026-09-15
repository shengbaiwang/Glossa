import dayjs from 'dayjs';
import React, { useMemo } from 'react';
import { Trash2 } from '@/components/GlossaIcons';
import { useEnv } from '@/context/EnvContext';
import { BookNote } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { isCfiAtLocation } from '../../utils/bookmark';

interface BookmarkItemProps {
  bookKey: string;
  item: BookNote;
  chapterLabel?: string;
  isNearest?: boolean;
  onClick?: () => void;
}

/** A saved reading position with a read-only preview and a direct delete action. */
const BookmarkItem: React.FC<BookmarkItemProps> = ({
  bookKey,
  item,
  chapterLabel,
  isNearest,
  onClick,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getView } = useReaderStore();

  const { text, cfi } = item;
  const progress = useBookProgress(bookKey);
  const isCurrent = useMemo(
    () => isCfiAtLocation(cfi, progress?.location) || !!isNearest,
    [cfi, progress?.location, isNearest],
  );

  // dayjs().fromNow() reformats every render; cache per createdAt.
  const createdAtLabel = useMemo(() => dayjs(item.createdAt).fromNow(), [item.createdAt]);
  const createdAtDetail = useMemo(
    () => `${createdAtLabel} · ${dayjs(item.createdAt).format('YYYY-MM-DD HH:mm')}`,
    [createdAtLabel, item.createdAt],
  );

  const handleNavigate = (event: React.MouseEvent | React.KeyboardEvent) => {
    event.preventDefault();
    eventDispatcher.dispatch('navigate', { bookKey, cfi });

    onClick?.();
    getView(bookKey)?.goTo(cfi);
  };

  const deleteBookmark = () => {
    if (!bookKey) return;
    const config = getConfig(bookKey);
    if (!config) return;
    const { booknotes = [] } = config;
    const now = Date.now();
    const next = booknotes.map((note) =>
      note.id === item.id && !note.deletedAt ? { ...note, deletedAt: now, updatedAt: now } : note,
    );
    const updatedConfig = updateBooknotes(bookKey, next);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
  };

  return (
    <li
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
      role='button'
      aria-current={isCurrent ? 'page' : undefined}
      className='glossa-reader-bookmark-item relative mx-2 my-1 cursor-pointer px-2 py-2.5'
      title={createdAtDetail}
      tabIndex={0}
      onClick={handleNavigate}
      onKeyDown={(e) => {
        // Let the delete button (and anything inside it) handle its own
        // keyboard; the row activates only from its own focus.
        if (e.target !== e.currentTarget) {
          e.stopPropagation();
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          handleNavigate(e);
        } else {
          e.stopPropagation();
        }
      }}
    >
      {(chapterLabel || !!item.page) && (
        <div className='glossa-reader-bookmark-header'>
          {chapterLabel && (
            <div
              className='glossa-reader-bookmark-heading truncate'
              dir='auto'
              title={chapterLabel}
            >
              {chapterLabel}
            </div>
          )}
          {!!item.page && (
            <span className='glossa-supporting-text ms-auto shrink-0 whitespace-nowrap tabular-nums'>
              {_('Page {{number}}', { number: item.page })}
            </span>
          )}
        </div>
      )}
      <div className='glossa-reader-bookmark-body'>
        {text && (
          <div className='glossa-reader-bookmark-preview'>
            <span className='line-clamp-2' dir='auto'>
              {text}
            </span>
          </div>
        )}
        <button
          type='button'
          className='glossa-icon-button glossa-detail-icon glossa-reader-bookmark-delete ms-auto shrink-0'
          aria-label={_('Delete')}
          title={_('Delete')}
          onClick={(event) => {
            event.stopPropagation();
            deleteBookmark();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Trash2 aria-hidden='true' />
        </button>
      </div>
    </li>
  );
};

// Memoize: the view re-renders on every progress tick / config change.
// Without React.memo each tick would re-render every visible row even
// though their props are unchanged. Default shallow compare is enough since
// `item` and `onClick` are stable references from the parent's useMemo /
// useCallback.
export default React.memo(BookmarkItem);
