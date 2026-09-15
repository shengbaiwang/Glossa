import { ChevronDown, SlidersHorizontal } from '@/components/GlossaIcons';
import type { BookSearchConfig, SearchMode } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { DEFAULT_NEARBY_WORDS, ensureSearchMode, modeToWholeWords } from '@/utils/searchConfig';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/primitives/dropdown-menu';

interface SearchOptionsProps {
  isEink: boolean;
  searchConfig: BookSearchConfig;
  onSearchConfigChanged: (config: BookSearchConfig) => void;
}

export default function SearchOptions({
  isEink,
  searchConfig: config,
  onSearchConfigChanged,
}: SearchOptionsProps) {
  const _ = useTranslation();
  const mode = ensureSearchMode(config);
  const modes: { value: SearchMode; label: string }[] = [
    { value: 'contains', label: _('Normal') },
    { value: 'whole-words', label: _('Whole word') },
    { value: 'nearby-words', label: _('Nearby') },
    { value: 'regex', label: _('Regex') },
  ];
  const setMode = (value: string) => {
    if (!['contains', 'whole-words', 'regex', 'nearby-words'].includes(value)) return;
    const mode = value as SearchMode;
    onSearchConfigChanged({ ...config, mode, matchWholeWords: modeToWholeWords(mode) });
  };
  const active = mode !== 'contains' || config.matchCase || config.matchDiacritics;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          className='glossa-search-options-trigger'
          data-active={active || undefined}
          aria-label={_('Search Options')}
          title={_('Search Options')}
        >
          <SlidersHorizontal size={16} />
          <span>{_('Options')}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        collisionPadding={12}
        className='glossa-search-menu'
        data-eink={isEink || undefined}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenuLabel className='glossa-section-title'>{_('Method')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={setMode} aria-label={_('Method')}>
          {modes.map(({ value, label }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              onSelect={(event) => event.preventDefault()}
            >
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {mode === 'nearby-words' && (
          <>
            <DropdownMenuLabel className='glossa-section-title'>
              {_('Distance (words)')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              className='glossa-search-distance'
              aria-label={_('Distance (words)')}
              value={String(config.nearbyWords ?? DEFAULT_NEARBY_WORDS)}
              onValueChange={(value) =>
                onSearchConfigChanged({ ...config, nearbyWords: Number(value) })
              }
            >
              {[5, 10, 20, 50].map((n) => (
                <DropdownMenuRadioItem
                  key={n}
                  value={String(n)}
                  aria-label={_('{{count}} words', { count: n })}
                  onSelect={(event) => event.preventDefault()}
                >
                  {n}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={config.matchCase}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(value) =>
            onSearchConfigChanged({ ...config, matchCase: value === true })
          }
        >
          {_('Match Case')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={config.matchDiacritics && mode !== 'regex'}
          disabled={mode === 'regex'}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(value) =>
            onSearchConfigChanged({ ...config, matchDiacritics: value === true })
          }
        >
          {_('Match Diacritics')}
        </DropdownMenuCheckboxItem>
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                onSearchConfigChanged({
                  ...config,
                  mode: 'contains',
                  matchWholeWords: false,
                  matchCase: false,
                  matchDiacritics: false,
                  nearbyWords: DEFAULT_NEARBY_WORDS,
                })
              }
            >
              {_('Reset search options')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
