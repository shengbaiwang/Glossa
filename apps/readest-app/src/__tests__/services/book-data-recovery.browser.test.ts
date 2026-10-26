import { afterEach, expect, test } from 'vitest';
import {
  previewBookDataConflict,
  restoreBookDataConflict,
} from '@/services/bookDataConflictRecovery';
import {
  saveBookDataConflict,
  loadBookDataConflicts,
  newBookDataEdit,
} from '@/services/bookDataConflicts';
import { saveConversations, loadConversations } from '@/glossa/conversation/store';
import { createMap } from '@/glossa/mindmap/workspace';
import { saveMapWorkspace, loadMapWorkspace } from '@/glossa/mindmap/workspaceStore';
import { withBookDataWrite } from '@/services/bookDataLifecycle';
import { getConfigFilename, getLibraryFilename } from '@/utils/book';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';

const book: Book = {
  hash: 'recovery-book',
  title: 'Original',
  author: 'A',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};
function fixture() {
  const files = new Map<string, string>([
    [getLibraryFilename(), JSON.stringify([book])],
    [
      getConfigFilename(book),
      JSON.stringify({ updatedAt: 1, progress: [8, 10], custom: 'keep', booknotes: [] }),
    ],
  ]);
  const app = {
    resolveFilePath: async () => 'recovery-library',
    exists: async (path: string) => files.has(path),
    readFile: async (path: string) => {
      if (!files.has(path)) throw new Error('missing');
      return files.get(path)!;
    },
    writeFile: async (path: string, _base: string, data: string) => {
      files.set(path, data);
    },
  } as unknown as AppService;
  const draft = (kind: 'notes' | 'conversations' | 'question' | 'mindmaps', data: unknown) => ({
    ...newBookDataEdit(),
    version: 1 as const,
    bookId: book.hash,
    kind,
    cutoff: 200,
    dataRevision: 0,
    data,
  });
  return { app, files, draft };
}
afterEach(async () => {
  for (const name of [
    'glossa-book-data-lifecycle',
    'glossa-book-data-conflicts',
    'glossa-conversations',
    'glossa-map-workspaces',
  ]) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
});
test('compares latest notes, imports conflicting copies without replacing progress, and blocks the old reader', async () => {
  const { app, files, draft } = fixture();
  const note = {
    id: 'same',
    type: 'annotation',
    cfi: 'epubcfi(/2/4)',
    note: 'Newer current note',
    createdAt: 1,
    updatedAt: 2,
  };
  files.set(
    getConfigFilename(book),
    JSON.stringify({ progress: [8, 10], custom: 'keep', booknotes: [note] }),
  );
  const conflict = draft('notes', [{ ...note, note: 'Preserved draft' }]);
  await saveBookDataConflict(conflict);
  const preview = await previewBookDataConflict(app, conflict);
  expect(preview.currentText).toContain('Newer current note');
  expect(preview.draftText).toContain('Preserved draft');
  await restoreBookDataConflict(app, preview);
  const saved = JSON.parse(files.get(getConfigFilename(book))!);
  expect(saved).toMatchObject({ progress: [8, 10], custom: 'keep' });
  expect(saved.booknotes.map((n: { note: string }) => n.note)).toEqual([
    'Newer current note',
    'Preserved draft',
  ]);
  expect(saved.booknotes[0].id).toBe('same');
  expect(saved.booknotes[1].id).not.toBe('same');
  expect(await loadBookDataConflicts()).toEqual([]);
  await expect(withBookDataWrite(book.hash, 0, async () => {})).rejects.toThrow();
});
test('rejects a stale comparison and malformed or cross-book payloads before writing', async () => {
  const { app, files, draft } = fixture();
  const conflict = draft('notes', [
    {
      id: 'one',
      type: 'annotation',
      cfi: 'epubcfi(/2/4)',
      note: 'Draft',
      createdAt: 1,
      updatedAt: 2,
    },
  ]);
  await saveBookDataConflict(conflict);
  const preview = await previewBookDataConflict(app, conflict);
  files.set(getConfigFilename(book), JSON.stringify({ booknotes: [], progress: [9, 10] }));
  await expect(restoreBookDataConflict(app, preview)).rejects.toThrow(/changed/i);
  expect(await loadBookDataConflicts()).toHaveLength(1);
  await expect(
    previewBookDataConflict(
      app,
      draft('notes', [
        {
          ...{
            id: 'one',
            type: 'annotation',
            cfi: 'epubcfi(/2/4)',
            note: 'Draft',
            createdAt: 1,
            updatedAt: 2,
          },
          bookHash: 'another-book',
        },
      ]),
    ),
  ).rejects.toThrow();
  await expect(
    previewBookDataConflict(app, draft('mindmaps', { version: 1, bookId: 'other' })),
  ).rejects.toThrow();
});
test('restores conversation sessions and questions as separate editable copies without model calls', async () => {
  const { app, draft } = fixture();
  const history = {
    version: 1 as const,
    bookId: book.hash,
    activeId: 'session',
    sessions: [{ id: 'session', title: 'Current title', turns: [] }],
  };
  await saveConversations(history);
  const conflict = draft('conversations', {
    ...history,
    sessions: [{ ...history.sessions[0], title: 'Draft title' }],
  });
  await saveBookDataConflict(conflict);
  await restoreBookDataConflict(app, await previewBookDataConflict(app, conflict));
  let rows = JSON.parse(
    (await app.readFile(getLibraryFilename(), 'Books', 'text')) as string,
  ) as Book[];
  const restored = (await loadConversations(book.hash, rows[0]!.removal!.revision))!;
  expect(restored.sessions.map((s) => s.title)).toEqual(['Current title', 'Draft title']);
  const question = draft('question', {
    version: 1,
    bookId: book.hash,
    sessionId: 'session',
    question: 'My unsent question',
    history,
  });
  await saveBookDataConflict(question);
  await restoreBookDataConflict(app, await previewBookDataConflict(app, question));
  rows = JSON.parse(
    (await app.readFile(getLibraryFilename(), 'Books', 'text')) as string,
  ) as Book[];
  const final = (await loadConversations(book.hash, rows[0]!.removal!.revision))!;
  expect(final.sessions.find((s) => s.id === final.activeId)?.draft).toBe('My unsent question');
  expect(final.sessions).toHaveLength(3);
});
test('copies a reviewed map while retaining current edits and separate drafts', async () => {
  const { app, draft } = fixture();
  const map = createMap('Current idea');
  const workspace = {
    version: 1 as const,
    bookId: book.hash,
    revision: 0,
    activeId: map.id,
    maps: [map],
  };
  await saveMapWorkspace(workspace);
  const conflict = draft('mindmaps', {
    ...workspace,
    maps: [{ ...map, nodes: map.nodes.map((n) => ({ ...n, label: 'Draft idea' })) }],
  });
  await saveBookDataConflict(conflict);
  const other = draft('notes', []);
  await saveBookDataConflict(other);
  await restoreBookDataConflict(app, await previewBookDataConflict(app, conflict));
  expect((await loadMapWorkspace(book.hash)).maps.map((m) => m.nodes[0]?.label)).toEqual([
    'Current idea',
    'Draft idea',
  ]);
  expect((await loadBookDataConflicts()).map((d) => d.id)).toEqual([other.id]);
});

