import type { Book } from '@/types/book';
import type { DatabaseService } from '@/types/database';
import type { FileSystem } from '@/types/system';
import { getLibraryFilename } from '@/utils/book';
import { safeLoadJSON, safeSaveJSON, type JSONFileSystem } from './persistence';

export const LIBRARY_DATABASE_FILENAME = '.glossa-library.db';
type LibraryIO = JSONFileSystem & Partial<Pick<FileSystem, 'getPrefix' | 'exists'>>;
type OpenDatabase = (prefix: string) => Promise<DatabaseService>;
const openers = new WeakMap<object, OpenDatabase>();
const connections = new WeakMap<object, Map<string, Promise<DatabaseService>>>();
const TABLE = 'glossa_library_entries';
const MARKER = 'meta:version';

/** The host supplies an already scoped database; mock/in-memory FS retain JSON. */
export function registerLibraryDatabase(owner: object, open: OpenDatabase): void {
  openers.set(owner, open);
}

/** Authority is a runtime capability, independent of whether its DB file exists yet. */
export function isLibraryDatabaseRegistered(owner: object): boolean {
  return openers.has(owner);
}

export function getLibraryDatabasePath(prefix: string): string {
  return scopedPath(prefix, LIBRARY_DATABASE_FILENAME);
}

function scopedPath(prefix: string, filename: string): string {
  return prefix ? `${prefix.replace(/[\\/]+$/, '')}/${filename}` : filename;
}

/** Preserve the backend when a channel wraps AppService as a narrow IO adapter. */
export function inheritLibraryDatabase(owner: object, adapter: object): void {
  const open = openers.get(owner);
  if (!open) return;
  registerLibraryDatabase(adapter, open);
  // Narrow IO wrappers are short lived. Share their owner's scoped connection
  // cache instead of opening another connection on every sync/delete request.
  let scopes = connections.get(owner);
  if (!scopes) connections.set(owner, (scopes = new Map()));
  connections.set(adapter, scopes);
}

function assertRows(raw: unknown): asserts raw is Book[] {
  if (
    !Array.isArray(raw) ||
    raw.some(
      (row) => !row || typeof row.hash !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(row.hash),
    ) ||
    new Set(raw.map((row) => row.hash)).size !== raw.length
  )
    throw new Error('Could not verify the library. Reload before changing books.');
}

async function legacyMigrationRows(io: LibraryIO, prefix: string): Promise<Book[]> {
  let found = false;
  for (const filename of [getLibraryFilename(), `${getLibraryFilename()}.bak`]) {
    const path = scopedPath(prefix, filename);
    const base = prefix ? 'None' : 'Books';
    if (io.exists && !(await io.exists(path, base))) continue;
    found = true;
    try {
      const raw: unknown = JSON.parse((await io.readFile(path, base, 'text')) as string);
      assertRows(raw);
      return raw;
    } catch {
      // A valid backup can recover the main file, but neither may silently become [].
    }
  }
  if (found) throw new Error('Could not migrate the library: no valid library snapshot.');
  return [];
}

interface Entry {
  key: string;
  payload: string | null;
  fingerprint: string | null;
}
const entry = (book: Book): Entry => ({
  key: `book:${book.hash}`,
  payload: JSON.stringify(book),
  fingerprint: book.contentFingerprint ?? null,
});

/** One bound SQL statement is atomic on all adapters, including across IPC. */
async function upsert(db: DatabaseService, entries: Entry[], migrate = false): Promise<void> {
  if (!entries.length) return;
  await db.execute(
    `INSERT INTO ${TABLE} (key, payload, fingerprint)
     SELECT json_extract(value, '$.key'), json_extract(value, '$.payload'),
            json_extract(value, '$.fingerprint')
     FROM json_each(?)
     WHERE ${migrate ? `NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE key = '${MARKER}')` : '1'}
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload,
                                   fingerprint = excluded.fingerprint`,
    [JSON.stringify(entries)],
  );
}

