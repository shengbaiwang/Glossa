import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Info,
  LayoutGrid,
  LayoutList,
  ListOrdered,
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
import { Toggle } from '@/components/primitives/toggle';
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
  const { settings } = useSettingsStore();

  const viewMode = searchParams?.get('view') || settings.libraryViewMode;
  const coverFit = settings.libraryCoverFit;
  const autoColumns = settings.libraryAutoColumns;
  const listScale = settings.libraryListScale ?? 100;
  // Read the rendered track so a legacy column preference starts at its visible size.
  const grid = document.querySelector('.glossa-collection-grid');
  const visibleWidth = grid ? parseFloat(window.getComputedStyle(grid).gridTemplateColumns) : NaN;
  const coverWidth = Math.max(
    112,
    Math.min(
      280,
      Math.round(
        (!autoColumns && settings.libraryCoverWidth
          ? settings.libraryCoverWidth
          : Number.isFinite(visibleWidth)
            ? visibleWidth
            : 156) / 4,
      ) * 4,
    ),
  );
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
    { label: _('Fill cover'), value: 'crop' },
    { label: _('Show full cover'), value: 'fit' },
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

  const handleSetViewSize = async (value: number) => {
    if (viewMode === 'list') {
      await saveSysSettings(envConfig, 'libraryListScale', value);
    } else {
      await saveSysSettings(envConfig, 'libraryCoverWidth', value);
      await saveSysSettings(envConfig, 'libraryAutoColumns', false);
    }
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
      <div role='group' aria-label={sizeLabel} className='glossa-library-size-section'>
        <div className='glossa-library-size-heading'>
          <span>{sizeLabel}</span>
          {viewMode === 'grid' && (
            <button
              type='button'
              aria-label={_('Auto')}
              aria-pressed={autoColumns}
              className='glossa-menu-item glossa-library-size-auto'
              onClick={() => saveSysSettings(envConfig, 'libraryAutoColumns', true)}
            >
              {_('Auto')}
            </button>
          )}
        </div>
        <div className='glossa-library-size-controls'>
          <span>{_('Small')}</span>
          <input
            type='range'
            aria-label={sizeLabel}
            aria-valuetext={viewMode === 'list' ? `${listScale}%` : undefined}
            min={viewMode === 'list' ? 80 : 112}
            max={viewMode === 'list' ? 140 : 280}
            step={viewMode === 'list' ? 10 : 4}
            value={viewMode === 'list' ? listScale : coverWidth}
            onChange={(event) => handleSetViewSize(Number(event.target.value))}
          />
          <span>{_('Large')}</span>
        </div>
      </div>

      {viewMode === 'grid' && (
        <div role='group' aria-label={_('Book Covers')} className='glossa-library-cover-options'>
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
          <label className='glossa-library-display-toggle'>
            <span>{_('3D covers')}</span>
            <Toggle
              className='toggle-sm'
              checked={settings.librarySkeuomorphicCovers}
              onChange={() =>
                saveSysSettings(
                  envConfig,
                  'librarySkeuomorphicCovers',
                  !settings.librarySkeuomorphicCovers,
                )
              }
            />
          </label>
        </div>
      )}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Book information')} Icon={<Info size={16} />} detailsOpen={false}>
        <div className='glossa-library-info-options'>
          <label className='glossa-library-display-toggle'>
            <span>{_('Author')}</span>
            <Toggle
              className='toggle-sm'
              checked={settings.libraryShowAuthor !== false}
              onChange={() =>
                saveSysSettings(
                  envConfig,
                  'libraryShowAuthor',
                  settings.libraryShowAuthor === false,
                )
              }
            />
          </label>
          <label className='glossa-library-display-toggle'>
            <span>{_('Reading Progress')}</span>
            <Toggle
              className='toggle-sm'
              checked={settings.libraryShowProgress !== false}
              onChange={() =>
                saveSysSettings(
                  envConfig,
                  'libraryShowProgress',
                  settings.libraryShowProgress === false,
                )
              }
            />
          </label>
        </div>
      </MenuItem>
      <label className='glossa-library-display-toggle'>
        <span>{_('Show recent reading')}</span>
        <Toggle
          className='toggle-sm'
          checked={settings.libraryRecentShelfEnabled}
          onChange={() =>
            saveSysSettings(
              envConfig,
              'libraryRecentShelfEnabled',
              !settings.libraryRecentShelfEnabled,
            )
          }
        />
      </label>
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
    </Menu>
  );
};

export default ViewMenu;
