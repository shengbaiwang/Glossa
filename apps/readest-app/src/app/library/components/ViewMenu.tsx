import React, { useRef, useState } from 'react';
import { getLibraryCoverWidth } from '@/utils/libraryDisplaySettings';
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
  SystemSettings,
  LibraryCoverFitType,
  LibraryViewModeType,
  LibrarySecondarySortByType,
  LibrarySortByType,
} from '@/types/settings';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary } from '@/utils/nav';
import MenuItem from '@/components/MenuItem';
import { Toggle } from '@/components/primitives/toggle';
import Menu from '@/components/Menu';
import { SettingsSelect } from '@/components/settings/primitives';
import { resolveLibraryDisplay } from '../utils/libraryUtils';

interface ViewMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const ViewMenu: React.FC<ViewMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();

  const {
    viewMode,
    coverFit,
    sortBy: primaryEffective,
    thenSortBy: secondaryEffective,
    isAscending,
    isThenAscending,
    sortByAuto,
    thenSortByAuto,
  } = resolveLibraryDisplay(settings, searchParams);
  const listScale = settings.libraryListScale ?? 100;
  const coverWidth = getLibraryCoverWidth(settings);
  const primaryIsImplicit = sortByAuto && primaryEffective !== settings.librarySortBy;
  const secondaryIsImplicit =
    thenSortByAuto && secondaryEffective !== (settings.libraryThenSortBy ?? 'none');
  const [retry, setRetry] = useState<(() => Promise<void>) | null>(null);
  const editSequence = useRef(0);
  const submit = async (action: () => Promise<void>) => {
    const sequence = ++editSequence.current;
    setRetry(null);
    try {
      await action();
    } catch {
      if (sequence === editSequence.current) setRetry(() => action);
    }
  };
  const setPreference = <K extends keyof SystemSettings>(
    key: K,
    value: SystemSettings[K],
    query?: Record<string, string>,
    extra?: () => Promise<void>,
  ) => {
    if (query) {
      const params = new URLSearchParams(window.location.search);
      Object.entries(query).forEach(([name, v]) => params.set(name, v));
      navigateToLibrary(router, params.toString());
    }
    return submit(async () => {
      await saveSysSettings(envConfig, key, value);
      await extra?.();
    });
  };

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

  const handleSetViewMode = (value: LibraryViewModeType) =>
    setPreference('libraryViewMode', value, { view: value });
  const handleToggleCropCovers = (value: LibraryCoverFitType) =>
    setPreference('libraryCoverFit', value, { cover: value });
  const handleSetViewSize = (value: number) =>
    viewMode === 'list'
      ? setPreference('libraryListScale', value)
      : setPreference('libraryCoverWidth', value);
  const handleSetSortBy = (value: LibrarySortByType) =>
    setPreference('librarySortBy', value, { sort: value }, () =>
      saveSysSettings(envConfig, 'librarySortByAuto', false),
    );
  const handleSetSortAscending = (value: boolean) =>
    setPreference('librarySortAscending', value, { order: value ? 'asc' : 'desc' });
  const handleSetThenSortBy = (value: LibrarySecondarySortByType) =>
    setPreference('libraryThenSortBy', value, { thenSort: value }, () =>
      saveSysSettings(envConfig, 'libraryThenSortByAuto', false),
    );
  const handleSetThenSortAscending = (value: boolean) =>
    setPreference('libraryThenSortAscending', value, { thenOrder: value ? 'asc' : 'desc' });

  const sizeLabel = viewMode === 'list' ? _('List Size') : _('Cover Size');

  return (
    <Menu
      className='view-menu glossa-menu-surface dropdown-content no-triangle z-20 mt-2'
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {retry && (
        <div role='alert' className='px-3 py-2 text-sm'>
          <span>{_('Failed to save settings')}</span>
          <button
            type='button'
            className='glossa-menu-item eink-bordered'
            onClick={() => submit(retry)}
          >
            {_('Retry')}
          </button>
        </div>
      )}
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
                setPreference('librarySkeuomorphicCovers', !settings.librarySkeuomorphicCovers)
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
                setPreference('libraryShowAuthor', settings.libraryShowAuthor === false)
              }
            />
          </label>
          <label className='glossa-library-display-toggle'>
            <span>{_('Reading Progress')}</span>
            <Toggle
              className='toggle-sm'
              checked={settings.libraryShowProgress !== false}
              onChange={() =>
                setPreference('libraryShowProgress', settings.libraryShowProgress === false)
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
            setPreference('libraryRecentShelfEnabled', !settings.libraryRecentShelfEnabled)
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
