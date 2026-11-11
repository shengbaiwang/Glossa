import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BookCover from '@/components/BookCover';
import type { Book } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';
import '@/styles/globals.css';
import '@/styles/glossa.css';

function artwork(fill: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 180;
  const context = canvas.getContext('2d')!;
  context.fillStyle = fill;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

const book: Book = {
  hash: 'cover-loading-regression',
  title: 'Synthetic Cover',
  author: 'Glossa',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  coverImageUrl: artwork('#819e88'),
};

function Gallery({ item = book }: { item?: Book }) {
  return (
    <div style={{ width: 160, height: 240 }}>
      <BookCover book={item} />
    </div>
  );
}

async function expectArtwork(container: HTMLElement) {
  await waitFor(() => {
    const image = container.querySelector<HTMLImageElement>('img.cover-image');
    expect(image).not.toBeNull();
    expect(image!.complete).toBe(true);
    expect(image!.naturalWidth).toBe(120);
    expect(getComputedStyle(image!).visibility).toBe('visible');
    expect(getComputedStyle(container.querySelector('.fallback-cover')!).visibility).toBe('hidden');
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('keeps loaded artwork when a sync receipt publishes rows without runtime URLs', async () => {
  useLibraryStore.setState({ library: [], libraryLoaded: false });
  useLibraryStore.getState().setLibrary([book], true);
  function Shelf() {
    const item = useLibraryStore((state) => state.library[0]!);
    return <Gallery item={item} />;
  }
  const { container } = render(<Shelf />);
  await expectArtwork(container);
  const image = container.querySelector('img')!;
  const { coverImageUrl: _url, ...persisted } = book;
  act(() => useLibraryStore.getState().setLibrary([{ ...persisted, progress: [2, 10] }]));
  fireEvent.blur(window);
  await expectArtwork(container);
  expect(container.querySelector('img')).toBe(image);
});

it('shows an already loaded cover even when an extra decode promise never settles', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(
    () => new Promise<void>(() => {}),
  );
  const { container } = render(<Gallery />);
  // No mouse or focus action: the browser's successful load is enough to show artwork.
  await expectArtwork(container);
});

it('keeps successful artwork mounted through pointer leave, blur and progress updates', async () => {
  const { container, rerender } = render(<Gallery />);
  await expectArtwork(container);
  const image = container.querySelector('img')!;
  const rewrittenSources: MutationRecord[] = [];
  const observer = new MutationObserver((records) => rewrittenSources.push(...records));
  observer.observe(image, { attributes: true, attributeFilter: ['src'] });
  // These DOM events exercise lifecycle handling; real native focus is a separate acceptance check.
  fireEvent.pointerLeave(container);
  fireEvent.mouseLeave(container);
  fireEvent.blur(window);
  rerender(<Gallery item={{ ...book, progress: [2, 10], updatedAt: 2 }} />);
  await expectArtwork(container);
  expect(container.querySelector('img')).toBe(image);
  rewrittenSources.push(...observer.takeRecords());
  observer.disconnect();
  expect(rewrittenSources).toHaveLength(0);
});

it('retains the successful artwork until its replacement has loaded', async () => {
  const { container, rerender } = render(<Gallery />);
  await expectArtwork(container);
  const image = container.querySelector('img')!;
  const replacement = artwork('#b78b58');
  rerender(<Gallery item={{ ...book, coverImageUrl: replacement, coverUpdatedAt: 2 }} />);
  expect(image.isConnected).toBe(true);
  expect(getComputedStyle(image).visibility).toBe('visible');
  const bounds = image.getBoundingClientRect();
  expect(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)).toBe(
    image,
  );
  await waitFor(() => {
    const current = container.querySelector<HTMLImageElement>('img[src="' + replacement + '"]');
    expect(current?.complete).toBe(true);
    expect(current?.naturalWidth).toBe(120);
    expect(getComputedStyle(current!).visibility).toBe('visible');
    expect(image.isConnected).toBe(false);
  });
  expect(container.querySelectorAll('img')).toHaveLength(1);
});

it('keeps a readable fallback for absent and invalid artwork', async () => {
  const { container, rerender } = render(<Gallery item={{ ...book, coverImageUrl: undefined }} />);
  expect(container.querySelector('img')).toBeNull();
  expect(getComputedStyle(container.querySelector('.fallback-cover')!).visibility).toBe('visible');
  rerender(<Gallery item={{ ...book, coverImageUrl: 'data:image/png;base64,AA==' }} />);
  await waitFor(() => expect(container.querySelector('img')).toBeNull());
  const fallback = container.querySelector('.fallback-cover')!;
  expect(getComputedStyle(fallback).visibility).toBe('visible');
  expect(fallback.textContent).toContain(book.title);
});
