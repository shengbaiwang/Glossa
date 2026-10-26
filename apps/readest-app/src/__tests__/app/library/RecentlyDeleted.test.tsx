import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RecentlyDeleted from '@/app/library/components/RecentlyDeleted';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

const state = vi.hoisted(() => ({ rows: [] as Book[], sync: vi.fn(async () => null) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: {
      resolveFilePath: async () => '',
      readFile: async () => JSON.stringify(state.rows),
      writeFile: async (path: string, _base: string, text: string) => {
        if (path === 'library.json') state.rows = JSON.parse(text);
      },
    },
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? name)),
}));
vi.mock('@/services/sync/file/runLibrarySync', () => ({ runFileLibrarySyncPass: state.sync }));
afterEach(cleanup);
const removed = (mode: 'trash' | 'purge'): Book => ({
  hash: 'removed',
  title: 'Personal title',
  author: 'A',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: 200,
  progress: [7, 10],
  removal: {
    version: 1,
    id: 'job',
    revision: 200,
    requestedAt: 200,
    mode,
    local: 'complete',
    cloud: 'failed',
  },
});

test('opens permanent deletion directly from a book row without selecting it first', () => {
  state.rows = [removed('trash')];
  useLibraryStore.getState().setLibrary(state.rows);
  render(<RecentlyDeleted />);
  expect(screen.queryByRole('button', { name: 'Check legacy shared data' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Delete “Personal title” permanently' }));
  const dialog = screen.getByRole('alertdialog');
  expect(within(dialog).getByText('Personal title')).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: 'Delete permanently' })).toBeTruthy();
});

test('keeps a locally purged book visible until its cloud cleanup succeeds and offers sync retry', async () => {
  state.rows = [removed('purge')];
  useLibraryStore.getState().setLibrary(state.rows);
  render(<RecentlyDeleted />);
  expect(screen.getByText('Personal title')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }));
  await waitFor(() => expect(state.sync).toHaveBeenCalled());
  expect(screen.getByText('Personal title')).toBeTruthy();
});

test('shows the book and actionable reason for a failed local download cleanup', () => {
  const previous = removed('trash');
  const local = {
    ...previous,
    title: 'Only local book',
    deletedAt: null,
    removal: undefined,
    localRemoval: {
      ...previous.removal!,
      mode: 'local' as const,
      local: 'failed' as const,
      cloud: 'none' as const,
      failure: 'unavailable-copy' as const,
    },
  };
  state.rows = [local];
  useLibraryStore.getState().setLibrary(state.rows);
  render(<RecentlyDeleted />);
  expect(screen.getByText(/Only local book/)).toBeTruthy();
  expect(screen.getByText(/No matching recovery copy could be verified/)).toBeTruthy();
  fireEvent.click(screen.getByText('Unfinished actions (1)'));
  expect(screen.getByRole('button', { name: 'Continue / Retry' })).toBeTruthy();
});

test('restores current personal data from durable storage without applying an old snapshot', async () => {
  const old = removed('trash');
  useLibraryStore.getState().setLibrary([old]);
  state.rows = [{ ...old, title: 'Later title', updatedAt: 500, progress: [9, 10] }];
  render(<RecentlyDeleted />);
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  await waitFor(() => expect(state.rows[0]?.deletedAt).toBeNull());
  expect(state.rows[0]).toMatchObject({
    title: 'Later title',
    progress: [9, 10],
    removal: { mode: 'restore' },
  });
});
test('keeps the confirmed cloud targets when sync settings change in another window', async () => {
  const original = useSettingsStore.getState().settings;
  try {
    const old = removed('trash');
    state.rows = [old];
    useLibraryStore.getState().setLibrary(state.rows);
    useSettingsStore.setState({
      settings: {
        ...original,
        webdav: { enabled: true },
        s3: { enabled: false },
      } as SystemSettings,
    });
    render(<RecentlyDeleted />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(within(screen.getByRole('alertdialog')).getByText(/WebDAV/)).toBeTruthy();
    useSettingsStore.setState({
      settings: {
        ...original,
        webdav: { enabled: false },
        s3: { enabled: true },
      } as SystemSettings,
    });
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete permanently' }),
    );
    await waitFor(() => expect(state.rows[0]?.removal?.mode).toBe('purge'));
    expect(state.rows[0]?.removal?.cloudTargets).toEqual({ webdav: 'pending' });
  } finally {
    useSettingsStore.setState({ settings: original });
  }
});
