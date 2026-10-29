import clsx from 'clsx';
import React, { useRef } from 'react';
import {
  ChevronDown,
  PanelLeft,
  Plus,
  Search,
  SearchCheck,
  LayoutGrid,
  X,
} from '@/components/GlossaIcons';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';
import { eventDispatcher } from '@/utils/event';
import GlossaMark from '@/components/GlossaMark';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { LibrarySearchConfig, LibrarySearchTarget } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import useShortcuts from '@/hooks/useShortcuts';
import WindowButtons from '@/components/WindowButtons';
import Dropdown from '@/components/Dropdown';
import ApplicationSettingsButton from '@/components/settings/ApplicationSettingsButton';
import LibrarySearchOptionsMenu from './LibrarySearchOptionsMenu';
import ViewMenu from './ViewMenu';

interface LibraryHeaderProps {
  isSidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  onImportBooks: (anchor: HTMLElement) => void;
  onPullLibrary: () => void;
  searchQuery: string;
  searchTarget: LibrarySearchTarget;
  searchConfig: LibrarySearchConfig;
  onSearchConfigChange: (config: LibrarySearchConfig) => void;
  onSearchQueryChange: (query: string) => void;
  onSearchTargetChange: (target: LibrarySearchTarget) => void;
}

const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  isSidebarVisible,
  onToggleSidebar,
  onImportBooks,
  searchQuery,
  searchTarget,
  searchConfig,
  onSearchConfigChange,
  onSearchQueryChange,
  onSearchTargetChange,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { systemUIVisible, statusBarHeight } = useThemeStore();
  const { currentBookshelf, selectedBooks, setSelectedBooks } = useLibraryStore();
  const selectedCount = selectedBooks?.size ?? 0;

  const headerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const { safeAreaInsets: insets } = useThemeStore();

  useShortcuts({
    onShowSearchBar: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
      return true;
    },
  });

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchQueryChange(e.target.value);
  };

  const windowButtonVisible = appService?.hasWindowBar && !isTrafficLightVisible;
  const currentBooksCount = currentBookshelf.length;

  if (!insets) return null;

  return (
    <div
      ref={headerRef}
      onKeyDownCapture={(event) => {
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          !selectedCount ||
          (event.target as HTMLElement).closest(
            'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
          ) ||
          headerRef.current?.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        setSelectedBooks([]);
      }}
      className={clsx(
        'titlebar glossa-library-header z-10 w-full',
        isTrafficLightVisible && 'glossa-with-traffic-lights',
        isSidebarVisible && 'glossa-library-sidebar-open',
      )}
      style={{
        marginTop: appService?.hasSafeAreaInset
          ? `max(${insets.top}px, ${systemUIVisible ? statusBarHeight : 0}px)`
          : '0px',
      }}
    >
      <div className='glossa-library-brand' aria-label='Glossa'>
        {onToggleSidebar && (
          <button
            type='button'
            className='exclude-title-bar-mousedown glossa-icon-button glossa-library-sidebar-toggle'
            aria-label={_('Toggle Sidebar')}
            title={_('Toggle Sidebar')}
            aria-expanded={isSidebarVisible}
            aria-controls='library-navigation'
            onClick={onToggleSidebar}
          >
            <PanelLeft size={19} aria-hidden='true' />
          </button>
        )}
        <GlossaMark className='size-9 shrink-0' />
        <span>Glossa</span>
      </div>
      <div
        className='exclude-title-bar-mousedown glossa-library-search eink-bordered'
        role='search'
      >
        <button
          type='button'
          aria-pressed={searchTarget === 'text'}
          aria-label={searchTarget === 'text' ? _('Full Text Search') : _('Search Books')}
          title={searchTarget === 'text' ? _('Full Text Search') : _('Search Books')}
          className='touch-target glossa-icon-button glossa-search-mode'
          onClick={() => onSearchTargetChange(searchTarget === 'text' ? 'books' : 'text')}
        >
          {searchTarget === 'text' ? <SearchCheck size={18} /> : <Search size={18} />}
        </button>
        <input
          ref={searchRef}
          type='search'
          value={searchQuery}
          aria-label={searchTarget === 'text' ? _('Full Text Search') : _('Search Books')}
          placeholder={
            searchTarget === 'text'
              ? _('Search contents in {{count}} Book(s)...', { count: currentBooksCount })
              : _('Search Books...')
          }
          onChange={handleSearchChange}
          spellCheck='false'
          className='search-input glossa-search-input'
        />
        {searchQuery && (
          <button
            type='button'
            onClick={() => onSearchQueryChange('')}
            className='touch-target glossa-icon-button glossa-search-clear'
            aria-label={_('Clear Search')}
          >
            <X size={16} />
          </button>
        )}
        {searchTarget === 'text' && (
          <Dropdown
            label={_('Search Options')}
            className='dropdown-bottom dropdown-end'
            menuClassName='no-triangle mt-1'
            buttonClassName='touch-target glossa-icon-button glossa-search-options'
            toggleButton={<ChevronDown size={16} aria-hidden='true' />}
          >
            <LibrarySearchOptionsMenu config={searchConfig} onConfigChange={onSearchConfigChange} />
          </Dropdown>
        )}
      </div>
      <div className='exclude-title-bar-mousedown glossa-library-actions'>
        {selectedCount > 0 && (
          <>
            <Dropdown
              label={_('{{count}} selected', { count: selectedCount })}
              buttonClassName='touch-target glossa-button'
              toggleButton={
                <>
                  <span>{_('{{count}} selected', { count: selectedCount })}</span>
                  <ChevronDown size={16} />
                </>
              }
            >
              <Menu>
                <MenuItem
                  noIcon
                  transient
                  label={_('Move to…')}
                  disabled={!selectedCount}
                  onClick={() => {
                    void eventDispatcher.dispatch('library-move-selection');
                  }}
                />
                <MenuItem
                  noIcon
                  transient
                  label={_('Delete')}
                  buttonClass='glossa-delete-action'
                  disabled={!selectedCount}
                  onClick={() => {
                    void eventDispatcher.dispatch('library-delete-selection');
                  }}
                />
              </Menu>
            </Dropdown>
            <button
              type='button'
              onClick={() => setSelectedBooks([])}
              aria-label={_('Clear Selection')}
              className='touch-target glossa-icon-button'
            >
              <X size={18} />
            </button>
          </>
        )}
        <button
          type='button'
          className='touch-target glossa-button glossa-library-import'
          aria-label={_('Import Books')}
          aria-haspopup='menu'
          onClick={(event) => onImportBooks(event.currentTarget)}
        >
          <Plus size={16} aria-hidden='true' />
          <span>{_('Import')}</span>
        </button>
        <Dropdown
          label={_('Library Display')}
          className='dropdown-bottom dropdown-end'
          buttonClassName='touch-target glossa-button glossa-library-display-trigger'
          onToggle={(open) => {
            if (!open) {
              headerRef.current
                ?.querySelector<HTMLButtonElement>('.glossa-library-display-trigger')
                ?.focus();
            }
          }}
          toggleButton={
            <>
              <LayoutGrid size={18} aria-hidden='true' />
              <span>{_('Display')}</span>
            </>
          }
        >
          <ViewMenu />
        </Dropdown>
        <div className='glossa-library-toolbar-settings'>
          <ApplicationSettingsButton />
        </div>
        {appService?.hasWindowBar && (
          <WindowButtons
            headerRef={headerRef}
            showMinimize={windowButtonVisible}
            showMaximize={windowButtonVisible}
            showClose={windowButtonVisible}
          />
        )}
      </div>
    </div>
  );
};

export default LibraryHeader;
