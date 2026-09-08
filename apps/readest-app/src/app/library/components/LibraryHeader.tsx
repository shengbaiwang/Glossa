import clsx from 'clsx';
import React, { useRef } from 'react';
import {
  ChevronDown,
  CheckCheck,
  CheckSquare2,
  Ellipsis,
  PanelLeft,
  Search,
  SearchCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
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
import SettingsMenu from './SettingsMenu';
import LibrarySearchOptionsMenu from './LibrarySearchOptionsMenu';
import ViewMenu from './ViewMenu';

interface LibraryHeaderProps {
  isSidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  isSelectMode: boolean;
  isSelectAll: boolean;
  onPullLibrary: () => void;
  onToggleSelectMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
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
  isSelectMode,
  isSelectAll,
  onPullLibrary,
  onToggleSelectMode,
  onSelectAll,
  onDeselectAll,
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
  const { currentBookshelf } = useLibraryStore();

  const headerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const { safeAreaInsets: insets } = useThemeStore();

  useShortcuts({
    onToggleSelectMode,
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
      className={clsx(
        'titlebar glossa-library-header z-10 w-full',
        isTrafficLightVisible && 'glossa-with-traffic-lights',
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
        {isSelectMode ? (
          <>
            <button
              type='button'
              onClick={isSelectAll ? onDeselectAll : onSelectAll}
              className='touch-target glossa-button'
              aria-label={isSelectAll ? _('Deselect') : _('Select All')}
            >
              <CheckCheck size={17} aria-hidden='true' />
              <span>{isSelectAll ? _('Deselect') : _('Select All')}</span>
            </button>
            <button
              type='button'
              onClick={onToggleSelectMode}
              className='touch-target glossa-button glossa-button-primary'
            >
              {_('Done')}
            </button>
          </>
        ) : (
          <>
            <button
              type='button'
              onClick={onToggleSelectMode}
              aria-label={_('Select Books')}
              title={_('Select Books')}
              className='touch-target glossa-icon-button glossa-library-select'
            >
              <CheckSquare2 size={19} aria-hidden='true' />
            </button>
            <Dropdown
              label={_('View Menu')}
              className='dropdown-bottom dropdown-end'
              buttonClassName='touch-target glossa-icon-button'
              toggleButton={<SlidersHorizontal size={19} aria-hidden='true' />}
            >
              <ViewMenu />
            </Dropdown>
            <Dropdown
              label={_('Settings Menu')}
              className='dropdown-bottom dropdown-end'
              buttonClassName='touch-target glossa-icon-button'
              toggleButton={<Ellipsis size={21} aria-hidden='true' />}
            >
              <SettingsMenu onPullLibrary={onPullLibrary} />
            </Dropdown>
          </>
        )}
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
