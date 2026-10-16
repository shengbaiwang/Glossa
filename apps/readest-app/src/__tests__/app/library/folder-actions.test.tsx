import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import type { Book } from '@/types/book';
import { useLibraryFolders } from '@/app/library/hooks/useLibraryFolders';
import FolderToolbar from '@/app/library/components/FolderToolbar';
import GroupingModal from '@/app/library/components/GroupingModal';
import { md5Fingerprint } from '@/utils/md5';

const mocks = vi.hoisted(() => ({ saveSettings: vi.fn(), saveLibraryBooks: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));

const book: Book = {
  hash: 'book1',
  title: 'An original test book',
  author: '',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveSettings.mockResolvedValue(undefined);
  mocks.saveLibraryBooks.mockResolvedValue(undefined);
  useSettingsStore.setState({ settings: { libraryFolders: [] } as unknown as SystemSettings });
  useLibraryStore.getState().setLibrary([book]);
});
afterEach(cleanup);

describe('folder persistence and recovery', () => {
  it('registers imported empty folders atomically and retains the prior catalog on invalid depth', async () => {
    const { result } = renderHook(() => useLibraryFolders());
    await act(async () => expect(await result.current.ensure(['文学', '文学/小说'])).toBe(true));
    expect(result.current.paths).toEqual(['文学', '文学/小说']);
    mocks.saveSettings.mockClear();
    await act(async () =>
      expect(await result.current.ensure(['历史', '文学/小说/短篇'])).toBe(false),
    );
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    expect(result.current.paths).toEqual(['文学', '文学/小说']);
  });

  it('deletes empty folders and drops only their stale selection', async () => {
    useSettingsStore
      .getState()
      .setSettings({ libraryFolders: ['文学', '文学/小说'] } as unknown as SystemSettings);
    useLibraryStore.getState().setSelectedBooks([md5Fingerprint('文学/小说'), book.hash]);
    const { result } = renderHook(() => useLibraryFolders());
    await act(async () => {
      expect(await result.current.remove('文学/小说')).toBe(true);
    });
    expect(result.current.paths).toEqual(['文学']);
    expect(useLibraryStore.getState().getSelectedBooks()).toEqual([book.hash]);
  });

  it('saves empty folders independently of books and restores them after a library reload', async () => {
    const { result } = renderHook(() => useLibraryFolders());
    await act(async () => {
      expect(await result.current.create('', '文学')).toBe('文学');
    });
    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ libraryFolders: ['文学'] }),
    );
    expect(mocks.saveLibraryBooks).not.toHaveBeenCalled();
    act(() => useLibraryStore.getState().setLibrary([]));
    expect(useLibraryStore.getState().getGroupName(md5Fingerprint('文学'))).toBe('文学');
    expect(result.current.paths).toEqual(['文学']);
  });

  it('keeps the draft and catalog unchanged when saving fails, then allows retry', async () => {
    mocks.saveSettings.mockRejectedValueOnce(new Error('disk unavailable'));
    const { result } = renderHook(() => useLibraryFolders());
    await act(async () => {
      expect(await result.current.create('', '文学')).toBeUndefined();
    });
    expect(result.current.paths).toEqual([]);
    expect(result.current.error).toBe('Unable to save folders. Please try again.');
    await act(async () => {
      await result.current.create('', '文学');
    });
    expect(result.current.paths).toEqual(['文学']);
    expect(result.current.error).toBe('');
  });

  it('restores the saved catalog when a rename cannot save its books', async () => {
    useLibraryStore.getState().setLibrary([{ ...book, groupName: '文学/小说' }]);
    mocks.saveLibraryBooks.mockRejectedValueOnce(new Error('disk unavailable'));
    const { result } = renderHook(() => useLibraryFolders());
    await act(async () => {
      expect(await result.current.rename('文学', '研究')).toBe(false);
    });
    expect(useLibraryStore.getState().library[0]?.groupName).toBe('文学/小说');
    expect(mocks.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ libraryFolders: [] }),
    );
    expect(result.current.paths).toContain('文学/小说');
  });
});

it('creates folders inline, cancels with Escape, and offers no third level', async () => {
  const create = vi.fn().mockResolvedValue('文学');
  const props = { parent: '', create, busy: false, error: '', clearError: vi.fn() };
  const { rerender } = render(<FolderToolbar {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'New Folder' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Folder name' }), {
    target: { value: '文学' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(create).toHaveBeenCalledWith('', '文学'));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'New Folder' }));
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(screen.queryByRole('textbox')).toBeNull();
  rerender(<FolderToolbar {...props} parent='文学/小说' />);
  expect(screen.queryByRole('button', { name: 'New Folder' })).toBeNull();
});

it('creates an empty child in the destination picker, moves a book into it, and can move it out', async () => {
  useSettingsStore
    .getState()
    .setSettings({ libraryFolders: ['文学'] } as unknown as SystemSettings);
  const confirm = vi.fn();
  const props = {
    libraryBooks: [book],
    selectedBooks: ['book1'],
    parentGroupName: '',
    onCancel: vi.fn(),
    onConfirm: confirm,
  };
  const view = render(<GroupingModal {...props} />);
  fireEvent.click(screen.getByRole('button', { name: '文学' }));
  fireEvent.click(screen.getByRole('button', { name: 'New Folder' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '小说' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '小说' }).getAttribute('aria-pressed')).toBe('true'),
  );
  fireEvent.click(screen.getByRole('button', { name: /^Move$/ }));
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(useLibraryStore.getState().library[0]?.groupName).toBe('文学/小说');
  view.unmount();
  render(<GroupingModal {...props} parentGroupName='文学/小说' />);
  fireEvent.click(screen.getByRole('button', { name: 'All Books' }));
  fireEvent.click(screen.getByRole('button', { name: /^Move$/ }));
  await waitFor(() => expect(useLibraryStore.getState().library[0]?.groupName).toBe(''));
  expect(useSettingsStore.getState().settings.libraryFolders).toContain('文学/小说');
});
