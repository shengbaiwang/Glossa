import { afterEach, expect, test, vi } from 'vitest';
import {
  withPurgedBookData,
  withBookDataWrite,
  activateBookData,
} from '@/services/bookDataLifecycle';
import {
  saveConversations,
  loadConversations,
  forgetPurgedConversations,
} from '@/glossa/conversation/store';
import {
  loadBookDataConflicts,
  discardBookDataConflict,
  newBookDataEdit,
} from '@/services/bookDataConflicts';
import { saveMapWorkspace, loadMapWorkspace } from '@/glossa/mindmap/workspaceStore';
import { createMap } from '@/glossa/mindmap/workspace';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { saveBookConfig } from '@/services/bookService';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';
import type { Book, BookNote } from '@/types/book';

afterEach(async () => {
  vi.restoreAllMocks();
  forgetPurgedConversations('book');
  for (const name of [
    'glossa-book-data-lifecycle',
    'glossa-book-data-conflicts',
    'glossa-map-workspaces',
  ]) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
});
const history = () => ({
  version: 1 as const,
  bookId: 'book',
  activeId: 'session',
  sessions: [{ id: 'session', title: 'New personal name', turns: [] }],
});
const deleteBook = () => withPurgedBookData('book', 200, async () => {});
const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));
};

test('durably keeps an explicit conversation edit after purge without reviving the main history', async () => {
  await deleteBook();
  await tick();
  const edit = newBookDataEdit();
  await expect(saveConversations(history(), 0, edit)).rejects.toThrow(/preserved/i);
  forgetPurgedConversations('book');
  const drafts = await loadBookDataConflicts();
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({
    id: edit.id,
    bookId: 'book',
    kind: 'conversations',
    data: history(),
  });
  // Reopen from disk after restore: the conflict must not silently replace the current book.
  await activateBookData('book', 300);
  expect(await loadConversations('book', 300)).toBeNull();
  expect(await loadBookDataConflicts()).toEqual(drafts);
  await expect(saveConversations(history(), 0, edit)).rejects.toThrow(/preserved/i);
  expect(await loadBookDataConflicts()).toEqual(drafts);
});

test('does not preserve late automatic answers or edits submitted before the deletion', async () => {
  const old = newBookDataEdit();
  await tick();
  await deleteBook();
  await expect(saveConversations(history(), 0)).rejects.toThrow();
  await expect(saveConversations(history(), 0, old)).rejects.toThrow();
  expect(await loadBookDataConflicts()).toEqual([]);
});
test('does not lose an explicit edit made within the same wall-clock millisecond as deletion', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(10_000);
  await deleteBook();
  await expect(saveConversations(history(), 0, newBookDataEdit())).rejects.toThrow(/preserved/i);
  expect(await loadBookDataConflicts()).toHaveLength(1);
});
test('refuses an old purge after explicit restore, before cleaning any files or personal data', async () => {
  await deleteBook();
  await activateBookData('book', 300);
  const cleanup = vi.fn();
  await expect(withPurgedBookData('book', 200, cleanup)).rejects.toThrow();
  expect(cleanup).not.toHaveBeenCalled();
  await expect(withBookDataWrite('book', 300, async () => 'kept')).resolves.toBe('kept');
});

test('keeps a later manual map edit but never overwrites a newer restored workspace', async () => {
  await deleteBook();
  await tick();
  const draft = {
    version: 1 as const,
    bookId: 'book',
    revision: 0,
    activeId: 'draft',
    maps: [{ ...createMap('New idea'), id: 'draft' }],
  };
  await expect(saveMapWorkspace(draft, 0, newBookDataEdit())).rejects.toThrow(/preserved/i);
  await activateBookData('book', 300);
  const latest = {
    ...draft,
    maps: [
      {
        ...draft.maps[0]!,
        nodes: draft.maps[0]!.nodes.map((node) => ({ ...node, label: 'Newer restored idea' })),
      },
    ],
  };
  await saveMapWorkspace(latest, 300);
  const conflicts = await loadBookDataConflicts();
  expect(conflicts[0]).toMatchObject({ kind: 'mindmaps', data: draft });
  expect((await loadMapWorkspace('book')).maps[0]?.nodes[0]?.label).toBe('Newer restored idea');
});

test('retries are idempotent, different windows keep separate edits, and discard targets exactly one draft', async () => {
  await deleteBook();
  await tick();
  const first = newBookDataEdit(),
    second = newBookDataEdit();
  await expect(saveConversations(history(), 0, first)).rejects.toThrow();
  await expect(saveConversations(history(), 0, first)).rejects.toThrow();
  await expect(
    saveConversations(
      { ...history(), sessions: [{ id: 'session', title: 'Other window', turns: [] }] },
      0,
      second,
    ),
  ).rejects.toThrow();
  const drafts = await loadBookDataConflicts();
  expect(drafts).toHaveLength(2);
  await discardBookDataConflict(first.id);
  expect((await loadBookDataConflicts()).map((draft) => draft.id)).toEqual([second.id]);
  await expect(withBookDataWrite('book', 0, async () => {})).rejects.toThrow();
});

test('keeps a manual note from an old reader separate from a newer restored book, and excludes automatic backfill', async () => {
  const book: Book = {
    hash: 'book',
    title: 'Title',
    author: 'A',
    format: 'EPUB',
    createdAt: 1,
    updatedAt: 1,
  };
  const writeFile = vi.fn();
  const app = {
    saveBookConfig: async (row: Book, config: Parameters<typeof saveBookConfig>[2]) =>
      saveBookConfig({ writeFile } as unknown as Parameters<typeof saveBookConfig>[0], row, config),
    saveLibraryBooks: vi.fn(),
  } as unknown as AppService;
  const env = { getAppService: async () => app } as EnvConfigType;
  const note: BookNote = {
    id: 'note',
    type: 'annotation',
    cfi: 'epubcfi(/2/4)',
    note: 'My new note',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  useBookDataStore.setState({
    booksData: {
      book: {
        id: 'book',
        book,
        file: null,
        config: { updatedAt: 1 },
        bookDoc: null,
        isFixedLayout: false,
      },
    },
  });
  await deleteBook();
  await tick();
  await activateBookData('book', 300);
  const restored = {
    ...book,
    progress: [9, 10] as [number, number],
    removal: {
      version: 1 as const,
      id: 'restore',
      revision: 300,
      requestedAt: 300,
      mode: 'restore' as const,
      local: 'complete' as const,
      cloud: 'none' as const,
    },
  };
  useLibraryStore.getState().setLibrary([restored]);
  const config = useBookDataStore.getState().updateBooknotes('book', [note])!;
  await expect(
    useBookDataStore.getState().saveConfig(env, 'book', config, {} as SystemSettings),
  ).rejects.toThrow(/preserved/i);
  expect(writeFile).not.toHaveBeenCalled();
  expect(useLibraryStore.getState().library[0]?.progress).toEqual([9, 10]);
  const drafts = await loadBookDataConflicts();
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({ kind: 'notes', data: [note] });
  const automatic = useBookDataStore
    .getState()
    .updateBooknotes('book', [{ ...note, page: 5 }], false)!;
  await expect(
    useBookDataStore.getState().saveConfig(env, 'book', automatic, {} as SystemSettings),
  ).rejects.toThrow();
  expect(await loadBookDataConflicts()).toEqual(drafts);
});
