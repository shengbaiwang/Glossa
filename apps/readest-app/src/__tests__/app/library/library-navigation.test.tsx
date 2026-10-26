import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
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
  it('creates from the heading menu, defaults blank names and restores focus', async () => {
    mocks.search = new URLSearchParams('groupBy=group');
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'My Groups' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New group' }));
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Untitled'),
    );
    expect(screen.getByRole('button', { name: 'Untitled' })).toBe(document.activeElement);
  });

  it.each([
    ['Untitled', 'B'],
    ['Untitled/B', 'C'],
    ['Untitled/B/C', 'D'],
  ])('creates a subgroup beneath %s and restores focus', async (parent, name) => {
    mocks.search = new URLSearchParams('groupBy=group');
    const settings = useSettingsStore.getState().settings;
    const ancestors = parent
      .split('/')
      .map((_, index, parts) => parts.slice(0, index + 1).join('/'));
    useSettingsStore.setState({
      settings: { ...settings, libraryFolders: [...(settings.libraryFolders ?? []), ...ancestors] },
    });
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: parent }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New subgroup' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: name } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    // Poll focus directly so accessible-name queries do not block the async save effects.
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(parent + '/' + name),
    );
    expect(screen.getByRole('button', { name: parent + '/' + name })).toBe(document.activeElement);
  });

  it('does not offer another subgroup at the fourth level', () => {
    const settings = useSettingsStore.getState().settings;
    useSettingsStore.setState({
      settings: {
        ...settings,
        libraryFolders: ['Untitled', 'Untitled/B', 'Untitled/B/C', 'Untitled/B/C/D'],
      },
    });
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Untitled/B/C/D' }));
    expect(screen.queryByRole('menuitem', { name: 'New subgroup' })).toBeNull();
  });

  it('shows folders directly between the library and metadata browsing', () => {
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    const library = screen.getByRole('region', { name: 'Library' });
    const browse = screen.getByRole('region', { name: 'Browse' });
    expect(
      within(library)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['All Books', 'Recently Deleted']);
    expect(screen.getByRole('region', { name: 'My Groups' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '文学/小说' })).toBeTruthy();
    expect(
      within(browse)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Authors', 'Series', 'Tags']);
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
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recently Deleted' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'My Groups' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '文学' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'My Groups' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tags' }));
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

  it('keeps folder rows quiet and opens inline rename from the context menu', async () => {
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    const folder = screen.getByRole('button', { name: '历史' });
    fireEvent.mouseOver(folder);
    expect(screen.queryByRole('button', { name: /^Rename group/ })).toBeNull();
    expect(folder.closest('.glossa-library-folder-row')?.querySelectorAll('button')).toHaveLength(
      1,
    );
    fireEvent.contextMenu(folder, { clientX: 80, clientY: 160 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename group' }));
    expect((screen.getByRole('textbox', { name: 'Group name' }) as HTMLInputElement).value).toBe(
      '历史',
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '历史' }));
  });

  it.each([
    { key: 'ContextMenu' },
    { key: 'F10', shiftKey: true },
  ])('opens the folder menu with $key and restores focus on Escape', async (key) => {
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    const folder = screen.getByRole('button', { name: '历史' });
    folder.focus();
    fireEvent.keyDown(folder, key);
    const rename = await screen.findByRole('menuitem', { name: 'Rename group' });
    expect(document.activeElement).toBe(rename);
    fireEvent.keyDown(rename, { key: 'Escape' });
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(document.activeElement).toBe(folder);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('opens the menu on touch hold without navigating and cancels a moving hold', () => {
    vi.useFakeTimers();
    try {
      render(<LibraryNavigation onNavigate={vi.fn()} />);
      const folder = screen.getByRole('button', { name: '历史' });
      const pointer = { button: 0, pointerId: 1, pointerType: 'touch', clientX: 80, clientY: 160 };
      fireEvent.pointerDown(folder, pointer);
      act(() => vi.advanceTimersByTime(600));
      fireEvent.pointerUp(folder, pointer);
      fireEvent.click(folder);
      expect(screen.getByRole('menuitem', { name: 'Rename group' })).toBeTruthy();
      expect(mocks.navigate).not.toHaveBeenCalled();
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Rename group' }), { key: 'Escape' });
      fireEvent.pointerDown(folder, pointer);
      fireEvent.pointerMove(folder, { ...pointer, clientY: 200 });
      act(() => vi.advanceTimersByTime(600));
      expect(screen.queryByRole('menuitem')).toBeNull();
      fireEvent.pointerCancel(folder, pointer);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renames the active parent inline and keeps its current child open', async () => {
    mocks.search = new URLSearchParams(`groupBy=group&group=${md5Fingerprint('文学/小说')}`);
    render(<LibraryNavigation onNavigate={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('button', { name: '文学' }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Group name' }), {
      target: { value: '文艺' },
    });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Group name' }).closest('form')!);
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.libraryFolders).toContain('文艺/小说'),
    );
    expect(new URLSearchParams(mocks.navigate.mock.calls[0]![1]).get('group')).toBe(
      md5Fingerprint('文艺/小说'),
    );
  });

  it('moves a dragged folder and persists a third level', async () => {
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
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.libraryFolders).toContain('文学/小说/历史'),
    );
    expect(useSettingsStore.getState().settings.libraryFolders).not.toContain('文学/历史');
  });
});

it('creates a root group with the keyboard shortcut without adding a bottom action', () => {
  render(<LibraryNavigation onNavigate={vi.fn()} />);
  const heading = screen.getByRole('button', { name: 'My Groups' });
  heading.focus();
  fireEvent.keyDown(heading, { key: 'N', ctrlKey: true, shiftKey: true });
  expect(screen.getByRole('textbox')).toBe(document.activeElement);
  expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
});

it('keeps old subject navigation readable as all books with no subject entry', () => {
  mocks.search = new URLSearchParams('groupBy=subject&group=old-subject');
  render(<LibraryNavigation onNavigate={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'All Books' }).getAttribute('aria-current')).toBe(
    'page',
  );
  expect(screen.queryByRole('button', { name: 'Subjects' })).toBeNull();
});
