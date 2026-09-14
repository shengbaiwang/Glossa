import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BookmarkToggler from '@/app/reader/components/BookmarkToggler';
import { BookNote } from '@/types/book';

const mocks = vi.hoisted(() => ({
  state: {
    config: { booknotes: [] as BookNote[] },
    progress: null as null | {
      location: string;
      range?: Range | null;
      page?: number;
      pageinfo?: { current: number; total: number };
    },
    settings: {} as Record<string, unknown>,
    isPrimary: true,
  },
  updateBooknotes: vi.fn((_key: string, notes: BookNote[]) => ({ booknotes: notes })),
  saveConfig: vi.fn(),
  setBookmarkRibbonVisibility: vi.fn(),
  handlers: {} as Record<string, (e: CustomEvent) => void>,
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (s: unknown) => unknown) =>
    selector({
      getConfig: () => mocks.state.config,
      saveConfig: mocks.saveConfig,
      updateBooknotes: mocks.updateBooknotes,
      booksData: { hash1: { config: mocks.state.config } },
    }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (s: unknown) => unknown) =>
    selector({
      setBookmarkRibbonVisibility: mocks.setBookmarkRibbonVisibility,
      viewStates: {
        get 'hash1-primary'() {
          return { isPrimary: mocks.state.isPrimary };
        },
      },
    }),
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => mocks.state.progress,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ settings: mocks.state.settings }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { appService: {} } }),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    on: (event: string, cb: (e: CustomEvent) => void) => {
      mocks.handlers[event] = cb;
    },
    off: (event: string) => {
      delete mocks.handlers[event];
    },
    dispatch: vi.fn(),
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

const LOCATION = 'epubcfi(/6/4!/4,/1:0,/1:400)';

const makeRange = (text: string): Range => {
  const host = document.createElement('div');
  host.innerHTML = `<p>${text}</p>`;
  document.body.appendChild(host);
  const range = document.createRange();
  range.selectNodeContents(host.querySelector('p')!);
  return range;
};

const makeBookmark = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: 'bm-1',
  type: 'bookmark',
  cfi: 'epubcfi(/6/4!/4/1:10)',
  text: 'saved excerpt',
  note: '',
  page: 7,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

