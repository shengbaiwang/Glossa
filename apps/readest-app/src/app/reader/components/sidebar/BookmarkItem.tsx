import clsx from 'clsx';
import dayjs from 'dayjs';
import React, { useMemo, useRef, useState } from 'react';
import { Pencil, Trash2, Copy } from '@/components/GlossaIcons';

import { useEnv } from '@/context/EnvContext';
import { BookNote } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { eventDispatcher } from '@/utils/event';
import { isCfiAtLocation } from '../../utils/bookmark';
import { buildAnnotationUrl } from '@/utils/deeplink';
import { buildAnnotationCopyMarkdown } from '@/utils/note';
import { writeTextToClipboard } from '@/utils/clipboard';
import { DEFAULT_NOTE_EXPORT_CONFIG } from '@/services/constants';
import TextButton from '@/components/TextButton';
import TextEditor, { TextEditorRef } from '@/components/TextEditor';

interface BookmarkItemProps {
  bookKey: string;
  item: BookNote;
  isNearest?: boolean;
  onClick?: () => void;
}

/**
 * A row of the bookmarks tab: the saved page excerpt, where it is, and jump /
 * rename / delete actions. The excerpt is the primary content — it is the text
 * the reader saw when the bookmark was made and always matches the anchor.
 */
const BookmarkItem: React.FC<BookmarkItemProps> = ({ bookKey, item, isNearest, onClick }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();

  const { text, cfi } = item;
  const editorRef = useRef<TextEditorRef>(null);
  const [editorDraft, setEditorDraft] = useState(text || '');
  const [inlineEditMode, setInlineEditMode] = useState(false);
  const size18 = useResponsiveSize(18);

  const progress = useBookProgress(bookKey);
  const isCurrent = useMemo(
    () => isCfiAtLocation(cfi, progress?.location) || !!isNearest,
    [cfi, progress?.location, isNearest],
  );

  // dayjs().fromNow() reformats every render; cache per createdAt.
  const createdAtLabel = useMemo(() => dayjs(item.createdAt).fromNow(), [item.createdAt]);

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

  const handleSave = () => {
    setInlineEditMode(false);
    const next = editorDraft.trim();
    if (!next) return;
    const config = getConfig(bookKey);
    if (!config) return;
    const { booknotes = [] } = config;
    const index = booknotes.findIndex((note) => note.id === item.id && !note.deletedAt);
    if (index === -1) return;
    const updated: BookNote = { ...booknotes[index]!, text: next, updatedAt: Date.now() };
    const nextBooknotes = [...booknotes];
    nextBooknotes[index] = updated;
    const updatedConfig = updateBooknotes(bookKey, nextBooknotes);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
  };

  const handleCopyLink = () => {
    const bookHash = item.bookHash || bookKey.split('-')[0]!;
    const linkType =
      getViewSettings(bookKey)?.noteExportConfig?.linkType ?? DEFAULT_NOTE_EXPORT_CONFIG.linkType;
    const url = buildAnnotationUrl({ bookHash, noteId: item.id, cfi: item.cfi }, linkType);
    const linkLabel = item.page
      ? _('Page: {{number}}', { number: item.page })
      : linkType === 'web'
        ? _('Open in browser')
        : _('Open in Glossa');
    const markdown = buildAnnotationCopyMarkdown({
      text: item.text,
      note: item.note,
      noteLabel: _('Note'),
      url,
      linkLabel,
    });
    void writeTextToClipboard(markdown);
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to clipboard'),
      className: 'whitespace-nowrap',
      timeout: 2000,
    });
  };

  if (inlineEditMode) {
    return (
      <div
        className={clsx(
          'border-base-300 content group relative my-2 cursor-pointer rounded-lg p-2',
          isCurrent ? 'bg-base-300/85 hover:bg-base-300' : 'hover:bg-base-300/55 bg-base-100',
          'transition-all duration-300 ease-in-out',
        )}
      >
        <div className='flex w-full'>
          <TextEditor
            className='!leading-normal'
            ref={editorRef}
            value={editorDraft}
            onChange={setEditorDraft}
            onSave={handleSave}
            onEscape={() => setInlineEditMode(false)}
            spellCheck={false}
            autoFocus
          />
        </div>
        <div className='flex justify-end space-x-3 p-2' dir='ltr'>
          <TextButton onClick={() => setInlineEditMode(false)}>{_('Cancel')}</TextButton>
          <TextButton onClick={handleSave} disabled={!editorDraft.trim()}>
            {_('Save')}
          </TextButton>
        </div>
      </div>
    );
  }

  return (
    <li
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
      role='button'
      aria-current={isCurrent ? 'page' : undefined}
      className={clsx(
        'booknote-item border-base-300 content group relative my-2 cursor-pointer rounded-lg p-2',
        isCurrent
          ? 'bg-base-300/85 hover:bg-base-300 focus:bg-base-300'
          : 'hover:bg-base-300/55 focus:bg-base-300/55 bg-base-100',
        'transition-all duration-300 ease-in-out',
      )}
      tabIndex={0}
      onClick={handleNavigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleNavigate(e);
        } else {
          e.stopPropagation();
        }
      }}
    >
      <div className='content font-size-sm line-clamp-3 leading-normal'>
        <span dir='auto'>{text || ''}</span>
      </div>
      <div
        className='flex items-center justify-between gap-2 pt-1'
        // This is needed to prevent the parent onClick from being triggered
        onClick={(e) => e.stopPropagation()}
      >
        <div className='min-w-0 flex-1 truncate text-xs text-gray-500 sm:text-[11px]'>
          {item.page ? <span>{_('Page: {{number}}', { number: item.page })}</span> : null}
          {item.page ? <span aria-hidden='true'>{' · '}</span> : null}
          <span>{createdAtLabel}</span>
        </div>
        <div className='flex shrink-0 items-center justify-end gap-3' dir='ltr'>
          <button
            onClick={handleCopyLink}
            className='btn btn-ghost btn-xs text-base-content p-0 opacity-0 transition duration-300 ease-in-out hover:bg-transparent group-focus-within:opacity-100 group-hover:opacity-100'
            aria-label={_('Copy')}
          >
            <Copy size={size18} />
          </button>

          <button
            onClick={deleteBookmark}
            className='btn btn-ghost btn-xs text-base-content p-0 opacity-0 transition duration-300 ease-in-out hover:bg-transparent group-focus-within:opacity-100 group-hover:opacity-100'
            aria-label={_('Delete')}
          >
            <Trash2 size={size18} />
          </button>

          <button
            onClick={() => {
              setEditorDraft(text || '');
              setInlineEditMode(true);
            }}
            className='btn btn-ghost btn-xs text-base-content p-0 opacity-0 transition duration-300 ease-in-out hover:bg-transparent group-focus-within:opacity-100 group-hover:opacity-100'
            aria-label={_('Edit')}
          >
            <Pencil size={size18} />
          </button>
        </div>
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
