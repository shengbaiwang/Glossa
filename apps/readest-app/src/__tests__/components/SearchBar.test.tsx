import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BookSearchConfig } from '@/types/book';
import SearchBar from '@/app/reader/components/sidebar/SearchBar';

const mocks = vi.hoisted(() => ({
  // getProgress returns null until the book emits its first relocate event.
  query: 'alice',
  config: { scope: 'section', mode: 'contains' } as BookSearchConfig,
  progress: null as { section: { current: number } } | null,
  searchLibraryBooks: vi.fn(),
  viewSearch: vi.fn(),
  setSearchError: vi.fn(),
  setSearchResults: vi.fn(),
  setSearchProgress: vi.fn(),
  // Stable like the real context value; a fresh object per render would
  // re-fire the [appService, isVisible] effect and double the search.
  appService: { deleteDir: vi.fn().mockResolvedValue(undefined) },
}));

// Reader search runs on the shared per-book search.db service; the view only
// replays resolved results for highlighting.
vi.mock('@/services/librarySearchService', () => ({
  createLibrarySearchSession: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
  resolveSearchChapterRange: vi.fn(),
  resolveSearchResultCfis: vi.fn(async () => []),
  searchLibraryBooks: mocks.searchLibraryBooks,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: mocks.appService }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { hash: 'book-hash', primaryLanguage: 'en' } }),
    getConfig: () => ({ searchConfig: mocks.config }),
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ search: mocks.viewSearch, clearSearch: vi.fn() }),
    getProgress: () => mocks.progress,
    getViewSettings: () => ({}),
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    setSearchTerm: vi.fn(),
    setSearchResults: mocks.setSearchResults,
    setSearchProgress: mocks.setSearchProgress,
    setSearchError: mocks.setSearchError,
    setSearchResultIndex: vi.fn(),
    setSearchOrigin: vi.fn(),
    setSearchStatus: vi.fn(),
    getSearchStatus: () => 'searching',
    getSearchNavState: () => ({ searchTerm: mocks.query, searchError: null }),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

describe('SearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.query = 'alice';
    mocks.config = { scope: 'section', mode: 'contains', matchCase: false, matchDiacritics: false };
    mocks.searchLibraryBooks.mockReset();
    mocks.searchLibraryBooks.mockImplementation(async function* () {
      yield { type: 'book-completed', book: { hash: 'book-hash' }, matchCount: 0 };
    });
    mocks.viewSearch.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderBar = async () => {
    render(<SearchBar isVisible bookKey='book-1' onHideSearchBar={vi.fn()} />);
    // The search term change is debounced by 500ms before handleSearch runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
  };

  // A section-scoped search fired before the first relocate event used to
  // destructure `section` off a null progress and throw, so the search never
  // reached the service.
  it('does not silently broaden chapter scope before the position is available', async () => {
    mocks.progress = null;
    await renderBar();

    expect(mocks.searchLibraryBooks).not.toHaveBeenCalled();
    expect(mocks.setSearchError).toHaveBeenCalledWith('book-1', 'Current chapter is unavailable');
  });

  it('does not search uncommitted Chinese input', async () => {
    render(<SearchBar isVisible bookKey='book-1' onHideSearchBar={vi.fn()} />);
    const input = screen.getByRole('textbox');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'zhong' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.searchLibraryBooks).not.toHaveBeenCalled();
  });

  it('clears errors and progress immediately and cancels queued work', async () => {
    const { unmount } = render(<SearchBar isVisible bookKey='book-1' onHideSearchBar={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(mocks.setSearchError).toHaveBeenLastCalledWith('book-1', null);
    expect(mocks.setSearchProgress).toHaveBeenLastCalledWith('book-1', 1);
    expect(mocks.setSearchResults).toHaveBeenLastCalledWith('book-1', null);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.searchLibraryBooks).not.toHaveBeenCalled();
  });

  it('preserves significant spaces in regular expressions', async () => {
    mocks.config = { ...mocks.config, scope: 'book', mode: 'regex' };
    mocks.query = ' needle ';
    await renderBar();
    expect(mocks.searchLibraryBooks.mock.calls[0]![2]).toBe(' needle ');
  });

  it('does not let a cancelled request overwrite the next query with an error', async () => {
    mocks.config.scope = 'book';
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.searchLibraryBooks.mockImplementation(async function* () {
      await pending;
      yield { type: 'book-error', error: 'late error' };
    });
    await renderBar();
    const signal = mocks.searchLibraryBooks.mock.calls[0]![3].signal as AbortSignal;
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new query' } });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(mocks.setSearchError).toHaveBeenLastCalledWith('book-1', null);
  });

  it('shows cancellation as a stopped search', () => {
    render(<SearchBar isVisible bookKey='book-1' onHideSearchBar={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop search' }));
    expect(screen.getByText('Search stopped')).toBeTruthy();
  });

  it('scopes the search to the current section once progress is available', async () => {
    mocks.progress = { section: { current: 4 } };
    await renderBar();

    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    expect(mocks.searchLibraryBooks.mock.calls[0]![3].sectionIndex).toBe(4);
  });
});