async function database(io: LibraryIO): Promise<DatabaseService | undefined> {
  const prefix = (await io.getPrefix?.('Books')) ?? '';
  const open = openers.get(io);
  if (!open) return undefined;
  let scopes = connections.get(io);
  if (!scopes) connections.set(io, (scopes = new Map()));
  let pending = scopes.get(prefix);
  if (!pending) {
    pending = (async () => {
      const db = await open(prefix);
      try {
        await db.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (
          key TEXT PRIMARY KEY, payload TEXT, fingerprint TEXT
        )`);
        await db.execute(
          `CREATE INDEX IF NOT EXISTS glossa_library_fingerprint ON ${TABLE}(fingerprint)`,
        );
        const marker = await db.select<{ payload: string }>(
          `SELECT payload FROM ${TABLE} WHERE key = ?`,
          [MARKER],
        );
        if (!marker.length) {
          const rows = await legacyMigrationRows(io, prefix);
          await upsert(
            db,
            [
              ...rows.map(entry),
              { key: MARKER, payload: JSON.stringify({ version: 1 }), fingerprint: null },
            ],
            true,
          );
        }
        // A concurrent initializer may have won the migration statement.
        const committed = await db.select<{ payload: string }>(
          `SELECT payload FROM ${TABLE} WHERE key = ?`,
          [MARKER],
        );
        if (!committed.length || JSON.parse(committed[0]!.payload).version !== 1) {
          throw new Error('Unsupported library database version.');
        }
        return db;
      } catch (error) {
        await db.close?.().catch(() => {});
        throw error;
      }
    })();
    scopes.set(prefix, pending);
    void pending.catch(() => {
      if (scopes.get(prefix) === pending) scopes.delete(prefix);
    });
  }
  const db = await pending;
  if (((await io.getPrefix?.('Books')) ?? '') !== prefix) {
    // Keep the correctly scoped connection cached. Closing a native path here
    // would also remove that path from the app-wide pool used by other windows.
    throw new Error('Library directory changed. Please retry.');
  }
  return db;
}

/** Read the sole authority. Database failures never fall back to stale JSON. */
export async function loadLibraryRows(
  io: LibraryIO,
  options?: { strict?: boolean },
): Promise<Book[]> {
  const db = await database(io);
  if (!db) {
    if (!options?.strict) return safeLoadJSON<Book[]>(io, getLibraryFilename(), 'Books', []);
    const raw: unknown = JSON.parse(
      (await io.readFile(getLibraryFilename(), 'Books', 'text')) as string,
    );
    assertRows(raw);
    return raw;
  }
  const rows = await db.select<{ payload: string }>(
    `SELECT payload FROM ${TABLE} WHERE key LIKE 'book:%' AND payload IS NOT NULL ORDER BY rowid`,
  );
  const books: unknown = rows.map((row) => JSON.parse(row.payload));
  assertRows(books);
  return books;
}

/** Caller holds the library lock. Only changed rows reach the database. */
export async function writeLibraryRows(
  io: LibraryIO,
  books: Book[],
  previous?: Book[],
): Promise<void> {
  const db = await database(io);
  if (!db) {
    await safeSaveJSON(io, getLibraryFilename(), 'Books', books);
    return;
  }
  assertRows(books);
  const current = previous ?? (await loadLibraryRows(io));
  const old = new Map(current.map((book) => [book.hash, book]));
  const entries: Entry[] = [];
  for (const book of books) {
    const previous = old.get(book.hash);
    // Merge-floor callers retain untouched row objects. Avoid serializing
    // those rows just to discover that their database value is unchanged.
    if (book !== previous) {
      const row = entry(book);
      if (row.payload !== (previous && JSON.stringify(previous))) entries.push(row);
    }
    old.delete(book.hash);
  }
  for (const hash of old.keys())
    entries.push({ key: `book:${hash}`, payload: null, fingerprint: null });
  await upsert(db, entries);
}
