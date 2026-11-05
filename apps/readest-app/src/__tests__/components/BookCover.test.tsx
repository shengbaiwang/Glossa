import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

import BookCover from '@/components/BookCover';
import { Book } from '@/types/book';

vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // biome-ignore lint/a11y/useAltText: test mock; alt comes from spread props
    return <img {...props} />;
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function load(image: HTMLImageElement) {
  Object.defineProperties(image, {
    naturalWidth: { value: 600, configurable: true },
    naturalHeight: { value: 900, configurable: true },
  });
  fireEvent.load(image);
}

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
    const { container } = render(<BookCover book={makeBook({ coverImageUrl: undefined })} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.book-spine')).toBeNull();
    expect(container.querySelector('[data-material]')).toBeNull();
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(false);
    expect(container.querySelector('.fallback-cover')?.textContent).toContain('Test Book');
  });

  it('keeps the fallback visible until the image loads and restores it on failure', () => {
    const onImageError = vi.fn();
    const { container } = render(<BookCover book={makeBook()} onImageError={onImageError} />);
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(false);
    load(container.querySelector('img')!);
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(true);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(false);
    expect(onImageError).toHaveBeenCalledOnce();
  });

  it('keeps the last successful image while a replacement loads', () => {
    const book = makeBook();
    const { container, rerender } = render(<BookCover book={book} />);
    const original = container.querySelector('img')!;
    load(original);
    rerender(
      <BookCover book={{ ...book, coverImageUrl: 'https://example.com/replacement.jpg' }} />,
    );
    expect(container.querySelector('img[aria-hidden="false"]')).toBe(original);
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(true);
    load(container.querySelector('img[aria-hidden="true"]')!);
    expect(container.querySelector('.fallback-cover')?.classList.contains('invisible')).toBe(true);
  });

  it('updates the paper title and author after inline edits without a timestamp change', () => {
    const book = makeBook({ coverImageUrl: undefined });
    const { container, rerender } = render(<BookCover book={book} />);
    rerender(<BookCover book={{ ...book, title: 'New title', author: 'New author' }} />);
    expect(container.querySelector('.fallback-cover')?.textContent).toContain('New title');
    expect(container.querySelector('.fallback-cover')?.textContent).toContain('New author');
  });

  it('retries a temporary failure once, then recovers on focus without looping', () => {
    vi.useFakeTimers();
    const { container } = render(<BookCover book={makeBook()} />);
    const first = container.querySelector('img')!;
    fireEvent.error(first);
    act(() => vi.advanceTimersByTime(1000));
    const retry = container.querySelector('img')!;
    expect(retry).not.toBeNull();
    expect(retry).not.toBe(first);
    fireEvent.error(retry);
    act(() => vi.advanceTimersByTime(60_000));
    expect(container.querySelector('img')).toBeNull();
    act(() => window.dispatchEvent(new Event('focus')));
    load(container.querySelector('img')!);
    expect(container.querySelector('.fallback-cover')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('reloads the same path on a new cover version but not on reading progress', () => {
    const book = makeBook({
      coverImageUrl: 'asset://localhost/book/cover.png',
      coverHash: 'old',
      coverUpdatedAt: 1,
    });
    const { container, rerender } = render(<BookCover book={book} />);
    const first = container.querySelector('img')!;
    load(first);
    rerender(<BookCover book={{ ...book, progress: [1, 10], updatedAt: 2 }} />);
    expect(container.querySelector('img')).toBe(first);
    rerender(<BookCover book={{ ...book, coverHash: 'new', coverUpdatedAt: 3 }} />);
    const replacement = container.querySelector('img.cover-image[aria-hidden="true"]')!;
    expect(replacement).not.toBeNull();
    expect(replacement.getAttribute('src')).not.toBe(first.getAttribute('src'));
    expect(container.querySelector('img[aria-hidden="false"]')).not.toBeNull();
    load(replacement as HTMLImageElement);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')!.getAttribute('aria-hidden')).toBe('false');
    rerender(<BookCover book={{ ...book, coverImageUrl: undefined, coverUpdatedAt: 4 }} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('does not mark a zero-size image as loaded', () => {
    const { container } = render(<BookCover book={makeBook()} />);
    fireEvent.load(container.querySelector('img')!);
    expect(container.querySelector('.fallback-cover')?.getAttribute('aria-hidden')).toBe('false');
  });

  it('clears the successful image after removal before the same source is added again', () => {
    const book = makeBook();
    const { container, rerender } = render(<BookCover book={book} />);
    load(container.querySelector('img')!);
    rerender(<BookCover book={{ ...book, coverImageUrl: undefined }} />);
    rerender(<BookCover book={book} />);
    expect(container.querySelector('.fallback-cover')?.getAttribute('aria-hidden')).toBe('false');
    load(container.querySelector('img')!);
    expect(container.querySelector('.fallback-cover')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('preserves remote signed image queries across version changes and retries', () => {
    vi.useFakeTimers();
    const url = 'https://example.com/cover.jpg?signature=example%2Fsignature&expires=1';
    const { container } = render(
      <BookCover book={makeBook({ coverImageUrl: url, coverHash: 'new' })} />,
    );
    expect(container.querySelector('img')!.getAttribute('src')).toBe(url);
    fireEvent.error(container.querySelector('img')!);
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector('img')!.getAttribute('src')).toBe(url);
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
