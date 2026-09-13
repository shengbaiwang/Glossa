import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TabNavigation from '@/app/reader/components/sidebar/TabNavigation';
import NotebookHeader from '@/app/reader/components/notebook/Header';
import QuickActionMenu from '@/app/reader/components/annotator/QuickActionMenu';
import { DropdownProvider } from '@/context/DropdownContext';

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
    const contents = screen.getByRole('tab', { name: 'Contents' });
    const annotations = screen.getByRole('tab', { name: 'Notes' });
    expect(contents.tagName).toBe('BUTTON');
    expect(contents.textContent).toContain('Contents');
    expect(contents.getAttribute('aria-selected')).toBe('true');
    expect(annotations.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(annotations);
    expect(onTabChange).toHaveBeenCalledWith('annotations');
    rerender(<TabNavigation activeTab='annotations' onTabChange={onTabChange} />);
    expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Contents' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('keeps notebook pinning in its pane menu and close directly available', () => {
    const handleClose = vi.fn();
    const handleTogglePin = vi.fn();
    render(
      <DropdownProvider>
        <NotebookHeader isPinned handleClose={handleClose} handleTogglePin={handleTogglePin} />
      </DropdownProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Notebook' })).toBeTruthy();
    const options = screen.getByRole('button', { name: 'View Options' });
    expect(options.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(options);
    expect(options.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin Notebook' }));
    expect(options.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handleTogglePin).toHaveBeenCalledOnce();
    expect(handleClose).toHaveBeenCalledOnce();
  });
});
