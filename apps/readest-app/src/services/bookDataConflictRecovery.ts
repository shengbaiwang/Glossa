import { z } from 'zod';
import { MAX_QUESTION_CHARS } from '@/glossa/conversation/schema';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { getConfigFilename } from '@/utils/book';
import { withLibraryLock } from './libraryLock';
import { bookRemovalIO } from './appBookRemoval';
import { loadRemovalBooks, bookRemovalVersion } from './bookRemovalService';
import { archiveRemoval } from './bookRemovalState';
import { saveLibraryBooksUnlocked } from './libraryService';
import { withBookDataRecovery } from './bookDataLifecycle';
import {
  loadBookDataConflicts,
  discardBookDataConflict,
  type BookDataConflict,
} from './bookDataConflicts';
import {
  validateHistory,
  hasUnsavedConversations,
  forgetPurgedConversations,
} from '@/glossa/conversation/store';
import { mapWorkspaceSchema } from '@/glossa/mindmap/workspace';
import { validateOrigins } from '@/glossa/mindmap/workspaceStore';

const noteSchema = z
  .object({
    id: z.string().min(1).max(500),
    type: z.enum(['bookmark', 'annotation', 'excerpt']),
    cfi: z.string().min(1).max(20000),
    note: z.string().max(1000000),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
    bookHash: z.string().optional(),
    metaHash: z.string().optional(),
    pdfRanges: z.array(z.string()).max(5000).optional(),
    xpointer0: z.string().optional(),
    xpointer1: z.string().optional(),
    page: z.number().int().nonnegative().optional(),
    text: z.string().optional(),
    style: z.enum(['highlight', 'underline', 'squiggly']).optional(),
    color: z.string().optional(),
    global: z.boolean().optional(),
    deletedAt: z.number().finite().nullable().optional(),
  })
  .passthrough();
