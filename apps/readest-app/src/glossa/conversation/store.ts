import { z } from 'zod';
import { validateProviderConfig } from '@/glossa/ai/provider';
import { ConversationError, turnSchema, validBlockSources, type ConversationTurn } from './schema';
import { stubTranslation as _ } from '@/utils/misc';

const sessionSchema = z
  .object({
    version: z.literal(1),
    bookId: z.string().min(1).max(500),
    sessions: z
      .array(z.object({ id: z.string().min(1), turns: z.array(turnSchema).max(40) }).strict())
      .max(20),
    activeId: z.string().min(1),
  })
  .strict();
export type ConversationHistory = z.infer<typeof sessionSchema>;
let database: Promise<IDBDatabase> | undefined;
const pending = new Map<string, ConversationHistory>();
const queues = new Map<string, Promise<void>>();
const storageError = () =>
  new ConversationError(_('Conversations could not be saved or read on this device.'));

export function validateHistory(raw: unknown): ConversationHistory {
  const history = sessionSchema.parse(raw);
  if (
    !history.sessions.some((s) => s.id === history.activeId) ||
    new Set(history.sessions.map((s) => s.id)).size !== history.sessions.length
  )
    throw storageError();
  for (const session of history.sessions)
    for (const turn of session.turns) {
      validateProviderConfig(turn.provider);
      if (!validBlockSources(turn.blocks, turn.sources)) throw storageError();
      if (turn.context) {
        const ids = new Set(turn.sources.map((source) => source.sourceId));
        if (
          turn.sources.reduce((n, source) => n + source.text.length, 0) > turn.context.budget ||
          [
            ...turn.context.history.flatMap((item) => item.sourceIds),
            ...(turn.context.selectedSourceIds ?? []),
            ...Object.keys(turn.context.sourceTitles ?? {}),
          ].some((id) => !ids.has(id))
        )
          throw storageError();
      }
    }
  return history;
}
function openDatabase(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('glossa-conversations', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('books', { keyPath: 'bookId' });
      request.onerror = request.onblocked = () => reject(storageError());
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
    }).catch(() => {
      database = undefined;
      throw storageError();
    });
  return database;
}
export async function loadConversations(bookId: string): Promise<ConversationHistory | null> {
  if (pending.has(bookId)) return structuredClone(pending.get(bookId)!);
  try {
    const db = await openDatabase();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('books', 'readonly');
      const request = tx.objectStore('books').get(bookId);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(storageError());
    });
    if (pending.has(bookId)) return structuredClone(pending.get(bookId)!);
    if (raw === undefined) return null;
    const history = validateHistory(raw);
    if (history.bookId !== bookId) throw storageError();
    return history;
  } catch {
    throw storageError();
  }
}
export function hasUnsavedConversations(bookId: string): boolean {
  return pending.has(bookId);
}
export function saveConversations(input: ConversationHistory): Promise<void> {
  const history = structuredClone(validateHistory(input));
  pending.set(history.bookId, history);
  const save = (queues.get(history.bookId) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      try {
        const db = await openDatabase();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('books', 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => reject(storageError());
          tx.objectStore('books').put(history);
        });
        if (pending.get(history.bookId) === history) pending.delete(history.bookId);
      } catch {
        throw storageError();
      }
    });
  queues.set(history.bookId, save);
  void save
    .finally(() => {
      if (queues.get(history.bookId) === save) queues.delete(history.bookId);
    })
    .catch(() => {});
  return save;
}
export function appendConversationTurn(
  history: ConversationHistory,
  turn: ConversationTurn,
): ConversationHistory {
  return {
    ...history,
    sessions: history.sessions.map((s) =>
      s.id === history.activeId ? { ...s, turns: [...s.turns, turn] } : s,
    ),
  };
}
