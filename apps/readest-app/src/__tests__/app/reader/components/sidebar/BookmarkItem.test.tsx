import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BookmarkItem from '@/app/reader/components/sidebar/BookmarkItem';
import { BookNote } from '@/types/book';

const mocks = vi.hoisted(() => ({
  state: {
    config: { booknotes: [] as BookNote[] },
    progress: null as null | { location: string },
    goTo: vi.fn(),
  },
  dispatch: vi.fn(),
  updateBooknotes: vi.fn((_key: string, notes: BookNote[]) => ({ booknotes: notes })),
  saveConfig: vi.fn(),
}));

vi.mock('@/store/bookDataStore', () => {
  const state = {
    getConfig: () => mocks.state.config,
    saveConfig: mocks.saveConfig,
    updateBooknotes: mocks.updateBooknotes,
    booksData: { hash1: { config: mocks.state.config } },
  };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/readerStore', () => {
  const state = {
    getView: () => ({ goTo: mocks.state.goTo }),
    getViewsById: () => [],
    getViewSettings: () => undefined,
  };
  return {
    useReaderStore: <R,>(selector?: (s: typeof state) => R) => (selector ? selector(state) : state),
  };
});

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => mocks.state.progress,
}));

vi.mock('@/store/settingsStore', () => {
  const state = { settings: { globalReadSettings: { customHighlightColors: {} } } };
  return {
    useSettingsStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { appService: {} } }),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: mocks.dispatch, on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, unknown>) =>
    params && 'number' in params ? key.replace('{{number}}', String(params['number'])) : key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

vi.mock('dayjs', () => ({ default: () => ({ fromNow: () => '2 hours ago' }) }));

const makeBookmark = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'bm-1',
  type: 'bookmark',
  cfi: 'epubcfi(/6/4!/4/1:10)',
  text: 'The visible page excerpt.',
  note: '',
  page: 12,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const renderItem = (item: BookNote) =>
  render(
    <ul>
      <BookmarkItem bookKey='hash1-primary' item={item} />
    </ul>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.config = { booknotes: [] };
  mocks.state.progress = { location: 'epubcfi(/6/8!/4,/1:0,/1:400)' };
  mocks.updateBooknotes.mockImplementation(() => ({ booknotes: mocks.state.config.booknotes }));
});

afterEach(() => {
  cleanup();
});

describe('BookmarkItem', () => {
  it('shows the excerpt, the page label and a relative date', () => {
    renderItem(makeBookmark());
    expect(screen.getByText('The visible page excerpt.')).toBeTruthy();
    expect(screen.getByText('Page: 12')).toBeTruthy();
    expect(screen.getByText('2 hours ago')).toBeTruthy();
  });

  it('hides the page label when the record has no page', () => {
    renderItem(makeBookmark({ page: undefined }));
    expect(screen.queryByText(/Page:/)).toBeNull();
    expect(screen.getByText('2 hours ago')).toBeTruthy();
  });

  it('navigates to the bookmarked position on click', () => {
    const item = makeBookmark();
    renderItem(item);
    fireEvent.click(screen.getByText('The visible page excerpt.'));

    expect(mocks.dispatch).toHaveBeenCalledWith('navigate', {
      bookKey: 'hash1-primary',
      cfi: item.cfi,
    });
    expect(mocks.state.goTo).toHaveBeenCalledWith(item.cfi);
  });

  it('navigates with Enter, not with other keys', () => {
    const item = makeBookmark();
    renderItem(item);
    const row = screen.getByRole('button', { name: /The visible page excerpt/ });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(mocks.state.goTo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    expect(mocks.state.goTo).toHaveBeenCalledTimes(1);
  });

  it('marks the row as current while the reader sits on its page', () => {
    mocks.state.progress = { location: 'epubcfi(/6/4!/4,/1:0,/1:400)' };
    const { unmount } = renderItem(makeBookmark({ cfi: 'epubcfi(/6/4!/4/1:10)' }));
    const row = screen.getByRole('button', { name: /The visible page excerpt/ });
    expect(row.getAttribute('aria-current')).toBe('page');
    unmount();

    mocks.state.progress = { location: 'epubcfi(/6/20!/4,/1:0,/1:400)' };
    renderItem(makeBookmark({ cfi: 'epubcfi(/6/4!/4/1:10)' }));
    const rowAfter = screen.getByRole('button', { name: /The visible page excerpt/ });
    expect(rowAfter.getAttribute('aria-current')).toBeNull();
  });

  it('renames the excerpt inline without touching the anchor', () => {
    const item = makeBookmark();
    mocks.state.config = { booknotes: [item] };
    renderItem(item);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(editor.value).toBe('The visible page excerpt.');
    fireEvent.change(editor, { target: { value: 'Renamed excerpt' } });
    fireEvent.click(screen.getByText('Save'));

    expect(mocks.updateBooknotes).toHaveBeenCalledTimes(1);
    const saved = mocks.updateBooknotes.mock.calls[0]![1];
    expect(saved[0]!.text).toBe('Renamed excerpt');
    expect(saved[0]!.cfi).toBe(item.cfi);
    expect(saved[0]!.updatedAt).toBeGreaterThan(1000);
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty rename and keeps the editor open', () => {
    const item = makeBookmark();
    mocks.state.config = { booknotes: [item] };
    renderItem(item);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save'));

    expect(mocks.updateBooknotes).not.toHaveBeenCalled();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('cancels an inline rename without persisting', () => {
    const item = makeBookmark();
    mocks.state.config = { booknotes: [item] };
    renderItem(item);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByText('Cancel'));
    expect(mocks.updateBooknotes).not.toHaveBeenCalled();
    expect(screen.getByText('The visible page excerpt.')).toBeTruthy();
  });

  it('soft-deletes only its own record', () => {
    const item = makeBookmark();
    const other = makeBookmark({ id: 'bm-2', cfi: 'epubcfi(/6/6!/4/1:10)' });
    mocks.state.config = { booknotes: [item, other] };
    renderItem(item);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mocks.updateBooknotes).toHaveBeenCalledTimes(1);
    const saved = mocks.updateBooknotes.mock.calls[0]![1];
    expect(saved.find((n) => n.id === 'bm-1')!.deletedAt).toBeTruthy();
    expect(saved.find((n) => n.id === 'bm-2')!.deletedAt).toBeFalsy();
  });
});
