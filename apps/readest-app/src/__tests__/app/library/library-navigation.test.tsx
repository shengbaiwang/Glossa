import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LibraryNavigation from '@/app/library/components/LibraryNavigation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { md5Fingerprint } from '@/utils/md5';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { SystemSettings, LibraryGroupByType } from '@/types/settings';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSettingsDialog: vi.fn(),
  search: new URLSearchParams('groupBy=author&group=Ada&q=paper&view=list'),
  settings: { libraryGroupBy: 'group' },
  saveSettings: vi.fn(),
  saveLibraryBooks: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  useSearchParams: () => mocks.search,
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks }) }));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: (...args: unknown[]) => mocks.navigate(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.search = new URLSearchParams('groupBy=author&group=Ada&q=paper&view=list');
  mocks.saveSettings.mockResolvedValue(undefined);
  mocks.saveLibraryBooks.mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      libraryGroupBy: LibraryGroupByType.Group,
      libraryFolders: ['文学', '文学/小说', '历史'],
    } as SystemSettings,
    openSettingsDialog: mocks.openSettingsDialog,
  });
  useLibraryStore.getState().setLibrary([]);
});

describe('LibraryNavigation', () => {
  it('creates inline at the current level, focuses the result, and stops at two levels', async () => {
    mocks.search = new URLSearchParams('groupBy=group');
    const { rerender } = render(<LibraryNavigation onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'New Folder' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Folder name' }), {
      target: { value: '学术' },
    });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Folder name' }).closest('form')!);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '学术' })),
    );
    mocks.search = new URLSearchParams(`groupBy=group&group=${md5Fingerprint('学术')}`);
    rerender(<LibraryNavigation onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'New Folder' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Folder name' }), {
      target: { value: '阅读' },
    });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Folder name' }).closest('form')!);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '学术/阅读' })),
    );
    mocks.search = new URLSearchParams(`groupBy=group&group=${md5Fingerprint('学术/阅读')}`);
    rerender(<LibraryNavigation onNavigate={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'New Folder' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows folders directly between the library and metadata browsing', () => {
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    const library = screen.getByRole('region', { name: 'Library' });
    const browse = screen.getByRole('region', { name: 'Browse' });
    expect(
      within(library)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['All Books']);
    expect(screen.getByRole('region', { name: 'My Groups' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '文学/小说' })).toBeTruthy();
    expect(
      within(browse)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Authors', 'Series', 'Tags', 'Subjects']);
  });

  it('keeps the active category visible while viewing one of its groups', () => {
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Authors' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('button', { name: 'All Books' }).hasAttribute('aria-current')).toBe(
      false,
    );
  });

  it('changes category, leaves the nested group, and preserves search and view options', () => {
    const onNavigate = vi.fn();
    render(<LibraryNavigation onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'All Books' }));
    const params = new URLSearchParams(mocks.navigate.mock.calls[0]![1]);
    expect(params.get('groupBy')).toBe('none');
    expect(params.get('group')).toBe('');
    expect(params.get('q')).toBe('paper');
    expect(params.get('view')).toBe('list');
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it('keeps arrow-key focus inside the sidebar without navigating until activated', () => {
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    const books = screen.getByRole('button', { name: 'All Books' });
    books.focus();
    fireEvent.keyDown(books, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'My Groups' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '历史' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'My Groups' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Subjects' }));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('opens application settings without changing the current library category', () => {
    const onNavigate = vi.fn();
    render(<LibraryNavigation onNavigate={onNavigate} />);
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(settings.textContent).toBe('Settings');
    fireEvent.click(settings);
    expect(mocks.openSettingsDialog).toHaveBeenCalledExactlyOnceWith('application');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('opens a specific folder directly and marks only that destination as current', () => {
    mocks.search = new URLSearchParams(
      `groupBy=group&group=${md5Fingerprint('文学/小说')}&view=list`,
    );
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: '文学/小说' }).getAttribute('aria-current')).toBe(
      'page',
    );
    fireEvent.click(screen.getByRole('button', { name: '历史' }));
    const params = new URLSearchParams(mocks.navigate.mock.calls[0]![1]);
    expect(params.get('groupBy')).toBe('group');
    expect(params.get('group')).toBe(md5Fingerprint('历史'));
    expect(params.get('view')).toBe('list');
  });

  it('renames the active parent inline and keeps its current child open', async () => {
    mocks.search = new URLSearchParams(`groupBy=group&group=${md5Fingerprint('文学/小说')}`);
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('button', { name: '文学' }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Folder name' }), {
      target: { value: '文艺' },
    });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Folder name' }).closest('form')!);
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.libraryFolders).toContain('文艺/小说'),
    );
    expect(new URLSearchParams(mocks.navigate.mock.calls[0]![1]).get('group')).toBe(
      md5Fingerprint('文艺/小说'),
    );
  });

  it('moves a dragged folder, persists it, and rejects a third level without altering data', async () => {
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    const transfer = (path: string) => ({
      types: ['application/x-glossa-library-items'],
      getData: () => JSON.stringify([md5Fingerprint(path)]),
      dropEffect: 'none',
    });
    fireEvent.drop(screen.getByRole('button', { name: '文学' }), {
      dataTransfer: transfer('历史'),
    });
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.libraryFolders).toContain('文学/历史'),
    );
    fireEvent.drop(screen.getByRole('button', { name: '文学/小说' }), {
      dataTransfer: transfer('文学/历史'),
    });
    await screen.findByRole('alert');
    expect(useSettingsStore.getState().settings.libraryFolders).toContain('文学/历史');
    expect(useSettingsStore.getState().settings.libraryFolders).not.toContain('文学/小说/历史');
  });
});
