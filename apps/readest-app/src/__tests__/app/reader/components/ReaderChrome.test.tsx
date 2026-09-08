import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TabNavigation from '@/app/reader/components/sidebar/TabNavigation';
import NotebookHeader from '@/app/reader/components/notebook/Header';
import QuickActionMenu from '@/app/reader/components/annotator/QuickActionMenu';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));

vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: vi.fn() }));

afterEach(cleanup);

describe('reader navigation controls', () => {
  it('renders selection quick actions through the shared menu and keeps their action handlers', () => {
    const onActionSelect = vi.fn();
    render(<QuickActionMenu onActionSelect={onActionSelect} />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.querySelector('svg'))).toBe(true);
    fireEvent.click(items[0]!);
    expect(onActionSelect).toHaveBeenCalledWith('copy');
  });

  it('names every sidebar destination visibly and exposes the selected destination', () => {
    const onTabChange = vi.fn();
    const { rerender } = render(<TabNavigation activeTab='toc' onTabChange={onTabChange} />);
    const contents = screen.getByRole('button', { name: 'TOC' });
    const annotations = screen.getByRole('button', { name: 'Annotate' });
    expect(contents.tagName).toBe('BUTTON');
    expect(contents.textContent).toContain('TOC');
    expect(contents.getAttribute('aria-pressed')).toBe('true');
    expect(annotations.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(annotations);
    expect(onTabChange).toHaveBeenCalledWith('annotations');
    rerender(<TabNavigation activeTab='annotations' onTabChange={onTabChange} />);
    expect(screen.getByRole('button', { name: 'Annotate' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'TOC' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('exposes notebook pin and search state, and keeps a directly operable close control', () => {
    const handleClose = vi.fn();
    const handleTogglePin = vi.fn();
    const handleToggleSearchBar = vi.fn();
    render(
      <NotebookHeader
        isPinned
        isSearchBarVisible
        handleClose={handleClose}
        handleTogglePin={handleTogglePin}
        handleToggleSearchBar={handleToggleSearchBar}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Unpin Notebook' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Hide Search Bar' }).getAttribute('aria-expanded'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Notebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Search Bar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handleTogglePin).toHaveBeenCalledOnce();
    expect(handleToggleSearchBar).toHaveBeenCalledOnce();
    expect(handleClose).toHaveBeenCalledOnce();
  });
});
