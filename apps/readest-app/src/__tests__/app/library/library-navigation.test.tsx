import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LibraryNavigation from '@/app/library/components/LibraryNavigation';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: new URLSearchParams('groupBy=author&group=Ada&q=paper&view=list'),
  settings: { libraryGroupBy: 'group' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  useSearchParams: () => mocks.search,
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: mocks.settings }),
}));
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: (...args: unknown[]) => mocks.navigate(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LibraryNavigation', () => {
  it('keeps the active category visible while viewing one of its groups', () => {
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Authors' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('button', { name: 'Books' }).hasAttribute('aria-current')).toBe(false);
  });

  it('changes category, leaves the nested group, and preserves search and view options', () => {
    const onNavigate = vi.fn();
    render(<LibraryNavigation onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Books' }));
    const params = new URLSearchParams(mocks.navigate.mock.calls[0]![1]);
    expect(params.get('groupBy')).toBe('none');
    expect(params.get('group')).toBe('');
    expect(params.get('q')).toBe('paper');
    expect(params.get('view')).toBe('list');
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it('keeps arrow-key focus inside the sidebar without navigating until activated', () => {
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    const books = screen.getByRole('button', { name: 'Books' });
    books.focus();
    fireEvent.keyDown(books, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Groups' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Subjects' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
