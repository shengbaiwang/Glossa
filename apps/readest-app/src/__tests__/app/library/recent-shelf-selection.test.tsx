import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Book } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/app/library/components/BookItem', () => ({
  default: ({ book, bookSelected }: { book: Book; bookSelected: boolean }) => (
    <div data-testid={`book-item-${book.hash}`} data-selected={bookSelected} />
  ),
}));
vi.mock('@/app/library/hooks/useOpenBook', () => ({ useOpenBook: () => ({ openBook: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
import RecentShelf from '@/app/library/components/RecentShelf';

const createBook = (hash: string): Book => ({
  hash,
  format: 'EPUB',
  title: `Book ${hash}`,
  author: 'Test Author',
  createdAt: 1000,
  updatedAt: 2000,
  progress: [1, 100],
});
const books = [createBook('aaa'), createBook('bbb')];
const noop = () => {};
const baseProps = {
  books,
  coverFit: 'crop' as const,
  handleBookUpload: noop,
  handleBookDownload: noop,
  showBookDetailsModal: noop,
  showTimeRemaining: false,
  selectedBooks: new Set<string>(),
};
const tapSlide = (title: string) => {
  const slide = screen.getByRole('button', { name: title });
  fireEvent.pointerDown(slide, { pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
  fireEvent.pointerUp(slide, { pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
};
beforeEach(() => useLibraryStore.getState().setSelectedBooks([]));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(selected: string[] = []) {
  useLibraryStore.getState().setSelectedBooks(selected);
  const onOpenBook = vi.fn();
  const selectItem = vi.fn();
  render(
    <RecentShelf
      {...baseProps}
      selectedBooks={new Set(selected)}
      onOpenBook={onOpenBook}
      selectItem={selectItem}
    />,
  );
  return { onOpenBook, selectItem };
}

describe('RecentShelf direct selection', () => {
  it('selects on desktop click, opens on double click, and uses the recent row order for ranges', () => {
    const { onOpenBook, selectItem } = setup();
    const slide = screen.getByRole('button', { name: 'Book aaa' });
    fireEvent.click(slide);
    expect(selectItem).toHaveBeenLastCalledWith('aaa', {
      toggle: false,
      range: false,
      order: ['aaa', 'bbb'],
    });
    expect(onOpenBook).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Book bbb' }), { shiftKey: true });
    expect(selectItem).toHaveBeenLastCalledWith('bbb', {
      toggle: false,
      range: true,
      order: ['aaa', 'bbb'],
    });
    fireEvent.doubleClick(slide);
    expect(onOpenBook).toHaveBeenCalledExactlyOnceWith(books[0]);
  });
  it('touch opens directly until a selection exists, then adds or removes items', () => {
    const { onOpenBook, selectItem } = setup(['bbb']);
    tapSlide('Book aaa');
    expect(selectItem).toHaveBeenCalledWith('aaa', { toggle: true, order: ['aaa', 'bbb'] });
    expect(onOpenBook).not.toHaveBeenCalled();
  });
  it('touch opens the book when nothing is selected', () => {
    const { onOpenBook, selectItem } = setup();
    tapSlide('Book aaa');
    expect(onOpenBook).toHaveBeenCalledExactlyOnceWith(books[0]);
    expect(selectItem).not.toHaveBeenCalled();
  });
  it('touch long press selects without opening or requiring a mode', () => {
    vi.useFakeTimers();
    const { onOpenBook, selectItem } = setup();
    const slide = screen.getByRole('button', { name: 'Book aaa' });
    fireEvent.pointerDown(slide, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(600);
    fireEvent.pointerUp(slide, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    expect(selectItem).toHaveBeenCalledExactlyOnceWith('aaa', {
      toggle: true,
      preserve: true,
      order: ['aaa', 'bbb'],
    });
    expect(onOpenBook).not.toHaveBeenCalled();
  });
  it('Space selects while Enter opens, with the selected outline shared across surfaces', () => {
    const { onOpenBook, selectItem } = setup(['bbb']);
    const slide = screen.getByRole('button', { name: 'Book bbb' });
    fireEvent.keyDown(slide, { key: ' ' });
    expect(selectItem).toHaveBeenCalledWith('bbb', {
      toggle: false,
      range: false,
      order: ['aaa', 'bbb'],
    });
    fireEvent.keyDown(slide, { key: 'Enter' });
    expect(onOpenBook).toHaveBeenCalledExactlyOnceWith(books[1]);
    expect(slide.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('book-item-bbb').dataset['selected']).toBe('true');
  });
});
