import type { Book } from '@/types/book';
import { activateBookData } from './bookDataLifecycle';
import type { FileSystem } from '@/types/system';
import { mergeBookMetadata } from './sync/file/merge';
import { loadLibraryRows } from './libraryRepository';
import { withLibraryLock } from './libraryLock';
import { saveLibraryBooksUnlocked } from './libraryService';
import {
  archiveRemoval,
  bookRemovalSchema,
  BookRemovalError,
  isRecoverableRemoval,
  peerRemovalPatch,
  compareBookRemoval,
  type BookRemoval,
  type RemovalMode,
} from './bookRemovalState';

type RemovalIO = Pick<FileSystem, 'getPrefix' | 'readFile' | 'writeFile'>;
export interface RemovalResult {
  id: string;
  books: Book[];
  completed: string[];
  failed: string[];
  pending: string[];
}
export async function loadRemovalBooks(io: RemovalIO): Promise<Book[]> {
  let raw: unknown;
  try {
    raw = await loadLibraryRows(io, { strict: true });
  } catch {
    throw new Error('Could not verify the library. Reload before removing books.');
  }
  if (
    !Array.isArray(raw) ||
    raw.some(
      (b) =>
        !b ||
        typeof b.hash !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(b.hash) ||
        [b.removal, b.localRemoval].some(
          (value) => value !== undefined && !bookRemovalSchema.safeParse(value).success,
        ),
    )
  ) {
    throw new Error('Could not verify the library. Reload before removing books.');
  }
  return raw as Book[];
}
function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('glossa-library-removal'));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('glossa-library-removal');
    channel.postMessage('changed');
    channel.close();
  }
}
async function persist(io: RemovalIO, rows: Book[]) {
  await saveLibraryBooksUnlocked(io, rows, { replace: true });
  notify();
}
const clock = (rows: Book[]) =>
  rows.reduce(
    (now, b) => Math.max(now, (b.removal?.revision ?? 0) + 1, (b.localRemoval?.revision ?? 0) + 1),
    Date.now(),
  );
export const bookRemovalVersion = (book: Book) =>
  Math.max(book.updatedAt, book.removal?.revision ?? 0, book.localRemoval?.revision ?? 0);
const intents = (book: Book) =>
  [book.removal, book.localRemoval].filter((v): v is BookRemoval => !!v);
const fieldFor = (intent: BookRemoval) => (intent.mode === 'local' ? 'localRemoval' : 'removal');

/** One atomic library write records the complete, immutable set of target identities. */
export async function prepareRemoval(
  io: RemovalIO,
  hashes: string[],
  mode: RemovalMode,
  options: {
    cloud?: boolean;
    cloudTargets?: string[];
    expected?: Record<string, number>;
    allowConflict?: boolean;
  } = {},
): Promise<{ id: string; books: Book[] }> {
  return withLibraryLock(io, async () => {
    const rows = await loadRemovalBooks(io),
      wanted = new Set(hashes);
    if (!wanted.size || [...wanted].some((hash) => !rows.some((b) => b.hash === hash)))
      throw new Error('The selected books changed. Reload and try again.');
    const id = crypto.randomUUID(),
      now = clock(rows);
    const next = rows.map((b): Book => {
      if (!wanted.has(b.hash)) return b;
      if (options.expected && options.expected[b.hash] !== bookRemovalVersion(b))
        throw new Error('The selected books changed. Review them before removing.');
      if (
        intents(b).some(
          (intent) =>
            intent.local !== 'complete' &&
            !(mode === 'purge' && options.allowConflict && intent === b.removal && intent.conflict),
        )
      )
        throw new Error('Finish or retry the existing removal first.');
      if (b.removal?.mode === 'purge' && b.removal.local === 'complete')
        throw new Error('This book has already been permanently deleted.');
      if (mode === 'purge' && b.removal?.conflict && !options.allowConflict)
        throw new Error('This book has newer edits. Review the conflict before deleting.');
      return {
        ...b,
        deletedAt: b.deletedAt,
        removalHistory: archiveRemoval(b, mode === 'local' ? 'localRemoval' : 'removal'),
        [mode === 'local' ? 'localRemoval' : 'removal']: {
          version: 1,
          id,
          revision: now,
          requestedAt: now,
          mode,
          local: 'pending',
          cloud:
            mode !== 'local' && (options.cloud || options.cloudTargets?.length)
              ? 'pending'
              : 'none',
          ...(mode !== 'local' && options.cloudTargets?.length
            ? {
                cloudTargets: Object.fromEntries(
                  options.cloudTargets.map((kind) => [kind, 'pending']),
                ),
              }
            : {}),
        },
      };
    });
    await persist(io, next);
    return { id, books: next };
  });
}

