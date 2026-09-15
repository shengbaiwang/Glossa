import { Search, X, Trash2, Square } from '@/components/GlossaIcons';
import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import {
  createLibrarySearchSession,
  resolveSearchResultCfis,
  resolveSearchChapterRange,
  searchLibraryBooks,
  type LibrarySearchSession,
  type SearchSectionRange,
} from '@/services/librarySearchService';
import type { BookSearchConfig, BookSearchMatch, BookSearchResult } from '@/types/book';
import {
  getChapterSearchRange,
  isMatchInChapter,
  type ChapterSearchRange,
} from '@/utils/chapterSearch';
import SearchOptions from './SearchOptions';

const MAX_SEARCH_HISTORY = 10;
const loadHistory = (key: string): string[] => {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(data)
      ? data
          .filter((value): value is string => typeof value === 'string' && !!value.trim())
          .slice(0, MAX_SEARCH_HISTORY)
      : [];
  } catch {
    return [];
  }
};

interface SearchBarProps {
  isVisible: boolean;
  bookKey: string;
  onHideSearchBar: () => void;
}

export default function SearchBar({ isVisible, bookKey, onHideSearchBar }: SearchBarProps) {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData, getConfig, setConfig, saveConfig } = useBookDataStore();
  const { getView, getProgress, getViewSettings } = useReaderStore();
  const {
    getSearchNavState,
    getSearchStatus,
    setSearchTerm,
    setSearchResults,
    setSearchProgress,
    setSearchError,
    setSearchStatus,
    setSearchResultIndex,
    setSearchOrigin,
  } = useSidebarStore();
  const { searchTerm, searchError } = getSearchNavState(bookKey);
  const config = getConfig(bookKey)!.searchConfig as BookSearchConfig;
  const historyKey = `search-history-${bookKey.split('-')[0]}`;
  const [history, setHistory] = useState<string[]>(() => loadHistory(historyKey));
  const [composing, setComposing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [scopeLabel, setScopeLabel] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<LibrarySearchSession | null>(null);
  const configKey = JSON.stringify(config);
  const searching = getSearchStatus(bookKey) === 'searching';

  const cancel = () => {
    controllerRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const reset = (pending = false) => {
    cancel();
    setSearchResults(bookKey, pending ? [] : null);
    setSearchResultIndex(bookKey, 0);
    setSearchOrigin(bookKey, null);
    setSearchProgress(bookKey, pending ? 0 : 1);
    setSearchError(bookKey, null);
    setSearchStatus(bookKey, pending ? 'searching' : 'terminated');
    getView(bookKey)?.clearSearch();
    setTruncated(false);
    setInterrupted(false);
  };
  const changeTerm = (term: string) => {
    reset(Boolean(term.trim()) && !composing);
    setSearchTerm(bookKey, term);
  };
  const changeConfig = (searchConfig: BookSearchConfig) => {
    reset(Boolean(searchTerm.trim()));
    setConfig(bookKey, { searchConfig });
    void saveConfig(envConfig, bookKey, getConfig(bookKey)!, settings);
    setRevision((n) => n + 1);
  };

  useEffect(() => {
    setHistory(loadHistory(historyKey));
    return () => {
      cancel();
      void sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [historyKey]);
  useEffect(() => {
    if (isVisible && !appService?.isMobile) inputRef.current?.focus();
  }, [isVisible, appService]);

  // Keep changing service/store closures out of scheduling dependencies. Only a
  // query/config change starts work; navigation through its hits never re-scopes it.
  const runRef = useRef<() => Promise<void>>(async () => {});
  runRef.current = async () => {
    const book = getBookData(bookKey)?.book;
    const view = getView(bookKey);
    if (!book || !view || !appService) return;
    const searchConfig = { ...(getConfig(bookKey)!.searchConfig as BookSearchConfig) };
    const term = searchConfig.mode === 'regex' ? searchTerm : searchTerm.trim();
    const controller = new AbortController();
    controllerRef.current = controller;
    const session = (sessionRef.current ??= createLibrarySearchSession(appService));
    const stopped = () => controller.signal.aborted || controllerRef.current !== controller;
    setSearchOrigin(bookKey, getProgress(bookKey)?.location ?? view.lastLocation?.cfi ?? null);
    const results: BookSearchResult[] = [];
    try {
      let sectionIndex: number | undefined;
      let sectionRange: SearchSectionRange | undefined;
      let label = '';
      let chapter: ChapterSearchRange | null = null;
      if (searchConfig.scope === 'section') {
        const progress = getProgress(bookKey);
        const location = view.lastLocation?.cfi ?? progress?.location;
        const range = getChapterSearchRange(view.book?.toc ?? [], location ?? '');
        chapter = range;
        if (range) {
          label = range.label;
          sectionRange = await resolveSearchChapterRange(session, book, range);
        } else if (progress?.section.current != null && !view.book?.toc?.length) {
          sectionIndex = progress.section.current;
        } else {
          if (!stopped()) {
            setSearchError(bookKey, _('Current chapter is unavailable'));
            setSearchProgress(bookKey, 1);
            setSearchStatus(bookKey, 'completed');
          }
          return;
        }
      }
      if (stopped()) return;
      setScopeLabel(label);
      for await (const event of searchLibraryBooks(appService, [book], term, {
        config: searchConfig,
        signal: controller.signal,
        session,
        sectionIndex,
        sectionRange,
      })) {
        if (stopped()) return;
        if (event.type === 'progress') setSearchProgress(bookKey, event.bookProgress);
        else if (event.type === 'result') {
          const resolved = await resolveSearchResultCfis(
            session,
            book,
            event.result.subitems.map((match) => match.locator),
          );
          if (stopped()) return;
          const subitems: BookSearchMatch[] = [];
          event.result.subitems.forEach((match, index) => {
            const entry = resolved[index];
            if (entry && (!chapter || isMatchInChapter(entry.cfi, chapter)))
              subitems.push({
                cfi: entry.cfi,
                ...(entry.cfis ? { cfis: entry.cfis } : {}),
                excerpt: match.excerpt,
              });
          });
          if (subitems.length) {
            const previous = results.at(-1);
            if (label && previous) previous.subitems.push(...subitems);
            else
              results.push({
                index: event.result.index,
                label: label || event.result.label,
                subitems,
              });
            setSearchResults(bookKey, [...results]);
          }
        } else if (event.type === 'book-error' || event.type === 'book-skipped') {
          const code = event.type === 'book-error' ? event.code : undefined;
          setSearchError(
            bookKey,
            code === 'INVALID_REGEX'
              ? _('Invalid regular expression')
              : code === 'NEARBY_NEEDS_TWO_WORDS'
                ? _('Enter at least two words')
                : _('Search failed'),
          );
          setSearchResults(bookKey, []);
          setSearchStatus(bookKey, 'completed');
          setSearchProgress(bookKey, 1);
          return;
        } else if (event.type === 'book-completed') {
          setTruncated(Boolean(event.truncated));
        }
      }
      if (stopped()) return;
      setSearchResults(bookKey, [...results]);
      if (results.length) {
        for await (const item of view.search({ ...searchConfig, query: term, results })) {
          if (stopped()) return;
          if (item === 'done') break;
        }
        if (stopped()) return;
        const next = [term, ...loadHistory(historyKey).filter((t) => t !== term)].slice(
          0,
          MAX_SEARCH_HISTORY,
        );
        setHistory(next);
        try {
          localStorage.setItem(historyKey, JSON.stringify(next));
        } catch {
          /* Optional local history. */
        }
      }
      setSearchStatus(bookKey, 'completed');
      setSearchProgress(bookKey, 1);
    } catch {
      if (stopped()) return;
      setSearchError(bookKey, _('Search failed'));
      setSearchResults(bookKey, []);
      setSearchStatus(bookKey, 'completed');
      setSearchProgress(bookKey, 1);
    }
  };

  useEffect(() => {
    if (!isVisible || composing || !searchTerm.trim()) {
      reset();
      return;
    }
    reset(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runRef.current();
    }, 350);
    return cancel;
    // Scheduling deliberately depends on the query and serialized options only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, searchTerm, configKey, isVisible, composing, revision]);

  return (
    <div className='glossa-reader-search'>
      <div className='glossa-search-field eink-bordered'>
        <Search size={16} aria-hidden='true' />
        <input
          ref={inputRef}
          type='text'
          value={searchTerm}
          spellCheck={false}
          aria-label={_('Search in Book')}
          aria-invalid={Boolean(searchError)}
          placeholder={_('Search book text')}
          onChange={(event) => changeTerm(event.target.value)}
          onCompositionStart={() => {
            reset();
            setComposing(true);
          }}
          onCompositionEnd={(event) => {
            setSearchTerm(bookKey, event.currentTarget.value);
            setComposing(false);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || composing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              onHideSearchBar();
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const nav = getSearchNavState(bookKey);
              const matches = (nav.searchResults ?? []).flatMap((result) =>
                'subitems' in result ? result.subitems : [result],
              );
              if (!searching && matches.length) {
                const index = Math.max(
                  0,
                  Math.min(matches.length - 1, nav.searchResultIndex + (event.shiftKey ? -1 : 1)),
                );
                setSearchResultIndex(bookKey, index);
                void getView(bookKey)?.goTo(matches[index]!.cfi);
                return;
              }
              cancel();
              reset(Boolean(searchTerm.trim()));
              if (searchTerm.trim()) void runRef.current();
            }
          }}
        />
        {searchTerm && (
          <button
            type='button'
            className='glossa-icon-button'
            aria-label={_('Clear search')}
            onClick={() => {
              changeTerm('');
              inputRef.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className='glossa-search-toolbar'>
        <div className='glossa-search-scope' role='group' aria-label={_('Search scope')}>
          <button
            type='button'
            aria-pressed={config.scope === 'book'}
            onClick={() => changeConfig({ ...config, scope: 'book' })}
          >
            {_('Entire book')}
          </button>
          <button
            type='button'
            aria-pressed={config.scope === 'section'}
            title={scopeLabel || undefined}
            onClick={() => changeConfig({ ...config, scope: 'section' })}
          >
            {_('Current chapter')}
          </button>
        </div>
        <SearchOptions
          isEink={!!getViewSettings(bookKey)?.isEink}
          searchConfig={config}
          onSearchConfigChanged={changeConfig}
        />
      </div>
      {searching && (
        <div className='glossa-search-status' role='status'>
          <span>{_('Searching…')}</span>
          <button
            className='glossa-icon-button'
            aria-label={_('Stop search')}
            onClick={() => {
              cancel();
              setInterrupted(true);
              setSearchStatus(bookKey, 'terminated');
              setSearchProgress(bookKey, 1);
            }}
          >
            <Square size={12} />
          </button>
        </div>
      )}
      {interrupted && (
        <div className='glossa-search-status' role='status'>
          {_('Search stopped')}
        </div>
      )}
      {searchError && (
        <div className='glossa-search-status text-error' role='alert'>
          <span>{searchError}</span>
          <button onClick={() => setRevision((n) => n + 1)}>{_('Retry')}</button>
        </div>
      )}
      {truncated && (
        <div className='glossa-supporting-text' role='status'>
          {_('Result limit reached')}
        </div>
      )}
      {!!history.length && !searchTerm && (
        <div className='glossa-search-history'>
          <div>
            {history.map((term) => (
              <button key={term} title={term} onClick={() => changeTerm(term)}>
                {term}
              </button>
            ))}
          </div>
          <button
            className='glossa-icon-button'
            aria-label={_('Clear search history')}
            onClick={() => {
              setHistory([]);
              try {
                localStorage.removeItem(historyKey);
              } catch {
                /* Optional history. */
              }
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