test('keeps a failed recovery draft and retries without duplicating a copy or losing current progress', async () => {
  const { app, files, draft } = fixture();
  const conflict = draft('notes', [
    {
      id: 'one',
      type: 'annotation',
      cfi: 'epubcfi(/2/4)',
      note: 'Draft',
      createdAt: 1,
      updatedAt: 2,
    },
  ]);
  await saveBookDataConflict(conflict);
  const preview = await previewBookDataConflict(app, conflict);
  const write = app.writeFile.bind(app);
  app.writeFile = async (...args) => {
    if (args[0] === getLibraryFilename()) throw new Error('disk full');
    return write(...args);
  };
  await expect(restoreBookDataConflict(app, preview)).rejects.toThrow('disk full');
  expect(await loadBookDataConflicts()).toHaveLength(1);
  app.writeFile = write;
  await restoreBookDataConflict(app, await previewBookDataConflict(app, conflict));
  const config = JSON.parse(files.get(getConfigFilename(book))!);
  expect(config.booknotes).toHaveLength(1);
  expect(config.progress).toEqual([8, 10]);
  expect(await loadBookDataConflicts()).toHaveLength(0);
});

test('validates capacity before changing the writer generation and leaves current data usable', async () => {
  const { app, draft } = fixture();
  const history = {
    version: 1 as const,
    bookId: book.hash,
    activeId: 's0',
    sessions: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, turns: [] })),
  };
  await saveConversations(history);
  const conflict = draft('conversations', { ...history, sessions: [history.sessions[0]] });
  await saveBookDataConflict(conflict);
  await expect(
    restoreBookDataConflict(app, await previewBookDataConflict(app, conflict)),
  ).rejects.toThrow();
  expect((await loadConversations(book.hash))?.sessions).toHaveLength(20);
  await withBookDataWrite(book.hash, 0, async () => {});
  expect(await loadBookDataConflicts()).toHaveLength(1);
});
test('a failed data write keeps the published generation usable and retains the draft for retry', async () => {
  const { app, files, draft } = fixture();
  const conflict = draft('notes', [
    {
      id: 'one',
      type: 'annotation',
      cfi: 'epubcfi(/2/4)',
      note: 'Draft',
      createdAt: 1,
      updatedAt: 2,
    },
  ]);
  await saveBookDataConflict(conflict);
  const write = app.writeFile.bind(app);
  app.writeFile = async (...args) => {
    if (args[0] === getConfigFilename(book)) throw new Error('disk full');
    return write(...args);
  };
  await expect(
    restoreBookDataConflict(app, await previewBookDataConflict(app, conflict)),
  ).rejects.toThrow('disk full');
  const revision = JSON.parse(files.get(getLibraryFilename())!)[0].removal.revision;
  await withBookDataWrite(book.hash, revision, async () => {});
  expect(await loadBookDataConflicts()).toHaveLength(1);
  app.writeFile = write;
  await restoreBookDataConflict(app, await previewBookDataConflict(app, conflict));
  expect(JSON.parse(files.get(getConfigFilename(book))!).booknotes).toHaveLength(1);
});