/** Cancellation never rolls back completed work and never leaks into another operation. */
export async function runRemoval(
  io: RemovalIO,
  id: string,
  options: {
    clean: (book: Book, mode: 'purge' | 'local') => Promise<void>;
    signal?: AbortSignal;
    onProgress?: (result: RemovalResult) => void;
  },
): Promise<RemovalResult> {
  const targets = (await loadRemovalBooks(io))
    .filter((b) => intents(b).some((intent) => intent.id === id))
    .map((b) => b.hash);
  for (const hash of targets) {
    if (options.signal?.aborted) break;
    await withLibraryLock(io, async () => {
      if (options.signal?.aborted) return;
      const rows = await loadRemovalBooks(io),
        index = rows.findIndex((b) => b.hash === hash);
      const book = rows[index],
        intent = book && intents(book).find((v) => v.id === id);
      if (!book || !intent || intent.id !== id || intent.local === 'complete') return;
      if (intent.conflict && intent.mode === 'purge') return;
      const field = fieldFor(intent);
      try {
        // Trash is a reversible state change. Files and every personal sidecar stay in place.
        if (intent.mode === 'purge') {
          rows[index] = { ...book, deletedAt: intent.requestedAt };
          await persist(io, rows);
        }
        if (intent.mode === 'purge' || intent.mode === 'local')
          await options.clean({ ...book }, intent.mode);
        rows[index] = {
          ...book,
          deletedAt: intent.mode === 'local' ? book.deletedAt : intent.requestedAt,
          [field]: { ...intent, local: 'complete', failure: undefined },
          ...(intent.mode === 'local' || intent.mode === 'purge' ? { downloadedAt: null } : {}),
          ...(intent.mode === 'purge'
            ? {
                coverDownloadedAt: null,
                coverImageUrl: null,
                progress: undefined,
                tags: undefined,
                groupId: undefined,
                groupName: undefined,
                groupUpdatedAt: Math.max(Date.now(), (book.groupUpdatedAt ?? 0) + 1),
                metadata: undefined,
                readingStatus: undefined,
              }
            : {}),
        };
      } catch (error) {
        rows[index] = {
          ...rows[index]!,
          [field]: {
            ...intent,
            local: 'failed',
            failure: error instanceof BookRemovalError ? error.code : 'storage',
          },
        };
      }
      // If this write fails, pending intent remains durable and cleanup is safe to repeat.
      await persist(io, rows);
    });
    options.onProgress?.(await removalResult(io, id));
  }
  return removalResult(io, id);
}
export async function removalResult(io: RemovalIO, id: string): Promise<RemovalResult> {
  const books = await loadRemovalBooks(io);
  const by = (state: BookRemoval['local']) =>
    books
      .filter((b) =>
        [...intents(b), ...(b.removalHistory ?? [])].some(
          (intent) => intent.id === id && intent.local === state,
        ),
      )
      .map((b) => b.hash);
  return { id, books, completed: by('complete'), failed: by('failed'), pending: by('pending') };
}

/** Read latest rows under the same lock; never replace metadata or reading progress with an undo snapshot. */
export async function restoreRemovedBooks(io: RemovalIO, hashes: string[]): Promise<Book[]> {
  return withLibraryLock(io, async () => {
    const rows = await loadRemovalBooks(io),
      wanted = new Set(hashes),
      now = clock(rows);
    if ([...wanted].some((hash) => !rows.some((b) => b.hash === hash && isRecoverableRemoval(b))))
      throw new Error('Only books in Recently Deleted can be restored.');
    const next = rows.map(
      (b): Book =>
        !wanted.has(b.hash)
          ? b
          : {
              ...b,
              deletedAt: null,
              removalHistory: archiveRemoval(b, 'removal'),
              removal: {
                version: 1,
                id: crypto.randomUUID(),
                revision: now,
                requestedAt: now,
                mode: 'restore',
                local: 'complete',
                cloud: b.removal?.cloud === 'none' ? 'none' : 'pending',
                ...(b.removal?.cloudTargets
                  ? {
                      cloudTargets: Object.fromEntries(
                        Object.keys(b.removal.cloudTargets).map((kind) => [kind, 'pending']),
                      ),
                    }
                  : {}),
              },
            },
    );
    for (const book of next)
      if (wanted.has(book.hash)) await activateBookData(book.hash, book.removal!.revision);
    await persist(io, next);
    return next;
  });
}

