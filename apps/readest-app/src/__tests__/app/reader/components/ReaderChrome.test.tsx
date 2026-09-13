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
    expect(items).toHaveLength(6);
    expect(items.every((item) => item.querySelector('svg'))).toBe(true);
    fireEvent.click(items[0]!);
    expect(onActionSelect).toHaveBeenCalledWith('copy');
  });

  it('names every sidebar destination visibly and exposes the selected destination', () => {
    const onTabChange = vi.fn();
    const { rerender } = render(<TabNavigation activeTab='toc' onTabChange={onTabChange} />);
    const contents = screen.getByRole('tab', { name: 'Contents' });
    const bookmarks = screen.getByRole('tab', { name: 'Bookmarks' });
    expect(contents.tagName).toBe('BUTTON');
    expect(contents.textContent).toContain('Contents');
    expect(contents.getAttribute('aria-selected')).toBe('true');
    expect(bookmarks.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(bookmarks);
    expect(onTabChange).toHaveBeenCalledWith('bookmarks');
    rerender(<TabNavigation activeTab='bookmarks' onTabChange={onTabChange} />);
    expect(screen.getByRole('tab', { name: 'Bookmarks' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Contents' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('keeps the assistant header to destinations and a direct close', () => {
    const handleClose = vi.fn();
    render(<NotebookHeader handleClose={handleClose} />);
    expect(screen.getByRole('heading', { name: 'Notebook' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'View Options' })).toBeNull();
    expect(screen.queryByRole('menuitem')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handleClose).toHaveBeenCalledOnce();
  });
});
