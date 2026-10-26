import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import BookCover from '@/components/BookCover';
import { Book } from '@/types/book';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // biome-ignore lint/a11y/useAltText: test mock; alt comes from spread props
    return <img {...props} />;
  },
}));

afterEach(cleanup);

const makeBook = (overrides?: Partial<Book>): Book =>
  ({
    hash: 'abc123',
    title: 'Test Book',
    author: 'Test Author',
    format: 'epub',
    coverImageUrl: 'https://example.com/cover.jpg',
    ...overrides,
  }) as Book;

describe('BookCover', () => {
  it('shows a readable paper cover immediately when there is no image', () => {
    const { container } = render(
      <BookCover book={makeBook({ coverImageUrl: undefined })} showSpine />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(false);
    expect(container.querySelector('.fallback-cover')?.textContent).toContain('Test Book');
  });

  it('keeps the fallback visible until the image loads and restores it on failure', () => {
    const onImageError = vi.fn();
    const { container } = render(<BookCover book={makeBook()} onImageError={onImageError} />);
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(false);
    fireEvent.load(container.querySelector('img')!);
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(true);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(false);
    expect(onImageError).toHaveBeenCalledOnce();
  });

  it('does not reuse the loaded image state when the cover URL changes', () => {
    const book = makeBook();
    const { container, rerender } = render(<BookCover book={book} />);
    fireEvent.load(container.querySelector('img')!);
    rerender(
      <BookCover book={{ ...book, coverImageUrl: 'https://example.com/replacement.jpg' }} />,
    );
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(false);
    fireEvent.load(container.querySelector('img')!);
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(true);
  });

  it('updates the paper title and author after inline edits without a timestamp change', () => {
    const book = makeBook({ coverImageUrl: undefined });
    const { container, rerender } = render(<BookCover book={book} />);
    rerender(<BookCover book={{ ...book, title: 'New title', author: 'New author' }} />);
    expect(container.querySelector('.fallback-cover')?.textContent).toContain('New title');
    expect(container.querySelector('.fallback-cover')?.textContent).toContain('New author');
  });

  it('passes loading="lazy" to crop-mode Image', () => {
    const { container } = render(<BookCover book={makeBook()} coverFit='crop' />);
    const img = container.querySelector('img.cover-image');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('passes loading="lazy" to fit-mode Image', () => {
    const { container } = render(<BookCover book={makeBook()} coverFit='fit' />);
    const img = container.querySelector('img.cover-image');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it('reports natural aspect ratio via onAspectRatioChange when fit-mode image loads', () => {
    const onAspectRatioChange = vi.fn();
    const { container } = render(
      <BookCover book={makeBook()} coverFit='fit' onAspectRatioChange={onAspectRatioChange} />,
    );
    const img = container.querySelector('img.cover-image') as HTMLImageElement;
    expect(img).toBeTruthy();

    Object.defineProperty(img, 'naturalWidth', { value: 600, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    fireEvent.load(img);

    expect(onAspectRatioChange).toHaveBeenCalledWith(600 / 900);
  });

  it('falls back to metadata.author on the fallback cover when book.author is empty', () => {
    const book = makeBook({
      author: '',
      coverImageUrl: undefined,
      metadata: { author: 'Edited Author' } as Book['metadata'],
    });
    const { container } = render(<BookCover book={book} coverFit='crop' />);
    const fallback = container.querySelector('.fallback-cover');
    expect(fallback?.textContent).toContain('Edited Author');
  });
});
