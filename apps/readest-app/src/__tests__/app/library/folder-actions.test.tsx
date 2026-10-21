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
import FolderNameEditor from '@/app/library/components/FolderNameEditor';
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
  it('keeps future folder imports attached to a renamed group and restores that attachment on undo', async () => {
    useSettingsStore.getState().setSettings({
      libraryFolders: ['研究', '研究/Books'],
      autoImportFolderGroups: { '/books': '研究/Books' },
    } as unknown as SystemSettings);
    const { result } = renderHook(() => useLibraryFolders());
    await act(async () => expect(await result.current.rename('研究', '阅读')).toBe(true));
    expect(useSettingsStore.getState().settings.autoImportFolderGroups).toEqual({
      '/books': '阅读/Books',
    });
    await act(async () => expect(await result.current.undo()).toBe(true));
    expect(useSettingsStore.getState().settings.autoImportFolderGroups).toEqual({
      '/books': '研究/Books',
    });
  });
  it('deletes a nonempty group, promoting child branches and preserving book metadata', async () => {
    useSettingsStore.getState().setSettings({
      libraryFolders: ['A', 'A/Child', 'A/Child/Leaf', 'Child'],
    } as unknown as SystemSettings);
    useLibraryStore.getState().setLibrary([
      { ...book, groupName: 'A', progress: [1, 2] },
      { ...book, hash: 'nested', groupName: 'A/Child/Leaf' },
    ]);
    const { result } = renderHook(() => useLibraryFolders());
    await act(async () => expect(await result.current.remove('A')).toBe(true));
    expect(result.current.paths).toEqual(['Child 2', 'Child 2/Leaf', 'Child']);
    expect(useLibraryStore.getState().library[0]).toMatchObject({
      groupName: '',
      progress: [1, 2],
    });
    expect(useLibraryStore.getState().library[1]?.groupName).toBe('Child 2/Leaf');
  });
  it('registers imported empty folders atomically and retains the prior catalog on invalid depth', async () => {
    const { result } = renderHook(() => useLibraryFolders());
    await act(async () => expect(await result.current.ensure(['文学', '文学/小说'])).toBe(true));
    expect(result.current.paths).toEqual(['文学', '文学/小说']);
    mocks.saveSettings.mockClear();
    await act(async () =>
      expect(await result.current.ensure(['历史', '文学/小说/短篇/诗歌/五层'])).toBe(false),
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

it('edits names without action icons, commits on blur, and ignores composition Enter', async () => {
  const save = vi.fn().mockResolvedValue(true),
    cancel = vi.fn();
  render(<FolderNameEditor initialName='History' onSave={save} onCancel={cancel} />);
  const input = screen.getByRole('textbox');
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.change(input, { target: { value: 'Research' } });
  fireEvent.blur(input);
  await waitFor(() => expect(save).toHaveBeenCalledWith('Research'));
});

it('keeps the group draft while Escape confirms an active IME composition', () => {
  const save = vi.fn().mockResolvedValue(true);
  const cancel = vi.fn();
  render(<FolderNameEditor initialName='历史' onSave={save} onCancel={cancel} />);
  const input = screen.getByRole('textbox');
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(cancel).toHaveBeenCalledExactlyOnceWith(true);
  expect(save).not.toHaveBeenCalled();
});

it('creates inline without a permanent new button and cancels with Escape', async () => {
  const create = vi.fn().mockResolvedValue('Untitled'),
    close = vi.fn();
  const props = { parent: '', create, busy: false, error: '', clearError: vi.fn(), onClose: close };
  const { rerender } = render(<FolderToolbar {...props} />);
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<FolderToolbar {...props} active />);
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() => expect(create).toHaveBeenCalledWith('', ''));
  expect(close).toHaveBeenCalledWith(true);
  rerender(<FolderToolbar {...props} active={false} />);
  rerender(<FolderToolbar {...props} active />);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(2);
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
  fireEvent.click(screen.getByRole('button', { name: 'Move to group' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'New subgroup' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '小说' } });
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
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

it('undoes a rename without reverting later reading progress or metadata', async () => {
  useLibraryStore.getState().setLibrary([{ ...book, groupName: 'A' }]);
  const { result } = renderHook(() => useLibraryFolders());
  await act(async () => {
    await result.current.rename('A', 'B');
  });
  act(() =>
    useLibraryStore
      .getState()
      .setLibrary([
        { ...useLibraryStore.getState().library[0]!, title: 'Later title', progress: [3, 10] },
      ]),
  );
  expect(result.current.canUndo).toBe(true);
  await act(async () => {
    expect(await result.current.undo()).toBe(true);
  });
  expect(useLibraryStore.getState().library[0]).toMatchObject({
    groupName: 'A',
    title: 'Later title',
    progress: [3, 10],
  });
});
it('refuses undo after another book joins a renamed branch', async () => {
  useLibraryStore.getState().setLibrary([{ ...book, groupName: 'A' }]);
  const { result } = renderHook(() => useLibraryFolders());
  await act(async () => {
    await result.current.rename('A', 'B');
  });
  act(() =>
    useLibraryStore
      .getState()
      .setLibrary([
        ...useLibraryStore.getState().library,
        { ...book, hash: 'later', groupName: 'B' },
      ]),
  );
  expect(result.current.canUndo).toBe(false);
  await act(async () => {
    expect(await result.current.undo()).toBe(false);
  });
  expect(useLibraryStore.getState().library.every((b) => b.groupName === 'B')).toBe(true);
});