/** Receipts patch only device-local status, and cannot acknowledge a later restore. */
export async function acknowledgeRemoval(
  io: RemovalIO,
  snapshot: Book,
  backend: string,
  status: 'complete' | 'failed',
): Promise<Book[]> {
  return withLibraryLock(io, async () => {
    const rows = await loadRemovalBooks(io);
    const next = rows.map((book): Book => {
      const intent = book.removal;
      if (
        book.hash !== snapshot.hash ||
        !intent ||
        intent.id !== snapshot.removal?.id ||
        intent.revision !== snapshot.removal?.revision
      )
        return book;
      const cloudTargets = { ...(intent.cloudTargets ?? {}), [backend]: status };
      const values = Object.values(cloudTargets);
      const cloud = values.includes('failed')
        ? 'failed'
        : values.every((state) => state === 'complete')
          ? 'complete'
          : 'pending';
      return { ...book, removal: { ...intent, cloud, cloudTargets } };
    });
    if (JSON.stringify(next) !== JSON.stringify(rows)) await persist(io, next);
    return next;
  });
}

/** Re-read current personal data under the write lock before accepting a peer's intent. */
export async function applyPeerRemoval(
  io: RemovalIO,
  remote: Book,
  clean: (book: Book, mode: 'purge' | 'local') => Promise<void>,
  cloudTargets: string[] = [],
): Promise<Book> {
  const accepted = await withLibraryLock(io, async () => {
    const rows = await loadRemovalBooks(io),
      index = rows.findIndex((b) => b.hash === remote.hash);
    const local = rows[index] ?? {
      ...remote,
      removal: undefined,
      updatedAt: 0,
      downloadedAt: null,
      coverDownloadedAt: null,
      filePath: undefined,
      altFilePaths: undefined,
      coverImageUrl: null,
    };
    if (compareBookRemoval(local, remote) > 0) return local;
    const patch = peerRemovalPatch(local, remote);
    let merged: Book = { ...mergeBookMetadata(local, remote), ...patch };
    if (patch.removal && cloudTargets.length)
      merged = {
        ...merged,
        removal: {
          ...patch.removal,
          cloud: 'pending',
          cloudTargets: Object.fromEntries(cloudTargets.map((kind) => [kind, 'pending'])),
        },
      };
    if (!merged.removal) throw new Error('Unrecognized removal intent');
    if (merged.removal.mode === 'restore' || merged.removal.conflict)
      await activateBookData(merged.hash, merged.removal.revision);
    if (index < 0) rows.push(merged);
    else rows[index] = merged;
    await persist(io, rows);
    return merged;
  });
  if (
    accepted.removal?.mode !== 'restore' &&
    !accepted.removal?.conflict &&
    accepted.removal?.local !== 'complete'
  ) {
    await runRemoval(io, accepted.removal!.id, { clean });
  }
  return (await loadRemovalBooks(io)).find((b) => b.hash === remote.hash)!;
}

/** Keep the lifecycle stable across a destructive remote request from this device. */
export async function withCurrentRemoval(
  io: RemovalIO,
  snapshot: Book,
  action: () => Promise<void>,
): Promise<boolean> {
  return withLibraryLock(io, async () => {
    const current = (await loadRemovalBooks(io)).find((b) => b.hash === snapshot.hash);
    if (
      !current ||
      current.removal?.id !== snapshot.removal?.id ||
      current.removal?.revision !== snapshot.removal?.revision ||
      current.removal?.mode !== 'purge' ||
      current.removal.local !== 'complete' ||
      current.removal.conflict
    )
      return false;
    await action();
    return true;
  });
}
