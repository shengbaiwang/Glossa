import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PageJumpInput from '@/app/reader/components/footerbar/PageJumpInput';
import {
  _resetLastKeyboardTime,
  useSpatialNavigation,
} from '@/app/reader/hooks/useSpatialNavigation';

const navigation = vi.hoisted(() => ({ goToFraction: vi.fn(), goTo: vi.fn() }));
const state = vi.hoisted(() => ({ pdf: false }));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: 'book',
    getView: () => navigation,
    getViewSettings: () => ({ progressStyle: state.pdf ? 'reference' : 'fraction' }),
    getProgress: () => ({
      pageinfo: { current: 22, total: 300 },
      section: { current: 46, total: 423 },
    }),
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({
      isFixedLayout: state.pdf,
      book: { format: state.pdf ? 'PDF' : 'EPUB' },
      bookDoc: {
        pageList: Array.from({ length: 423 }, (_, i) => ({
          label: i === 46 ? '3' : String(i + 1),
          href: String(i),
        })),
      },
    }),
  }),
}));

const Footer = () => {
  const footerRef = useRef<HTMLDivElement>(null);
  useSpatialNavigation(footerRef, true);
  return (
    <div ref={footerRef}>
      <button type='button'>Previous Page</button>
      <PageJumpInput bookKey='book' showFraction />
      <button type='button'>Next Page</button>
    </div>
  );
};

beforeEach(_resetLastKeyboardTime);
afterEach(() => {
  cleanup();
  state.pdf = false;
  vi.clearAllMocks();
});

describe('page input inside the reader toolbar', () => {
  it('preserves a typed destination while arrows move its caret, then commits that destination', () => {
    render(<Footer />);
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Go to Page' });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '87 / 300' } });
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('87 / 300');
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(input.value).toBe('87 / 300');
    expect(navigation.goToFraction).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigation.goToFraction).toHaveBeenCalledExactlyOnceWith(86.5 / 300);
  });

  it('cancels the edited destination with Escape without navigating', () => {
    render(<Footer />);
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Go to Page' });
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '87 / 300' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('23 / 300');
    expect(document.activeElement).not.toBe(input);
    expect(navigation.goToFraction).not.toHaveBeenCalled();
  });
});

it('keeps PDF file pages distinct from printed labels when editing and navigating', () => {
  state.pdf = true;
  render(<PageJumpInput bookKey='book' showFraction />);
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Go to Page' });
  expect(input.value).toBe('47 / 423');
  expect(screen.getByText(/Printed page/)).toBeTruthy();
  act(() => input.focus());
  fireEvent.change(input, { target: { value: '50 / 423' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(navigation.goTo).toHaveBeenCalledWith(49);
  expect(navigation.goToFraction).not.toHaveBeenCalled();
});
