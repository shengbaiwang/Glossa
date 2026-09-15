import { render, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { BookNote } from '@/types/book';

// ---------- Shared mutable test state (captured by the mock factories) ----------
let scrollToIndexSpy: Mock<(arg: unknown) => void>;
let capturedInitialized:
  | ((instance: { elements: () => { viewport: HTMLElement } }) => void)
  | undefined;
let capturedVirtuosoProps: Record<string, unknown> | undefined;
let mockProgress: { location: string } | null;
let mockBooknotes: BookNote[];
let dispatchSpy: Mock;

// ---------- Mocks ----------
vi.mock('@/store/bookDataStore', () => {
  const state = {
    booksData: {
      book1: {
        get config() {
          return { booknotes: mockBooknotes };
        },
      },
    },
  };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => mockProgress,
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    setActiveBooknoteType: vi.fn(),
    setBooknoteResults: vi.fn(),
  }),
}));

// Derive a per-chapter TOC group from the spine step of each bookmark's CFI so
// the flattened list is [header, note, header, note, ...] sorted by chapter.
vi.mock('@/services/nav', () => ({
  findTocItemBS: (_toc: unknown, cfi: string) => {
    const match = cfi.match(/\/6\/(\d+)!/);
    const n = match ? Number(match[1]) : 0;
    return { id: n, href: `ch${n}.html`, label: `Chapter ${n}`, index: n };
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (...args: unknown[]) => dispatchSpy(...args),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('@/app/reader/components/sidebar/BookmarkItem', () => ({
  default: () => null,
}));

vi.mock('@/app/reader/components/EmptyState', () => ({
  default: ({ label, action }: { label: string; action?: React.ReactNode }) => (
    <div>
      <p>{label}</p>
      {action}
    </div>
  ),
}));

// Virtuoso is replaced with a stub that exposes a spy-able `scrollToIndex`
// through the imperative handle and hands BookmarkView a scroller element.
vi.mock('react-virtuoso', async () => {
  const ReactMod = await import('react');
  return {
    Virtuoso: ReactMod.forwardRef(
      (
        props: { scrollerRef?: (el: HTMLElement | Window | null) => void },
        ref: React.Ref<unknown>,
      ) => {
        capturedVirtuosoProps = props as Record<string, unknown>;
        ReactMod.useImperativeHandle(ref, () => ({
          scrollToIndex: (arg: unknown) => scrollToIndexSpy(arg),
        }));
        ReactMod.useEffect(() => {
          props.scrollerRef?.(document.createElement('div'));
        }, []);
        return null;
      },
    ),
  };
});

// Capture the OverlayScrollbars `initialized` callback so the test can fire it
// on demand (the real hook fires it after a deferred, timing-dependent init).
vi.mock('overlayscrollbars-react', () => ({
  useOverlayScrollbars: (opts: {
    events?: { initialized?: (i: { elements: () => { viewport: HTMLElement } }) => void };
  }) => {
    if (!capturedInitialized) capturedInitialized = opts.events?.initialized;
    return [vi.fn(), () => undefined];
  },
}));

// eslint-disable-next-line import/first
import BookmarkView from '@/app/reader/components/sidebar/BookmarkView';

const makeBookmark = (cfi: string): BookNote =>
  ({
    id: cfi,
    type: 'bookmark',
    cfi,
    text: `excerpt at ${cfi}`,
    note: '',
    createdAt: 0,
    updatedAt: 0,
  }) as BookNote;

const makeAnnotation = (cfi: string): BookNote =>
  ({
    id: `a-${cfi}`,
    type: 'annotation',
    cfi,
    text: 'highlighted words',
    note: '',
    style: 'highlight',
    color: 'yellow',
    createdAt: 0,
    updatedAt: 0,
  }) as BookNote;

const fireOverlayScrollbarsInitialized = () => {
  act(() => {
    capturedInitialized?.({ elements: () => ({ viewport: document.createElement('div') }) });
  });
};

beforeEach(() => {
  scrollToIndexSpy = vi.fn<(arg: unknown) => void>();
  capturedInitialized = undefined;
  capturedVirtuosoProps = undefined;
  dispatchSpy = vi.fn();
  mockProgress = null;
  mockBooknotes = [
    makeBookmark('epubcfi(/6/4!/4/2:0)'),
    makeBookmark('epubcfi(/6/6!/4/4:0)'),
    makeBookmark('epubcfi(/6/8!/4/2:0)'),
    makeBookmark('epubcfi(/6/10!/4/6:0)'),
    makeBookmark('epubcfi(/6/26!/4/2:0)'),
  ];
  // Run rAF synchronously so the callback's scroll happens inside act().
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BookmarkView', () => {
  it('lists only bookmarks — annotations and excerpts stay in the right panel', () => {
    mockBooknotes = [
      makeBookmark('epubcfi(/6/4!/4/2:0)'),
      makeAnnotation('epubcfi(/6/4!/4/5:0)'),
      makeBookmark('epubcfi(/6/6!/4/2:0)'),
    ];
    render(<BookmarkView bookKey='book1' toc={[]} />);
    expect(capturedVirtuosoProps?.['totalCount']).toBe(2);
  });

  it('hides soft-deleted bookmarks', () => {
    mockBooknotes = [
      { ...makeBookmark('epubcfi(/6/4!/4/2:0)'), deletedAt: 123 },
      makeBookmark('epubcfi(/6/6!/4/2:0)'),
    ];
    render(<BookmarkView bookKey='book1' toc={[]} />);
    expect(capturedVirtuosoProps?.['totalCount']).toBe(1);
  });

  it('shows a quiet empty state without a duplicate add-bookmark action', () => {
    mockBooknotes = [];
    const { getByText, queryByRole } = render(<BookmarkView bookKey='book1' toc={[]} />);
    expect(getByText('No Bookmarks')).toBeTruthy();
    expect(capturedVirtuosoProps).toBeUndefined();
    expect(queryByRole('button')).toBeNull();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('re-applies the auto-scroll to the nearest bookmark when OverlayScrollbars initializes after the reading position arrives', () => {
    mockProgress = null;
    const { rerender } = render(<BookmarkView bookKey='book1' toc={[]} />);

    mockProgress = { location: 'epubcfi(/6/26!/4/10:0)' };
    act(() => {
      rerender(<BookmarkView bookKey='book1' toc={[]} />);
    });
    scrollToIndexSpy.mockClear();

    fireOverlayScrollbarsInitialized();

    // Flat list of 5 bookmarks in reading order; the nearest is index 4.
    expect(scrollToIndexSpy).toHaveBeenCalledWith(expect.objectContaining({ index: 4 }));
  });

  it('does not force a scroll on OverlayScrollbars init when there is no reading position', () => {
    mockProgress = null;
    render(<BookmarkView bookKey='book1' toc={[]} />);

    scrollToIndexSpy.mockClear();
    fireOverlayScrollbarsInitialized();

    expect(scrollToIndexSpy).not.toHaveBeenCalled();
  });

  it('positions Virtuoso natively on mount when the reading position is already known', () => {
    mockProgress = { location: 'epubcfi(/6/26!/4/10:0)' };
    act(() => {
      render(<BookmarkView bookKey='book1' toc={[]} />);
    });

    expect(capturedVirtuosoProps?.['initialTopMostItemIndex']).toEqual({
      index: 4,
      align: 'center',
    });
    expect(scrollToIndexSpy).not.toHaveBeenCalled();

    fireOverlayScrollbarsInitialized();
    expect(scrollToIndexSpy).toHaveBeenCalledWith(expect.objectContaining({ index: 4 }));
  });

  it('jumps instantly (behavior auto) for a far scroll instead of animating it', () => {
    mockBooknotes = Array.from({ length: 30 }, (_, i) =>
      makeBookmark(`epubcfi(/6/${4 + i * 2}!/4/2:0)`),
    );

    mockProgress = null;
    const { rerender } = render(<BookmarkView bookKey='book1' toc={[]} />);

    // The reading position is past the last bookmark, so the nearest sits at
    // index 29 — far from the top of the list.
    mockProgress = { location: 'epubcfi(/6/70!/4/10:0)' };
    act(() => {
      rerender(<BookmarkView bookKey='book1' toc={[]} />);
    });

    expect(scrollToIndexSpy).toHaveBeenCalledWith(
      expect.objectContaining({ index: 29, behavior: 'auto' }),
    );
    expect(scrollToIndexSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    );
  });
});
