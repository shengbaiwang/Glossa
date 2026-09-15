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

vi.mock('dayjs', () => ({
  default: () => ({ fromNow: () => '2 hours ago', format: () => '2026-09-15 10:00' }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

const renderItem = (item: BookNote, chapterLabel?: string) =>
  render(
    <ul>
      <BookmarkItem bookKey='hash1-primary' item={item} chapterLabel={chapterLabel} />
    </ul>,
  );

const findRow = () => screen.getByRole('button', { name: /The visible page excerpt/ });
const findDelete = () => screen.getByRole('button', { name: 'Delete' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  mocks.state.config = { booknotes: [] };
  mocks.state.progress = { location: 'epubcfi(/6/8!/4,/1:0,/1:400)' };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BookmarkItem', () => {
  it('shows the chapter heading, a two-line excerpt and a compact page label', () => {
    renderItem(makeBookmark(), '版权页');
    const heading = screen.getByText('版权页');
    expect(heading.getAttribute('title')).toBe('版权页');
    expect(screen.getByText('The visible page excerpt.')).toBeTruthy();
    expect(screen.getByText('Page 12')).toBeTruthy();
  });

  it('keeps the creation time out of the row but reachable as the meta detail', () => {
    renderItem(makeBookmark(), '版权页');
    expect(screen.queryByText('2 hours ago')).toBeNull();
    expect(screen.getByTitle('2 hours ago · 2026-09-15 10:00')).toBeTruthy();
  });

  it('hides the page label when the record has no page', () => {
    renderItem(makeBookmark({ page: undefined }));
    expect(screen.queryByText(/Page/)).toBeNull();
    expect(screen.getByTitle('2 hours ago · 2026-09-15 10:00')).toBeTruthy();
  });

  it('marks the row with the shared bookmark row chassis and current state', () => {
    mocks.state.progress = { location: 'epubcfi(/6/4!/4,/1:0,/1:400)' };
    renderItem(makeBookmark({ cfi: 'epubcfi(/6/4!/4/1:10)' }));
    expect(findRow().className).toContain('glossa-reader-bookmark-item');
    expect(findRow().getAttribute('aria-current')).toBe('page');
  });

  it('offers a direct delete button without a menu, editor or copy action', () => {
    renderItem(makeBookmark(), '版权页');
    expect(findDelete()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByText('Copy')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('navigates from the row but not from the delete button', async () => {
    const item = makeBookmark();
    renderItem(item);

    fireEvent.click(screen.getByText('The visible page excerpt.'));
    expect(mocks.state.goTo).toHaveBeenCalledWith(item.cfi);
    expect(mocks.dispatch).toHaveBeenCalledWith('navigate', {
      bookKey: 'hash1-primary',
      cfi: item.cfi,
    });

    mocks.state.goTo.mockClear();
    mocks.dispatch.mockClear();
    fireEvent.click(findDelete());
    expect(mocks.state.goTo).not.toHaveBeenCalled();
  });

  it('navigates with Enter on the row itself, not with other keys', () => {
    const item = makeBookmark();
    renderItem(item);
    const row = findRow();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(mocks.state.goTo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    expect(mocks.state.goTo).toHaveBeenCalledTimes(1);
  });

  it('soft-deletes only its own record directly', async () => {
    const item = makeBookmark();
    const other = makeBookmark({ id: 'bm-2', cfi: 'epubcfi(/6/6!/4/1:10)' });
    mocks.state.config = { booknotes: [item, other] };
    renderItem(item);

    fireEvent.click(findDelete());
    expect(mocks.updateBooknotes).toHaveBeenCalledTimes(1);
    const saved = mocks.updateBooknotes.mock.calls[0]![1];
    expect(saved.find((n) => n.id === 'bm-1')!.deletedAt).toBeTruthy();
    expect(saved.find((n) => n.id === 'bm-2')).toEqual(other);
    expect(saved[0]!.cfi).toBe(item.cfi);
    expect(saved[0]!.text).toBe(item.text);
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    expect(mocks.state.goTo).not.toHaveBeenCalled();
  });
});
