import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookClosed,
  BookOpen,
  LayoutGrid,
  LayoutList,
  ListOrdered,
  Minus,
  Palette,
  Plus,
} from '@/components/GlossaIcons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import {
  LibraryCoverFitType,
  LibraryViewModeType,
  LibraryGroupByType,
  LibrarySecondarySortByType,
  LibrarySortByType,
} from '@/types/settings';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary } from '@/utils/nav';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import { SettingsSelect } from '@/components/settings/primitives';
import { ensureLibraryGroupByType } from '../utils/libraryUtils';

interface ViewMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const ViewMenu: React.FC<ViewMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig } = useEnv();
  const { settings, openSettingsDialog } = useSettingsStore();

  const viewMode = searchParams?.get('view') || settings.libraryViewMode;
  const coverFit = settings.libraryCoverFit;
  const autoColumns = settings.libraryAutoColumns;
  const columns = settings.libraryColumns;
  const listScale = settings.libraryListScale ?? 100;
  const minColumns = window.innerWidth < 640 ? 1 : window.innerWidth < 1024 ? 2 : 3;
  const maxColumns = window.innerWidth < 640 ? 4 : window.innerWidth < 1024 ? 6 : 12;
  const getGridColumns = () => {
    if (!autoColumns) return columns;
    const grid = document.querySelector('.glossa-collection-grid');
    const tracks = grid && window.getComputedStyle(grid).gridTemplateColumns;
    if (tracks && tracks !== 'none') return tracks.split(/\s+/).length;
    const width = window.innerWidth;
    return width < 640
      ? 2
      : width < 768
        ? 3
        : width < 1024
          ? 4
          : width < 1280
            ? 5
            : width < 1536
              ? 6
              : 8;
  };
  const gridColumns = getGridColumns();
  const groupBy = ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy);
  const sortBy = settings.librarySortBy;
  const isAscending = settings.librarySortAscending;
  const sortByAuto = settings.librarySortByAuto ?? true;
  // Primary smart default: when auto is on, grouping by Series implies Series as
  // the primary sort. The stored value is left alone — that way turning auto off
  // later restores the user's previous explicit pick.
  const primaryEffective: LibrarySortByType =
    sortByAuto && groupBy === LibraryGroupByType.Series ? LibrarySortByType.Series : sortBy;
  const primaryIsImplicit = sortByAuto && primaryEffective !== sortBy;
  const thenSortBy: LibrarySecondarySortByType = settings.libraryThenSortBy ?? 'none';
  // Smart default: when grouping by Author and the user hasn't picked an explicit
  // secondary, Series is implied. Surface this in the menu so the highlighted row
  // matches the actual sort behavior.
  const secondaryEffective: LibrarySecondarySortByType =
    thenSortBy === 'none' && groupBy === LibraryGroupByType.Author
      ? LibrarySortByType.Series
      : thenSortBy;
  const secondaryIsImplicit = thenSortBy === 'none' && secondaryEffective !== 'none';
  const isThenAscending = settings.libraryThenSortAscending ?? true;

  const viewOptions = [
    { label: _('Grid'), value: 'grid' as const, Icon: LayoutGrid },
    { label: _('List'), value: 'list' as const, Icon: LayoutList },
  ];

  const coverFitOptions = [
    { label: _('Crop'), value: 'crop' },
    { label: _('Fit'), value: 'fit' },
  ];

  const sortByOptions = [
    { label: _('Title'), value: LibrarySortByType.Title },
    { label: _('Author'), value: LibrarySortByType.Author },
    { label: _('Format'), value: LibrarySortByType.Format },
    { label: _('Series'), value: LibrarySortByType.Series },
    { label: _('Date Read'), value: LibrarySortByType.Updated },
    { label: _('Date Added'), value: LibrarySortByType.Created },
    { label: _('Date Published'), value: LibrarySortByType.Published },
    { label: _('Progress Read'), value: LibrarySortByType.Progress },
    { label: _('Time Remaining'), value: LibrarySortByType.TimeRemaining },
  ];

  const thenSortByOptions: { label: string; value: LibrarySecondarySortByType }[] = [
    { label: _('None'), value: 'none' },
    ...sortByOptions,
  ];

  const handleSetViewMode = async (value: LibraryViewModeType) => {
    await saveSysSettings(envConfig, 'libraryViewMode', value);

    const params = new URLSearchParams(window.location.search);
    params.set('view', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleToggleCropCovers = async (value: LibraryCoverFitType) => {
    await saveSysSettings(envConfig, 'libraryCoverFit', value);

    const params = new URLSearchParams(window.location.search);
    params.set('cover', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleToggleAutoColumns = async () => {
    if (autoColumns) await saveSysSettings(envConfig, 'libraryColumns', getGridColumns());
    await saveSysSettings(envConfig, 'libraryAutoColumns', !autoColumns);
  };

  const handleToggleRecentShelf = async () => {
    await saveSysSettings(
      envConfig,
      'libraryRecentShelfEnabled',
      !settings.libraryRecentShelfEnabled,
    );
  };

  const handleSetViewSize = async (mode: LibraryViewModeType, direction: number) => {
    if (mode === 'list') {
      await saveSysSettings(
        envConfig,
        'libraryListScale',
        Math.max(80, Math.min(140, listScale + direction * 10)),
      );
    } else {
      // More columns make covers smaller; begin with the actual automatic layout.
      await saveSysSettings(
        envConfig,
        'libraryColumns',
        Math.max(minColumns, Math.min(maxColumns, getGridColumns() - direction)),
      );
      await saveSysSettings(envConfig, 'libraryAutoColumns', false);
    }
    if (viewMode !== mode) await handleSetViewMode(mode);
  };

  const handleSetSortBy = async (value: LibrarySortByType) => {
    await saveSysSettings(envConfig, 'librarySortBy', value);
    // Any explicit primary pick locks in the choice and disables the auto
    // smart-default so future groupBy changes don't override the user.
    await saveSysSettings(envConfig, 'librarySortByAuto', false);

    const params = new URLSearchParams(window.location.search);
    params.set('sort', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleSetSortAscending = async (value: boolean) => {
    await saveSysSettings(envConfig, 'librarySortAscending', value);

    const params = new URLSearchParams(window.location.search);
    params.set('order', value ? 'asc' : 'desc');
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleSetThenSortBy = async (value: LibrarySecondarySortByType) => {
    await saveSysSettings(envConfig, 'libraryThenSortBy', value);

    const params = new URLSearchParams(window.location.search);
    if (value === 'none') {
      params.delete('thenSort');
    } else {
      params.set('thenSort', value);
    }
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleSetThenSortAscending = async (value: boolean) => {
    await saveSysSettings(envConfig, 'libraryThenSortAscending', value);

    const params = new URLSearchParams(window.location.search);
    params.set('thenOrder', value ? 'asc' : 'desc');
    navigateToLibrary(router, `${params.toString()}`);
  };

  const sizeLabel = viewMode === 'list' ? _('List Size') : _('Cover Size');

  return (
    <Menu
      className='view-menu glossa-menu-surface dropdown-content no-triangle z-20 mt-2'
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      <div className='glossa-library-display-title'>{_('Library Display')}</div>
      <div role='group' aria-label={_('Layout')} className='glossa-library-display-options'>
        {viewOptions.map(({ label, value, Icon }) => (
          <button
            key={value}
            type='button'
            className='glossa-menu-item glossa-library-display-option'
            aria-pressed={viewMode === value}
            onClick={() => handleSetViewMode(value)}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div role='group' aria-label={sizeLabel} className='glossa-library-size-row'>
        <span>{sizeLabel}</span>
        <div className='glossa-library-size-controls'>
          <button
            type='button'
            aria-label={_('Decrease')}
            title={_('Decrease')}
            className='glossa-icon-button'
            disabled={viewMode === 'list' ? listScale <= 80 : gridColumns >= maxColumns}
            onClick={() => handleSetViewSize(viewMode as LibraryViewModeType, -1)}
          >
            <Minus size={16} />
          </button>
          {viewMode === 'grid' ? (
            <button
              type='button'
              aria-label={_('Auto')}
              aria-pressed={autoColumns}
              title={_('Auto')}
              className='glossa-menu-item glossa-library-size-value'
              onClick={handleToggleAutoColumns}
            >
              {autoColumns ? _('Auto') : _('{{count}} columns', { count: columns })}
            </button>
          ) : (
            <span className='glossa-library-size-value'>{listScale}%</span>
          )}
          <button
            type='button'
            aria-label={_('Increase')}
            title={_('Increase')}
            className='glossa-icon-button'
            disabled={viewMode === 'list' ? listScale >= 140 : gridColumns <= minColumns}
            onClick={() => handleSetViewSize(viewMode as LibraryViewModeType, 1)}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      <hr aria-hidden='true' className='border-base-200 my-1' />
      <div role='group' aria-label={_('Book Covers')}>
        <div className='glossa-library-menu-heading'>{_('Book Covers')}</div>
        <div className='glossa-library-display-options'>
          {coverFitOptions.map((option) => (
            <button
              key={option.value}
              type='button'
              className='glossa-menu-item glossa-library-display-option'
              aria-pressed={coverFit === option.value}
              onClick={() => handleToggleCropCovers(option.value as LibraryCoverFitType)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <MenuItem
          label={_('Skeuomorphic Book Covers')}
          Icon={<BookClosed size={16} />}
          toggled={settings.librarySkeuomorphicCovers}
          onClick={() =>
            saveSysSettings(
              envConfig,
              'librarySkeuomorphicCovers',
              !settings.librarySkeuomorphicCovers,
            )
          }
        />
      </div>
      <MenuItem
        label={_('Continue reading')}
        Icon={<BookOpen size={16} />}
        toggled={settings.libraryRecentShelfEnabled}
        onClick={handleToggleRecentShelf}
      />
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Sort by')} Icon={<ListOrdered size={16} />} detailsOpen={false}>
        <div className='glossa-library-sort-options'>
          <div role='group' aria-label={_('Sort by')} className='glossa-library-sort-row'>
            <span className='glossa-library-sort-label'>{_('Sort by')}</span>
            <SettingsSelect
              ariaLabel={_('Sort by')}
              value={primaryEffective}
              options={sortByOptions.map((option) => ({
                ...option,
                label:
                  primaryIsImplicit && option.value === primaryEffective
                    ? `${option.label} (${_('Auto')})`
                    : option.label,
              }))}
              onChange={(event) => handleSetSortBy(event.target.value as LibrarySortByType)}
            />
            <button
              type='button'
              className='glossa-menu-item glossa-library-sort-direction'
              aria-label={`${_('Sort by')} / ${isAscending ? _('Ascending') : _('Descending')}`}
              onClick={() => handleSetSortAscending(!isAscending)}
            >
              {isAscending ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
              <span>{isAscending ? _('Ascending') : _('Descending')}</span>
            </button>
          </div>
          <div role='group' aria-label={_('Then by...')} className='glossa-library-sort-row'>
            <span className='glossa-library-sort-label'>{_('Then by...')}</span>
            <SettingsSelect
              ariaLabel={_('Then by...')}
              value={secondaryEffective}
              options={thenSortByOptions.map((option) => ({
                ...option,
                label:
                  secondaryIsImplicit && option.value === secondaryEffective
                    ? `${option.label} (${_('Auto')})`
                    : option.label,
              }))}
              onChange={(event) =>
                handleSetThenSortBy(event.target.value as LibrarySecondarySortByType)
              }
            />
            <button
              type='button'
              className='glossa-menu-item glossa-library-sort-direction'
              aria-label={`${_('Then by...')} / ${isThenAscending ? _('Ascending') : _('Descending')}`}
              disabled={secondaryEffective === 'none'}
              onClick={() => handleSetThenSortAscending(!isThenAscending)}
            >
              {isThenAscending ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
              <span>{isThenAscending ? _('Ascending') : _('Descending')}</span>
            </button>
          </div>
        </div>
      </MenuItem>
      <MenuItem
        label={_('Theme & Background')}
        Icon={<Palette size={16} />}
        onClick={() => {
          setIsDropdownOpen?.(false);
          openSettingsDialog('application', '', 'Theme');
        }}
      />
    </Menu>
  );
};

export default ViewMenu;
