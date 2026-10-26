import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import RecentlyDeleted from '@/app/library/components/RecentlyDeleted';
import { removeAppBooks } from '@/services/appBookRemoval';
import { withBookDataWrite } from '@/services/bookDataLifecycle';
import { saveConversations, loadConversations } from '@/glossa/conversation/store';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getLibraryFilename } from '@/utils/book';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';
const host = vi.hoisted(() => ({ app: null as AppService | null }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: host.app, envConfig: {} }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/{{(\w+)}}/g, (_, name: string) => String(values[name] ?? name)),
}));
vi.mock('@/services/sync/file/runLibrarySync', () => ({ runFileLibrarySyncPass: vi.fn() }));
afterEach(async () => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  for (const name of [
    'glossa-conversations',
    'glossa-book-data-lifecycle',
    'glossa-book-data-conflicts',
  ])
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
});
test('real UI and persistent services complete trash, reopen, restore, cancel and permanent purge without changing another book', async () => {
  // The native WebDriver's synchronous window-size command can block its
  // server on macOS. Use the real app window there; Chromium covers sizing.
  const nativeWindow = '__TAURI_INTERNALS__' in window;
  if (!nativeWindow) await page.viewport(900, 760);
  document.documentElement.setAttribute('data-eink', 'true');
  const selected: Book = {
    hash: 'workflow-selected',
    title: '流程验收原书',
    author: 'Fixture',
    format: 'EPUB',
    createdAt: 1,
    updatedAt: 1,
    progress: [7, 10],
  };
  const other: Book = { ...selected, hash: 'workflow-other', title: '保留的另一书籍' };
  const files = new Map([
    [getLibraryFilename(), JSON.stringify([selected, other])],
    ['managed', 'managed original'],
    ['external', 'external original'],
  ]);
  host.app = {
    resolveFilePath: async () => 'workflow-library',
    readFile: async (path: string) => files.get(path)!,
    writeFile: async (path: string, _base: string, value: string) => {
      files.set(path, value);
    },
    deleteBook: async () => {
      files.delete('managed');
    },
  } as unknown as AppService;
  const originalSettings = useSettingsStore.getState().settings;
  useSettingsStore.setState({
    settings: {
      ...originalSettings,
      webdav: { ...originalSettings.webdav, enabled: false },
      s3: { ...originalSettings.s3, enabled: false },
    },
  });
  try {
    for (const book of [selected, other])
      await saveConversations({
        version: 1,
        bookId: book.hash,
        activeId: 'one',
        sessions: [{ id: 'one', title: book.title, turns: [] }],
      });
    let result = await removeAppBooks(host.app, [selected], 'trash');
    useLibraryStore.getState().setLibrary(result.books);
    let mounted = render(<RecentlyDeleted />);
    expect(screen.getByText(selected.title)).toBeTruthy();
    expect(files.has('managed')).toBe(true);
    mounted.unmount();
    mounted = render(<RecentlyDeleted />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(useLibraryStore.getState().library[0]?.deletedAt).toBeNull());
    let current = useLibraryStore.getState().library[0]!;
    expect(current.progress).toEqual([7, 10]);
    expect(await loadConversations(selected.hash, current.removal!.revision)).not.toBeNull();
    result = await removeAppBooks(host.app, [current], 'trash');
    useLibraryStore.getState().setLibrary(result.books);
    await userEvent.click(await screen.findByRole('checkbox', { name: selected.title }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    let dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/Legacy shared data can be reviewed in Settings/)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.keyboard('{Escape}');
    expect(files.has('managed')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    dialog = screen.getByRole('alertdialog');
    if (!nativeWindow)
      await page.screenshot({
        path: '../../../../../../.glossa-dev/qa/removal-permanent-confirm-eink.png',
      });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await screen.findByText('No recently deleted books');
    current = useLibraryStore.getState().library[0]!;
    expect(files.has('managed')).toBe(false);
    expect(files.get('external')).toBe('external original');
    expect(useLibraryStore.getState().library[1]).toEqual(other);
    await expect(withBookDataWrite(selected.hash, 0, async () => {})).rejects.toThrow();
    expect(await loadConversations(other.hash)).not.toBeNull();
    expect(JSON.parse(files.get(getLibraryFilename())!)[0].removal.local).toBe('complete');
    expect(screen.getByText('Permanently deleted 1 book(s)')).toBeTruthy();
  } finally {
    useSettingsStore.setState({ settings: originalSettings });
  }
});
