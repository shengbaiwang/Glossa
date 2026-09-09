import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from '@/components/GlossaIcons';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useTranslation } from '@/hooks/useTranslation';
import { getFontPreviewSample } from '@/utils/fontPreview';

interface FontPickerProps {
  label: string;
  selected: string;
  options: { option: string; label: string }[];
  onSelect: (option: string) => void;
  onGetFontFamily: (option: string) => string;
  language?: string;
  useBookFonts?: boolean;
  onSelectBookFonts?: () => void;
  'data-setting-id'?: string;
}

const FontPicker = ({
  label,
  selected,
  options,
  onSelect,
  onGetFontFamily,
  language,
  useBookFonts = false,
  onSelectBookFonts,
  'data-setting-id': settingId,
}: FontPickerProps) => {
  const _ = useTranslation();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const selectedLabel = useBookFonts
    ? _('Book Fonts')
    : (options.find(({ option }) => option === selected)?.label ?? selected);
  const showBookFonts =
    onSelectBookFonts &&
    _('Book Fonts').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const sample = getFontPreviewSample(language);
  const filteredOptions = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return options.filter(
      ({ option, label }) =>
        option.toLocaleLowerCase().includes(search) || label.toLocaleLowerCase().includes(search),
    );
  }, [options, query]);

  const close = () => {
    setExpanded(false);
    setQuery('');
    triggerRef.current?.focus();
  };

  useKeyDownActions({ enabled: expanded, onCancel: close });

  useEffect(() => {
    if (expanded) searchRef.current?.focus();
  }, [expanded]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!expanded) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }

    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    );
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    const inSearch = event.target === searchRef.current;
    if (!buttons.length || (current < 0 && !inSearch)) return;

    let next: number;
    if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home' && !inSearch) next = 0;
    else if (event.key === 'End' && !inSearch) next = buttons.length - 1;
    else return;
    if (inSearch && event.key === 'ArrowUp') next = buttons.length - 1;
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus();
  };

  return (
    <div
      className='glossa-font-picker'
      data-setting-id={settingId}
      onKeyDownCapture={handleKeyDown}
    >
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type='button'
        className='glossa-button glossa-font-trigger eink-bordered flex min-h-12 w-full items-center !justify-between gap-3 text-start'
        aria-label={`${label}: ${selectedLabel}`}
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-options` : undefined}
        onClick={() => {
          if (expanded) close();
          else setExpanded(true);
        }}
      >
        <span className='shrink-0'>{label}</span>
        <span className='ms-auto min-w-0 truncate text-end'>{selectedLabel}</span>
        <ChevronDown size={16} className={expanded ? 'shrink-0 rotate-180' : 'shrink-0'} />
      </button>
      {expanded && (
        <div id={`${id}-options`} className='space-y-2 px-2 pb-2 pt-1'>
          <label className='glossa-font-search eink-bordered flex min-h-11 items-center gap-2 rounded-xl border border-[var(--glossa-border)] px-3 focus-within:outline focus-within:outline-2 focus-within:outline-[var(--glossa-focus)]'>
            <Search size={16} className='shrink-0' />
            <input
              ref={searchRef}
              type='search'
              aria-label={_('Search Fonts')}
              placeholder={_('Search Fonts')}
              className='min-w-0 flex-1 bg-transparent py-2 text-sm outline-none'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <ul
            ref={listRef}
            aria-label={label}
            className='glossa-font-options max-h-72 space-y-1 overflow-y-auto overscroll-contain p-1'
          >
            {showBookFonts && (
              <li>
                <button
                  type='button'
                  className='glossa-button glossa-font-option eink-bordered flex w-full !justify-between gap-3 text-start'
                  aria-label={_('Book Fonts')}
                  aria-pressed={useBookFonts}
                  onClick={() => {
                    onSelectBookFonts();
                    close();
                  }}
                >
                  <span>{_('Book Fonts')}</span>
                  <span className='w-4 shrink-0' aria-hidden='true'>
                    {useBookFonts && <Check size={16} />}
                  </span>
                </button>
              </li>
            )}
            {filteredOptions.map(({ option, label }) => (
              <li key={option}>
                <button
                  type='button'
                  className='glossa-button glossa-font-option eink-bordered flex w-full !items-start !justify-start gap-3 text-start'
                  aria-label={label}
                  aria-pressed={!useBookFonts && selected === option}
                  onClick={() => {
                    onSelect(option);
                    close();
                  }}
                >
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate text-xs'>{label}</span>
                    <span
                      className='glossa-font-sample mt-1 block break-words text-base font-normal leading-relaxed'
                      aria-hidden='true'
                      lang={sample.lang}
                      dir={sample.dir}
                      style={{ fontFamily: onGetFontFamily(option) }}
                    >
                      {sample.text}
                    </span>
                  </span>
                  <span className='mt-0.5 w-4 shrink-0' aria-hidden='true'>
                    {!useBookFonts && selected === option && <Check size={16} />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {filteredOptions.length === 0 && !showBookFonts && (
            <p role='status' className='px-3 py-5 text-center text-sm text-[var(--glossa-muted)]'>
              {_('No matching fonts')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default FontPicker;
