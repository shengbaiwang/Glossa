import React from 'react';
import { Volume, Type, Gauge, Info, Settings, X } from '@/components/GlossaIcons';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import BookMenuItems from './sidebar/BookMenu';

interface ViewMenuProps {
  bookKey: string;
  setIsDropdownOpen?: (open: boolean) => void;
  onCloseBook?: () => void;
  showReadingAppearance?: boolean;
}
const ViewMenu: React.FC<ViewMenuProps> = ({
  bookKey,
  setIsDropdownOpen,
  onCloseBook,
  showReadingAppearance = false,
}) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(16);
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

      <MenuItem
        label={_('Settings')}
        Icon={<Settings size={iconSize} />}
        onClick={() => {
          setIsDropdownOpen?.(false);
          openSettingsDialog('application');
        }}
      />
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
