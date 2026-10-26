import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { userEvent, page } from 'vitest/browser';
import { getConfigFilename, getLibraryFilename } from '@/utils/book';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import BookDataConflictDrafts from '@/components/BookDataConflictDrafts';
import {
  saveBookDataConflict,
  loadBookDataConflicts,
  newBookDataEdit,
} from '@/services/bookDataConflicts';
import { useLibraryStore } from '@/store/libraryStore';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  for (const name of ['glossa-book-data-conflicts', 'glossa-book-data-lifecycle'])
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
});
test('reopens durable drafts, exports the exact content, and discards only the reviewed draft', async () => {
  const first = {
    ...newBookDataEdit(),
    version: 1 as const,
    bookId: 'book',
    kind: 'conversations' as const,
    dataRevision: 0,
    cutoff: 200,
    data: { sessions: [{ title: 'My new words' }] },
  };
  await saveBookDataConflict(first);
  useLibraryStore.getState().setLibrary([
    {
      hash: 'book',
      title: 'Deleted title',
      author: 'A',
      format: 'EPUB',
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  const mounted = render(<BookDataConflictDrafts />);
  await screen.findByText('Deleted title');
  mounted.unmount();
  render(<BookDataConflictDrafts />);
  await screen.findByText('Deleted title');
  let exported: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    exported = blob as Blob;
    return 'blob:conflict';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByText('Preserved drafts ({{count}})'));
  fireEvent.click(screen.getByRole('button', { name: 'Export draft' }));
  expect(JSON.parse(await exported!.text())).toEqual(first.data);
  expect(await loadBookDataConflicts()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
  const confirmation = screen.getByRole('alertdialog');
  // A later edit from another pane is outside the confirmation's fixed target.
  const second = {
    ...first,
    ...newBookDataEdit(),
    data: { sessions: [{ title: 'Another pane' }] },
  };
  await saveBookDataConflict(second);
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Discard draft' }));
  await waitFor(async () =>
    expect((await loadBookDataConflicts()).map((draft) => draft.id)).toEqual([second.id]),
  );
  expect(await screen.findByText('Deleted title')).toBeTruthy();
});

test('compares and restores through the inline UI, keeps changed data, and retries a new preview', async () => {
  await page.viewport(390, 780);
  const book: Book = {
    hash: 'compare-ui',
    title: '恢复验收',
    author: 'A',
    format: 'EPUB',
    createdAt: 1,
    updatedAt: 1,
  };
  useLibraryStore.getState().setLibrary([book]);
  const note = {
    id: 'one',
    type: 'annotation',
    cfi: 'epubcfi(/2/4)',
    note: '保留当前笔记',
    createdAt: 1,
    updatedAt: 1,
  };
  const files = new Map([
    [getLibraryFilename(), JSON.stringify([book])],
    [getConfigFilename(book), JSON.stringify({ booknotes: [note], progress: [5, 10] })],
  ]);
  const app = {
    resolveFilePath: async () => 'compare-ui-library',
    exists: async (path: string) => files.has(path),
    readFile: async (path: string) => files.get(path)!,
    writeFile: async (path: string, _base: string, value: string) => {
      files.set(path, value);
    },
  } as unknown as AppService;
  const conflict = {
    ...newBookDataEdit(),
    version: 1 as const,
    bookId: book.hash,
    kind: 'notes' as const,
    cutoff: 200,
    dataRevision: 0,
    data: [{ ...note, note: '删除后的新草稿' }],
  };
  await saveBookDataConflict(conflict);
  render(<BookDataConflictDrafts appService={app} />);
  await userEvent.click(await screen.findByText('Preserved drafts ({{count}})'));
  await userEvent.click(await screen.findByRole('button', { name: 'Compare and restore' }));
  await screen.findByText('保留当前笔记');
  expect(screen.getByText('删除后的新草稿')).toBeTruthy();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: '../../../../../.glossa-dev/qa/removal-conflict-compare-mobile.png',
  });
  files.set(
    getConfigFilename(book),
    JSON.stringify({ booknotes: [{ ...note, note: '另一窗口最新笔记' }], progress: [8, 10] }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Keep current and restore a copy' }));
  await screen.findByText('Book data changed. Review the current data again.');
  expect(await loadBookDataConflicts()).toHaveLength(1);
  if (!document.querySelector('details')?.open)
    await userEvent.click(screen.getByText('Preserved drafts ({{count}})'));
  await userEvent.click(screen.getByRole('button', { name: 'Compare and restore' }));
  await screen.findByText('另一窗口最新笔记');
  await userEvent.click(screen.getByRole('button', { name: 'Keep current and restore a copy' }));
  await screen.findByText('Draft restored as a separate copy.');
  const saved = JSON.parse(files.get(getConfigFilename(book))!);
  expect(saved.booknotes.map((n: { note: string }) => n.note)).toEqual([
    '另一窗口最新笔记',
    '删除后的新草稿',
  ]);
  expect(saved.progress).toEqual([8, 10]);
  expect(await loadBookDataConflicts()).toHaveLength(0);
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Conflicting drafts' }));
});
