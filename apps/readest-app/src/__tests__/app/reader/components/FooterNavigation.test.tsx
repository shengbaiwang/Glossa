import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopFooterBar from '@/app/reader/components/footerbar/DesktopFooterBar';
import { NavigationPanel } from '@/app/reader/components/footerbar/NavigationPanel';
import type { FooterBarChildProps } from '@/app/reader/components/footerbar/types';

const reader = vi.hoisted(() => ({
  settings: { rtl: false, showPaginationButtons: false },
  history: { canGoBack: false, canGoForward: true },
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    hoveredBookKey: 'book',
    getView: () => ({ history: reader.history }),
    getViewSettings: () => reader.settings,
  }),
}));
vi.mock('@/app/reader/components/footerbar/PageJumpInput', () => ({
  default: () => <input aria-label='Go to Page' defaultValue='23 / 302' />,
}));

const props = (): FooterBarChildProps => ({
  bookKey: 'book',
  gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  progressValid: true,
  progressFraction: 0.2,
  actionTab: 'progress',
  forceMobileLayout: false,
  onSetActionTab: vi.fn(),
  navigationHandlers: {
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
    onPrevSection: vi.fn(),
    onNextSection: vi.fn(),
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onProgressChange: vi.fn(),
  },
});

beforeEach(() => {
  reader.settings = { rtl: false, showPaginationButtons: false };
});
afterEach(cleanup);

describe('reader footer navigation', () => {
  it('previews a drag without repeatedly navigating, then commits on release', () => {
    const config = props();
    render(<DesktopFooterBar {...config} />);
    const slider = screen.getByRole('slider');
    Object.assign(slider, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: () => true,
    });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '45' } });
    fireEvent.change(slider, { target: { value: '63' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('63%');
    expect(config.navigationHandlers.onProgressChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(config.navigationHandlers.onProgressChange).toHaveBeenCalledExactlyOnceWith(63);
  });

  it('keeps page turns beside the page field and separates history and section jumps', () => {
    const config = props();
    render(<DesktopFooterBar {...config} />);
    const pages = screen.getByRole('group', { name: 'Go to Page' });
    expect(within(pages).getByRole('button', { name: 'Previous Page' })).toBeTruthy();
    expect(within(pages).getByRole('textbox', { name: 'Go to Page' })).toBeTruthy();
    fireEvent.click(within(pages).getByRole('button', { name: 'Next Page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous Section' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go Forward' }));
    expect(config.navigationHandlers.onNextPage).toHaveBeenCalledOnce();
    expect(config.navigationHandlers.onPrevSection).toHaveBeenCalledOnce();
    expect(config.navigationHandlers.onGoForward).toHaveBeenCalledOnce();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Go Back' }).disabled).toBe(true);
  });

  it('retains the existing pagination button preference while keeping progress available', () => {
    reader.settings.showPaginationButtons = true;
    render(<DesktopFooterBar {...props()} />);
    expect(screen.queryByRole('button', { name: 'Previous Page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next Section' })).toBeNull();
    expect(screen.getByRole('slider')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Go to Page' })).toBeTruthy();
  });

  it('keeps mobile page navigation and release-to-jump behavior', () => {
    const config = props();
    render(<NavigationPanel {...config} bottomOffset='64px' forceMobileLayout />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.change(slider, { target: { value: '21' } });
    expect(config.navigationHandlers.onProgressChange).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(config.navigationHandlers.onProgressChange).toHaveBeenCalledExactlyOnceWith(21);
    fireEvent.click(screen.getByRole('button', { name: 'Previous Page' }));
    expect(config.navigationHandlers.onPrevPage).toHaveBeenCalledOnce();
  });
});
