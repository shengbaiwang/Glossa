import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';

const openBook = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/menu', () => ({ Menu: { new: vi.fn() } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasContextMenu: false, isMobileApp: false } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { localBooksDir: '/books' } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/app/library/hooks/useOpenBook', () => ({ useOpenBook: () => ({ openBook }) }));
vi.mock('@/app/library/components/BookItem', () => ({
  default: ({
    book,
    showBookDetailsModal,
  }: {
    book: Book;
    showBookDetailsModal: (book: Book) => void;
  }) => (
    <button
      type='button'
      aria-label='Show book details'
      onClick={(event) => {
        event.stopPropagation();
        showBookDetailsModal(book);
      }}
    >
      Details
    </button>
  ),
}));
vi.mock('@/app/library/components/GroupItem', () => ({ default: () => null }));

const BookshelfItem = (await import('@/app/library/components/BookshelfItem')).default;
const RecentShelf = (await import('@/app/library/components/RecentShelf')).default;

const book: Book = {
  hash: 'keyboard-book',
  format: 'EPUB',
  title: 'Keyboard Book',
  author: 'Test Author',
  createdAt: 1000,
  updatedAt: 2000,
  progress: [10, 100],
};

beforeEach(() => {
  vi.clearAllMocks();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderCard = (surface: 'grid' | 'list' | 'recent') => {
  const showDetails = vi.fn();
  const toggleSelection = vi.fn();
  const common = {
    coverFit: 'crop' as const,
    isSelectMode: false,
    toggleSelection,
    handleSetSelectMode: vi.fn(),
    handleBookUpload: vi.fn(async () => true),
    handleBookDownload: vi.fn(async () => true),
    showTimeRemaining: false,
  };
  if (surface === 'recent') {
    render(
      <RecentShelf
        {...common}
        books={[book]}
        selectedBooks={new Set()}
        onOpenBook={openBook}
        showBookDetailsModal={showDetails}
      />,
    );
  } else {
    render(
      <BookshelfItem
        {...common}
        mode={surface}
        item={book}
        itemSelected={false}
        transferProgress={null}
        setLoading={vi.fn()}
        handleGroupBooks={vi.fn()}
        handleBookDelete={vi.fn(async () => true)}
        handleShowDetailsBook={showDetails}
        handleLibraryNavigation={vi.fn()}
        handleUpdateReadingStatus={vi.fn()}
      />,
    );
  }
  return { showDetails, toggleSelection };
};

describe.each(['grid', 'list', 'recent'] as const)('%s book-card keyboard actions', (surface) => {
  it.each(['Enter', ' '])('keeps %j on a nested action from opening its book', (key) => {
    const { showDetails, toggleSelection } = renderCard(surface);
    const action = screen.getByRole('button', { name: 'Show book details' });
    action.focus();

    // Native buttons need the key's default action to remain enabled. jsdom
    // does not synthesize its click, so dispatch that separately afterwards.
    expect(fireEvent.keyDown(action, { key })).toBe(true);
    fireEvent.click(action);

    expect(showDetails).toHaveBeenCalledExactlyOnceWith(book);
    expect(openBook).not.toHaveBeenCalled();
    expect(toggleSelection).not.toHaveBeenCalled();
    expect(action.tabIndex).toBe(0);
  });

  it.each(['Enter', ' '])('opens the focused card itself with %j', (key) => {
    renderCard(surface);
    const card = screen.getByRole('button', { name: book.title });
    card.focus();

    fireEvent.keyDown(card, { key });

    expect(openBook).toHaveBeenCalledExactlyOnceWith(book);
    expect(card.tabIndex).toBe(0);
  });
});
