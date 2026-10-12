import React from 'react';
import { Volume, Type, Gauge, Info, Highlight, RefreshCw, X } from '@/components/GlossaIcons';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { saveViewSettings } from '@/helpers/settings';
import { getReadingQuickAction } from '@/utils/annotationToolbar';
import QuickActionMenu from './annotator/QuickActionMenu';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import BookMenuItems from './sidebar/BookMenu';

interface ViewMenuProps {
  bookKey: string;
  setIsDropdownOpen?: (open: boolean) => void;
  onShowMetaHashDialog?: () => void;
  onCloseBook?: () => void;
  showReadingAppearance?: boolean;
}
const ViewMenu: React.FC<ViewMenuProps> = ({
  bookKey,
  setIsDropdownOpen,
  onShowMetaHashDialog,
  onCloseBook,
  showReadingAppearance = false,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(16);
  const { envConfig } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();
  const { getViewSettings, getViewState } = useReaderStore();
  const { openSettingsDialog } = useSettingsStore();
  const bookData = getBookData(bookKey)!;
  const viewSettings = getViewSettings(bookKey)!;
  const viewState = getViewState(bookKey);
  return (
    <Menu
      className='view-menu dropdown-content no-triangle z-20 mt-2 shadow-2xl'
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {showReadingAppearance && (
        <MenuItem
          label={_('Reading Appearance')}
          Icon={<Type size={iconSize} />}
          shortcut='Shift+F'
          onClick={() => {
            setIsDropdownOpen?.(false);
            openSettingsDialog('reading', bookKey);
          }}
        />
      )}
      <MenuItem
        label={_('Read Aloud')}
        Icon={<Volume size={iconSize} />}
        onClick={() => {
          eventDispatcher.dispatch('tts-start', { bookKey });
          setIsDropdownOpen?.(false);
        }}
      />
      <MenuItem
        label={_('Auto Scroll')}
        shortcut='Shift+A'
        Icon={<Gauge size={iconSize} />}
        toggled={viewState?.autoScrollEnabled ?? false}
        disabled={!viewSettings.scrolled}
        onClick={() => {
          eventDispatcher.dispatch('autoscroll-toggle', { bookKey });
          setIsDropdownOpen?.(false);
        }}
      />
      {viewSettings.enableAnnotationQuickActions && (
        <MenuItem label={_('Selection Actions')} Icon={<Highlight size={iconSize} />}>
          <QuickActionMenu
            menuClassName='glossa-reader-inline-menu !relative !m-0 !w-full !border-0 !shadow-none'
            selectedAction={getReadingQuickAction(viewSettings.annotationQuickAction)}
            onActionSelect={(action) => {
              const next =
                getReadingQuickAction(viewSettings.annotationQuickAction) === action
                  ? null
                  : action;
              void saveViewSettings(envConfig, bookKey, 'annotationQuickAction', next, true, true);
            }}
            setIsDropdownOpen={setIsDropdownOpen}
          />
        </MenuItem>
      )}
      <hr aria-hidden='true' className='border-base-300 my-1' />
      <MenuItem
        label={_('Sync Book')}
        Icon={
          <RefreshCw size={iconSize} className={viewState?.syncing ? 'animate-reverse-spin' : ''} />
        }
        onClick={() => {
          eventDispatcher.dispatch('sync-book-progress', { bookKey });
          setIsDropdownOpen?.(false);
        }}
      />
      <MenuItem
        label={_('Sync Info')}
        disabled={!onShowMetaHashDialog}
        Icon={<Info size={iconSize} />}
        onClick={() => {
          onShowMetaHashDialog?.();
          setIsDropdownOpen?.(false);
        }}
      />
      <hr aria-hidden='true' className='border-base-300 my-1' />
      <MenuItem
        label={_('Book Details')}
        Icon={<Info size={iconSize} aria-hidden='true' />}
        disabled={!bookData.book}
        onClick={() => {
          const book = getBookData(bookKey)?.book;
          if (!book) return;
          // Use this view's live page count, not the snapshot from opening the book.
          const progress = getConfig(bookKey)?.progress;
          setIsDropdownOpen?.(false);
          eventDispatcher.dispatchSync(
            'show-book-details',
            progress ? { ...book, progress } : book,
          );
        }}
      />
      <BookMenuItems bookKey={bookKey} setIsDropdownOpen={setIsDropdownOpen} />

      {onCloseBook && (
        <>
          <hr aria-hidden='true' className='border-base-300 my-1' />
          <MenuItem
            label={_('Close Book')}
            Icon={<X size={iconSize} aria-hidden='true' />}
            onClick={() => {
              setIsDropdownOpen?.(false);
              onCloseBook();
            }}
          />
        </>
      )}
    </Menu>
  );
};

export default ViewMenu;