const notesSchema = z.array(noteSchema).max(100000);
const configSchema = z.object({ booknotes: notesSchema.optional() }).passthrough();
const changed = () => new Error('Book data changed. Review the current data again.');
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
const keyFor = (draft: BookDataConflict, index: number) => `recovered_${draft.id}_${index}`;
type Store = 'conversations' | 'mindmaps';
const storage = {
  conversations: ['glossa-conversations', 'books'],
  mindmaps: ['glossa-map-workspaces', 'workspaces'],
} as const;
async function database(store: Store, bookId: string, value?: unknown): Promise<unknown> {
  const [name, table] = storage[store];
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(table, { keyPath: 'bookId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () =>
      reject(new Error('Could not read or restore book data.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(table, value === undefined ? 'readonly' : 'readwrite');
      const request =
        value === undefined ? tx.objectStore(table).get(bookId) : tx.objectStore(table).put(value);
      tx.oncomplete = () => resolve(request.result ?? null);
      tx.onerror = tx.onabort = () => reject(new Error('Could not restore book data.'));
    });
  } finally {
    db.close();
  }
}
function incoming(draft: BookDataConflict) {
  if (draft.kind === 'notes') {
    const notes = notesSchema.parse(draft.data);
    if (
      new Set(notes.map((n) => n.id)).size !== notes.length ||
      notes.some((n) => n.bookHash && n.bookHash !== draft.bookId)
    )
      throw changed();
    return notes;
  }
  if (draft.kind === 'mindmaps') {
    const workspace = mapWorkspaceSchema.parse(draft.data);
    if (workspace.bookId !== draft.bookId) throw changed();
    return workspace;
  }
  const question =
    draft.kind === 'question'
      ? z
          .object({
            version: z.literal(1),
            bookId: z.literal(draft.bookId),
            sessionId: z.string(),
            question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
            history: z.unknown(),
          })
          .strict()
          .parse(draft.data)
      : null;
  const history = validateHistory(question ? question.history : draft.data);
  if (
    history.bookId !== draft.bookId ||
    (question && !history.sessions.some((s) => s.id === question.sessionId))
  )
    throw changed();
  return question ? { ...question, history } : history;
}
async function currentData(app: AppService, draft: BookDataConflict, book: Book) {
  if (draft.kind === 'notes') {
    const raw = (await app.exists(getConfigFilename(book), 'Books'))
      ? ((await app.readFile(getConfigFilename(book), 'Books', 'text')) as string)
      : '{}';
    // Storage errors and malformed configurations must never be treated as an empty book.
    configSchema.parse(JSON.parse(raw));
    return raw;
  }
  if (draft.kind !== 'mindmaps' && hasUnsavedConversations(draft.bookId))
    throw new Error('Wait for the current conversation to finish saving, then retry.');
  const data = await database(
    draft.kind === 'mindmaps' ? 'mindmaps' : 'conversations',
    draft.bookId,
  );
  if (data !== null) {
    if (draft.kind === 'mindmaps') await validateOrigins(mapWorkspaceSchema.parse(data));
    else validateHistory(data);
  }
  return JSON.stringify(data);
}
function readable(draft: BookDataConflict, data: unknown): string {
  if (draft.kind === 'notes')
    return notesSchema
      .parse(data)
      .map((n) => [n.text, n.note].filter(Boolean).join('\n'))
      .join('\n\n');
  if (draft.kind === 'mindmaps')
    return mapWorkspaceSchema
      .parse(data)
      .maps.map((m) => m.nodes.map((n) => n.label).join('\n'))
      .join('\n\n');
  const history = validateHistory(data);
  return history.sessions
    .map((s) =>
      [
        s.title,
        ...s.turns.map((t) => [t.question, ...t.blocks.map((b) => b.text)].join('\n')),
        s.draft,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}
export interface ConflictRecoveryPreview {
  draft: BookDataConflict;
  book: Book;
  current: string;
  currentText: string;
  draftText: string;
}
export async function previewBookDataConflict(
  app: AppService,
  draft: BookDataConflict,
): Promise<ConflictRecoveryPreview> {
  const book = (await loadRemovalBooks(bookRemovalIO(app))).find((b) => b.hash === draft.bookId);
  if (!book || book.deletedAt || (book.removal && book.removal.mode !== 'restore'))
    throw new Error('Restore or reimport this book before restoring its drafts.');
  const data = incoming(draft);
  if (draft.kind === 'mindmaps') await validateOrigins(mapWorkspaceSchema.parse(data));
  const current = await currentData(app, draft, book);
  const currentValue: unknown = JSON.parse(current);
  const currentText =
    currentValue === null
      ? ''
      : draft.kind === 'notes'
        ? readable(draft, configSchema.parse(currentValue).booknotes ?? [])
        : readable(draft, currentValue);
  const draftText =
    draft.kind === 'question'
      ? z.object({ question: z.string() }).parse(data).question
      : readable(draft, data);
  return { draft: structuredClone(draft), book, current, currentText, draftText };
}
async function planRecovery(
  app: AppService,
  preview: ConflictRecoveryPreview,
  book: Book,
): Promise<() => Promise<void>> {
  const { draft } = preview;
  const data = incoming(draft);
  if (draft.kind === 'notes') {
    const config = configSchema.parse(JSON.parse(preview.current)),
      current = config.booknotes ?? [];
    const additions = notesSchema.parse(data).flatMap((n, i) => {
      if (current.some((existing) => JSON.stringify(existing) === JSON.stringify(n))) return [];
      const id = keyFor(draft, i);
      if (current.some((existing) => existing.id === id)) return [];
      return [{ ...n, id }];
    });
    const text = JSON.stringify({
      ...config,
      updatedAt: Date.now(),
      booknotes: notesSchema.parse([...current, ...additions]),
    });
    return async () => {
      await app.writeFile(getConfigFilename(book), 'Books', text);
    };
  } else if (draft.kind === 'mindmaps') {
    const source = mapWorkspaceSchema.parse(data);
    await validateOrigins(source);
    const current = mapWorkspaceSchema.parse(
      JSON.parse(preview.current) ?? {
        version: 1,
        bookId: book.hash,
        revision: 0,
        maps: [],
        activeId: null,
      },
    );
    const additions = source.maps.flatMap((m, i) =>
      current.maps.some((existing) => existing.id === keyFor(draft, i))
        ? []
        : [{ ...m, id: keyFor(draft, i) }],
    );
    const next = mapWorkspaceSchema.parse({
      ...current,
      revision: current.revision + 1,
      maps: [...current.maps, ...additions],
      activeId: additions[0]?.id ?? current.activeId,
    });
    return async () => {
      await database('mindmaps', book.hash, next);
    };
  } else {
    const question =
      draft.kind === 'question'
        ? z
            .object({ question: z.string(), sessionId: z.string(), history: z.unknown() })
            .parse(data)
        : null;
    const source = validateHistory(question ? question.history : data);
    const current =
      JSON.parse(preview.current) === null ? null : validateHistory(JSON.parse(preview.current));
    const sessions = current?.sessions ?? [];
    const additions = source.sessions
      .filter((s) => !question || s.id === question.sessionId)
      .flatMap((s, i) =>
        sessions.some((existing) => existing.id === keyFor(draft, i))
          ? []
          : [
              {
                ...s,
                id: keyFor(draft, i),
                ...(question ? { draft: question.question } : {}),
              },
            ],
      );
    const next = validateHistory({
      version: 1,
      bookId: book.hash,
      sessions: [...sessions, ...additions],
      activeId: additions[0]?.id ?? current?.activeId,
    });
    return async () => {
      await database('conversations', book.hash, next);
      forgetPurgedConversations(book.hash);
    };
  }
}
/** Import immutable copies. The reviewed current state is compared inside both write locks. */
export async function restoreBookDataConflict(
  app: AppService,
  preview: ConflictRecoveryPreview,
): Promise<Book[]> {
  const { draft } = preview,
    io = bookRemovalIO(app);
  return withLibraryLock(io, async () => {
    const rows = await loadRemovalBooks(io),
      index = rows.findIndex((b) => b.hash === draft.bookId),
      book = rows[index];
    const stored = (await loadBookDataConflicts()).find((d) => d.id === draft.id);
    if (
      !book ||
      book.deletedAt ||
      (book.removal && book.removal.mode !== 'restore') ||
      bookRemovalVersion(book) !== bookRemovalVersion(preview.book) ||
      canonical(stored) !== canonical(draft)
    )
      throw changed();
    let commit!: () => Promise<void>;
    return withBookDataRecovery(
      book.hash,
      book.removal?.revision ?? 0,
      async (revision, published) => {
        const previous = book.removal;
        rows[index] = {
          ...book,
          removalHistory: archiveRemoval(book, 'removal'),
          removal: {
            version: 1,
            id: crypto.randomUUID(),
            revision,
            requestedAt: revision,
            mode: 'restore',
            local: 'complete',
            cloud: !previous || previous.cloud === 'none' ? 'none' : 'pending',
            ...(previous?.cloudTargets
              ? {
                  cloudTargets: Object.fromEntries(
                    Object.keys(previous.cloudTargets).map((k) => [k, 'pending' as const]),
                  ),
                }
              : {}),
          },
        };
        await saveLibraryBooksUnlocked(io, rows, { replace: true });
        published();
        try {
          await commit();
        } finally {
          window.dispatchEvent(new Event('glossa-library-removal'));
        }
        // If discarding fails, deterministic copy IDs make another explicit retry safe.
        await discardBookDataConflict(draft.id);
        window.dispatchEvent(new Event('glossa-library-removal'));
        return rows;
      },
      async () => {
        if ((await currentData(app, draft, book)) !== preview.current) throw changed();
        commit = await planRecovery(app, preview, book);
      },
    );
  });
}