const renderToggler = () => render(<BookmarkToggler bookKey='hash1-primary' />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.config = { booknotes: [] };
  mocks.state.progress = {
    location: LOCATION,
    range: makeRange('Visible page text.'),
    page: 7,
  };
  mocks.state.settings = {};
  mocks.state.isPrimary = true;
  mocks.updateBooknotes.mockImplementation(() => ({ booknotes: mocks.state.config.booknotes }));
  document.body.innerHTML = '';
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('BookmarkToggler', () => {
  it('saves an excerpt taken from the visible range, not the start node', () => {
    mocks.state.progress!.range = makeRange('Visible page text.');
    renderToggler();
    fireEvent.click(screen.getByRole('button', { name: 'Add Bookmark' }));

    expect(mocks.updateBooknotes).toHaveBeenCalledTimes(1);
    const saved = mocks.updateBooknotes.mock.calls[0]![1] as BookNote[];
    const added = saved.filter((n) => n.type === 'bookmark' && !n.deletedAt);
    expect(added).toHaveLength(1);
    expect(added[0]!.cfi).toBe(LOCATION);
    expect(added[0]!.text).toBe('Visible page text.');
    expect(added[0]!.page).toBe(7);
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
  });

  it('respects range offsets instead of the whole start container', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p>First paragraph text.</p><p>Second paragraph continues here.</p>';
    document.body.appendChild(host);
    const [first, second] = Array.from(host.querySelectorAll('p')).map((p) => p.firstChild);
    const range = document.createRange();
    range.setStart(first!, 6);
    range.setEnd(second!, 6);
    mocks.state.progress!.range = range;

    renderToggler();
    fireEvent.click(screen.getByRole('button', { name: 'Add Bookmark' }));

    const saved = mocks.updateBooknotes.mock.calls[0]![1] as BookNote[];
    const added = saved.find((n) => n.type === 'bookmark' && !n.deletedAt)!;
    expect(added.text).toBe('paragraph text.Second');
    expect(added.text!.startsWith('First paragraph')).toBe(false);
  });

  it('falls back to the current page number when the range has no text', () => {
    mocks.state.progress!.range = makeRange('');
    renderToggler();
    fireEvent.click(screen.getByRole('button', { name: 'Add Bookmark' }));

    const saved = mocks.updateBooknotes.mock.calls[0]![1] as BookNote[];
    const added = saved.find((n) => n.type === 'bookmark' && !n.deletedAt)!;
    expect(added.text).toBe('7');
  });

  it('does nothing without a reading location', () => {
    mocks.state.progress = null;
    renderToggler();
    fireEvent.click(screen.getByRole('button', { name: 'Add Bookmark' }));
    expect(mocks.updateBooknotes).not.toHaveBeenCalled();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it('removes the bookmark at the current page instead of adding a duplicate', () => {
    mocks.state.config = {
      booknotes: [makeBookmark({ cfi: 'epubcfi(/6/4!/4/1:10)', page: 7 })],
    };
    renderToggler();
    expect(screen.getByRole('button', { name: 'Remove Bookmark' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Bookmark' }));
    expect(mocks.updateBooknotes).toHaveBeenCalledTimes(1);
    const saved = mocks.updateBooknotes.mock.calls[0]![1] as BookNote[];
    expect(saved).toHaveLength(1);
    expect(saved[0]!.deletedAt).toBeTruthy();
    expect(saved[0]!.id).toBe('bm-1');
  });

  it('removes every bookmark inside the current page, including legacy duplicates', () => {
    mocks.state.config = {
      booknotes: [
        makeBookmark({ id: 'bm-1', cfi: 'epubcfi(/6/4!/4/1:10)', page: 7 }),
        makeBookmark({ id: 'bm-2', cfi: 'epubcfi(/6/4!/4/1:60)', page: 7 }),
        makeBookmark({ id: 'bm-3', cfi: 'epubcfi(/6/6!/4/1:10)', page: 9 }),
      ],
    };
    renderToggler();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bookmark' }));

    const saved = mocks.updateBooknotes.mock.calls[0]![1] as BookNote[];
    const deleted = saved.filter((n) => n.deletedAt).map((n) => n.id);
    expect(deleted.sort()).toEqual(['bm-1', 'bm-2']);
    expect(saved.find((n) => n.id === 'bm-3')!.deletedAt).toBeFalsy();
  });

  it('soft-deletes through a new record so sync sees the tombstone', () => {
    mocks.state.config = { booknotes: [makeBookmark()] };
    renderToggler();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bookmark' }));

    const saved = mocks.updateBooknotes.mock.calls[0]![1] as BookNote[];
    expect(saved[0]).not.toBe(mocks.state.config.booknotes[0]);
    expect(saved[0]!.updatedAt).toBeGreaterThanOrEqual(1000);
  });

  it('matches the same page after reflow, where the exact CFI differs', () => {
    // The bookmark was saved with the CFI of an older layout. The page now
    // shows a different visible range, but the bookmark's start still falls
    // inside it, so toggling must remove — not duplicate.
    mocks.state.config = { booknotes: [makeBookmark({ cfi: 'epubcfi(/6/4!/4/1:10)' })] };
    mocks.state.progress!.location = 'epubcfi(/6/4!/4,/1:0,/1:160)';
    renderToggler();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bookmark' }));

    const saved = mocks.updateBooknotes.mock.calls[0]![1] as BookNote[];
    expect(saved[0]!.deletedAt).toBeTruthy();
  });

  it('keeps bookmarks outside the current page untouched when adding', () => {
    mocks.state.config = {
      booknotes: [makeBookmark({ id: 'far', cfi: 'epubcfi(/6/6!/4/1:10)' })],
    };
    renderToggler();
    fireEvent.click(screen.getByRole('button', { name: 'Add Bookmark' }));

    const saved = mocks.updateBooknotes.mock.calls[0]![1] as BookNote[];
    expect(saved.find((n) => n.id === 'far')!.deletedAt).toBeFalsy();
    expect(saved.filter((n) => n.type === 'bookmark')).toHaveLength(2);
  });

  it('responds to toggle-bookmark events for its own book with fresh state', () => {
    const { rerender } = renderToggler();

    // The page turned after mount; the event must bookmark the *new* position,
    // not the one captured at mount (the stale-closure bug).
    const newLocation = 'epubcfi(/6/8!/4,/1:0,/1:400)';
    mocks.state.progress = { location: newLocation, range: makeRange('Turned page.'), page: 8 };
    rerender(<BookmarkToggler bookKey='hash1-primary' />);

    mocks.handlers['toggle-bookmark']!({ detail: { bookKey: 'hash1-primary' } } as CustomEvent);
    const lastCall = mocks.updateBooknotes.mock.calls.at(-1)!;
    const saved = lastCall[1];
    const added = saved.filter((n) => n.type === 'bookmark' && !n.deletedAt);
    expect(added).toHaveLength(1);
    expect(added[0]!.cfi).toBe(newLocation);
    expect(added[0]!.text).toBe('Turned page.');
  });

  it('ignores toggle-bookmark events for other books', () => {
    renderToggler();
    mocks.handlers['toggle-bookmark']!({ detail: { bookKey: 'other-primary' } } as CustomEvent);
    expect(mocks.updateBooknotes).not.toHaveBeenCalled();
  });

  it('drives the bookmark ribbon from the real bookmarks, not a lagging flag', () => {
    mocks.state.config = { booknotes: [makeBookmark()] };
    const { rerender } = renderToggler();
    expect(mocks.setBookmarkRibbonVisibility).toHaveBeenLastCalledWith('hash1-primary', true);

    mocks.state.config = { booknotes: [] };
    rerender(<BookmarkToggler bookKey='hash1-primary' />);
    expect(mocks.setBookmarkRibbonVisibility).toHaveBeenLastCalledWith('hash1-primary', false);
  });

  it('refreshes a stale stored page number for a bookmark in view on the primary view', () => {
    mocks.state.config = {
      booknotes: [makeBookmark({ cfi: 'epubcfi(/6/4!/4/1:10)', page: 3 })],
    };
    renderToggler();
    expect(mocks.updateBooknotes).toHaveBeenCalledTimes(1);
    const saved = mocks.updateBooknotes.mock.calls[0]![1] as BookNote[];
    expect(saved.find((n) => n.id === 'bm-1')!.page).toBe(7);
    expect(saved.find((n) => n.id === 'bm-1')!.deletedAt).toBeFalsy();
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite page numbers from a secondary view', () => {
    mocks.state.isPrimary = false;
    mocks.state.config = {
      booknotes: [makeBookmark({ cfi: 'epubcfi(/6/4!/4/1:10)', page: 3 })],
    };
    renderToggler();
    expect(mocks.updateBooknotes).not.toHaveBeenCalled();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it('does not loop rewriting when the stored page already matches', () => {
    mocks.state.config = { booknotes: [makeBookmark({ page: 7 })] };
    renderToggler();
    expect(mocks.updateBooknotes).not.toHaveBeenCalled();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it('keeps aria-pressed in sync with the bookmark state', () => {
    mocks.state.config = { booknotes: [makeBookmark()] };
    const { rerender } = render(<BookmarkToggler bookKey='hash1-primary' />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');

    mocks.state.config = { booknotes: [] };
    rerender(<BookmarkToggler bookKey='hash1-primary' />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
  });
});
