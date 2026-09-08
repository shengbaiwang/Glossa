import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSpatialNavigation } from '@/app/library/hooks/useSpatialNavigation';

const LibraryNavigation = () => {
  const ref = useRef<HTMLDivElement>(null);
  useSpatialNavigation(ref);

  const card = (title: string, top: number) => (
    <div role='button' tabIndex={0} aria-label={title} data-layout-top={top} key={title}>
      {title}
      <button type='button' aria-label={`${title} details`}>
        Details
      </button>
    </div>
  );

  return (
    <>
      <input aria-label='Search library' />
      <button type='button'>Library menu</button>
      <div ref={ref}>
        <section data-spatial-navigation='recent' aria-label='Continue reading'>
          {card('Recent one', 0)}
          {card('Recent two', 0)}
        </section>
        <section data-spatial-navigation='collection' aria-label='All books'>
          {card('Book one', 100)}
          {card('Book two', 100)}
          {card('Book three', 200)}
          {card('Book four', 200)}
        </section>
      </div>
    </>
  );
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = Number(this.dataset['layoutTop'] ?? 0);
    return {
      x: 0,
      y: top,
      top,
      bottom: top + 80,
      left: 0,
      right: 120,
      width: 120,
      height: 80,
      toJSON: () => ({}),
    };
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('library spatial navigation', () => {
  it('moves between recent books without entering the main grid at the row boundary', () => {
    render(<LibraryNavigation />);
    const first = screen.getByRole('button', { name: 'Recent one' });
    const last = screen.getByRole('button', { name: 'Recent two' });
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(last);
  });

  it('derives main-grid columns independently of the continue-reading row', () => {
    render(<LibraryNavigation />);
    const first = screen.getByRole('button', { name: 'Book one' });
    const third = screen.getByRole('button', { name: 'Book three' });
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('leaves vertical arrows available for scrolling the horizontal recent row', () => {
    render(<LibraryNavigation />);
    const recent = screen.getByRole('button', { name: 'Recent one' });
    recent.focus();

    expect(fireEvent.keyDown(recent, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(recent, { key: 'ArrowUp' })).toBe(true);
    expect(document.activeElement).toBe(recent);
  });

  it('leaves an embedded book action focused when arrow keys are pressed', () => {
    render(<LibraryNavigation />);
    const details = screen.getByRole('button', { name: 'Book one details' });
    details.focus();

    expect(fireEvent.keyDown(details, { key: 'ArrowDown' })).toBe(true);
    expect(document.activeElement).toBe(details);
  });

  it('does not move focus out of the search field with ArrowDown', () => {
    render(<LibraryNavigation />);
    const search = screen.getByRole('textbox', { name: 'Search library' });
    search.focus();

    expect(fireEvent.keyDown(search, { key: 'ArrowDown' })).toBe(true);
    expect(document.activeElement).toBe(search);
  });

  it('enters the first recent card from a header button with ArrowDown', () => {
    render(<LibraryNavigation />);
    const menu = screen.getByRole('button', { name: 'Library menu' });
    menu.focus();

    fireEvent.keyDown(menu, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recent one' }));
  });

  it('leaves Tab navigation and all card tab stops available', () => {
    render(<LibraryNavigation />);
    const first = screen.getByRole('button', { name: 'Recent one' });
    first.focus();

    expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true);
    expect(document.querySelectorAll('[role="button"][tabindex="0"]')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Book one details' }).tabIndex).toBe(0);
  });
});
