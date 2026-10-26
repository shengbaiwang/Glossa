import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { getConfigFilename, getBookNavFilename, getLibraryFilename } from '@/utils/book';
import { md5 } from '@/utils/md5';
import { fingerprintBook, contentIdentity } from './bookIdentity';
import { safeLoadJSON, safeSaveJSON } from './persistence';
import { saveLibraryBooksUnlocked } from './libraryService';
import { withLibraryLock } from './libraryLock';

type DuplicateIO = Pick<
  FileSystem,
  'getPrefix' | 'readFile' | 'writeFile' | 'exists' | 'openFile' | 'readDir'
>;
const UNDO_FILE = 'duplicate-review-undo.json';

export interface DuplicateCandidate {
  book: Book;
  revision: string;
  notes: number;
  notePreviews: string[];
  location?: string;
  hasContents: boolean;
}
export interface DuplicateGroup {
  fingerprint: string;
  candidates: DuplicateCandidate[];
}
interface UndoEntry {
  hash: string;
  before?: string;
  after?: string;
  clock: number;
}
interface UndoRecord {
  version: 1;
  entries: UndoEntry[];
}

async function readOptional(io: DuplicateIO, path: string): Promise<string | null> {
  if (!(await io.exists(path, 'Books'))) return null;
  return (await io.readFile(path, 'Books', 'text')) as string;
}

async function candidate(io: DuplicateIO, book: Book): Promise<DuplicateCandidate> {
  const config = await readOptional(io, getConfigFilename(book));
  const nav = await readOptional(io, getBookNavFilename(book));
  // Invalid personal sidecars block cleanup; never present them as empty data.
  const data = config ? (JSON.parse(config) as { booknotes?: unknown[]; location?: string }) : {};
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Invalid book config');
  if (nav !== null) JSON.parse(nav);
  const notes = (Array.isArray(data.booknotes) ? data.booknotes : []).filter(
    (value): value is Record<string, unknown> =>
      !!value && typeof value === 'object' && !('deletedAt' in value && value.deletedAt),
  );
  const { coverImageUrl: _cover, ...persisted } = book;
  return {
    book,
    revision: md5(JSON.stringify([persisted, config, nav])),
    notes: notes.length,
    notePreviews: notes
      .slice(0, 3)
      .map((note) =>
        [note['note'], note['text']]
          .filter((value): value is string => typeof value === 'string' && !!value.trim())
          .join(' · ')
          .slice(0, 160),
      )
      .filter(Boolean),
    location: typeof data.location === 'string' ? data.location : undefined,
    hasContents: nav !== null,
  };
}

async function verifiedIdentity(io: DuplicateIO, book: Book, signal?: AbortSignal) {
  const actual = await fingerprintBook(io, book, signal, !!contentIdentity(book));
  if (!actual) return undefined;
  const expected = book.storedContentFingerprint ?? contentIdentity(book);
  if (expected && expected !== actual)
    throw new Error('Book file changed; import the new version first');
  return contentIdentity(book) ?? actual;
}

/** Explicit, read-only scan. Unavailable files are reported, never guessed from metadata. */
export async function previewDuplicateBooks(
  io: DuplicateIO,
  books: Book[],
  options: {
    signal?: AbortSignal;
    onProgress?: (current: number, total: number) => void;
  } = {},
): Promise<{ groups: DuplicateGroup[]; unavailable: number }> {
  const active = books.filter((book) => !book.deletedAt);
  const groups = new Map<string, DuplicateCandidate[]>();
  let unavailable = 0;
  for (const [index, book] of active.entries()) {
    options.signal?.throwIfAborted();
    try {
      const fingerprint = await verifiedIdentity(io, book, options.signal);
      if (!fingerprint) unavailable++;
      else {
        const rows = groups.get(fingerprint) ?? [];
        rows.push(await candidate(io, book));
        groups.set(fingerprint, rows);
      }
    } catch {
      options.signal?.throwIfAborted();
      unavailable++;
    }
    options.onProgress?.(index + 1, active.length);
  }
  return {
    groups: [...groups]
      .filter(([, rows]) => rows.length > 1)
      .map(([fingerprint, candidates]) => ({ fingerprint, candidates })),
    unavailable,
  };
}

/** Choose the whole personal record to keep visible; retain every other record and sidecar. */
export async function applyDuplicateChoice(
  io: DuplicateIO,
  group: DuplicateGroup,
  keepHash: string,
): Promise<Book[]> {
  return withLibraryLock(io, async () => {
    if (!group.candidates.some(({ book }) => book.hash === keepHash))
      throw new Error('Invalid duplicate choice');
    const library = await safeLoadJSON<Book[]>(io, getLibraryFilename(), 'Books', []);
    const changes: Book[] = [];
    const entries: UndoEntry[] = [];
    for (const preview of group.candidates) {
      const live = library.find((book) => book.hash === preview.book.hash);
      if (
        !live ||
        live.deletedAt ||
        (await candidate(io, live)).revision !== preview.revision ||
        (await verifiedIdentity(io, live)) !== group.fingerprint
      ) {
        throw new Error('Library changed; check duplicates again');
      }
      const duplicateOf = live.hash === keepHash ? undefined : keepHash;
      if (live.duplicateOf === duplicateOf) continue;
      const clock = Math.max(Date.now(), (live.duplicateUpdatedAt ?? 0) + 1);
      entries.push({ hash: live.hash, before: live.duplicateOf, after: duplicateOf, clock });
      changes.push({ ...live, duplicateOf, duplicateUpdatedAt: clock });
    }
    if (changes.length) {
      // Journal first: an interruption between these writes remains safely undoable.
      await safeSaveJSON(io, UNDO_FILE, 'Books', { version: 1, entries } satisfies UndoRecord);
      await saveLibraryBooksUnlocked(io, changes);
    }
    return safeLoadJSON<Book[]>(io, getLibraryFilename(), 'Books', []);
  });
}

/** Field-scoped undo preserves reading and metadata edits made after cleanup. */
export async function undoDuplicateChoice(io: DuplicateIO): Promise<Book[]> {
  return withLibraryLock(io, async () => {
    const undo = await safeLoadJSON<UndoRecord | null>(io, UNDO_FILE, 'Books', null);
    const library = await safeLoadJSON<Book[]>(io, getLibraryFilename(), 'Books', []);
    if (!undo || undo.version !== 1 || !Array.isArray(undo.entries)) return library;
    const changes: Book[] = [];
    for (const entry of undo.entries) {
      const live = library.find((book) => book.hash === entry.hash);
      if (!live || live.duplicateUpdatedAt !== entry.clock || live.duplicateOf !== entry.after) {
        throw new Error('Duplicate choice changed; check duplicates again');
      }
      changes.push({
        ...live,
        duplicateOf: entry.before,
        duplicateUpdatedAt: Math.max(Date.now(), entry.clock + 1),
      });
    }
    await saveLibraryBooksUnlocked(io, changes);
    await safeSaveJSON(io, UNDO_FILE, 'Books', null);
    return safeLoadJSON<Book[]>(io, getLibraryFilename(), 'Books', []);
  });
}
