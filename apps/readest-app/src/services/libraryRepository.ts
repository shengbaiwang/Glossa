import { useSettingsStore } from '@/store/settingsStore';
import { isVaultId } from './sync/providers/icloud/vault';
import { withLibraryLock } from './libraryLock';
import type { CatalogJournal } from './sync/providers/icloud/catalogJournal';
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
async function upsert(
  db: DatabaseService,
  entries: Entry[],
  migrate = false,
  journal: string[] = [],
): Promise<void> {
  if (!entries.length) return;
  const statement = `INSERT INTO ${TABLE} (key, payload, fingerprint)
     SELECT json_extract(value, '$.key'), json_extract(value, '$.payload'),
            json_extract(value, '$.fingerprint')
     FROM json_each(?)
     WHERE ${migrate ? `NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE key = '${MARKER}')` : '1'}
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload,
                                   fingerprint = excluded.fingerprint`;
  const payload = JSON.stringify(entries);
  if (journal.length) {
    const literal = "'" + payload.replaceAll("'", "''") + "'";
    await db.batch([
      ...journal,
      statement.replace('json_each(?)', () => 'json_each(' + literal + ')'),
    ]);
  } else await db.execute(statement, [payload]);
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
  options?: { strict?: boolean; hashes?: string[] },
): Promise<Book[]> {
  const hashes = options?.hashes && [...new Set(options.hashes)];
  if (hashes && !hashes.length) return [];
  const db = await database(io);
  if (!db) {
    if (!options?.strict) {
      const books = await safeLoadJSON<Book[]>(io, getLibraryFilename(), 'Books', []);
      return hashes ? books.filter((book) => hashes.includes(book.hash)) : books;
    }
    const rows = await legacyMigrationRows(io, '');
    return hashes ? rows.filter((book) => hashes.includes(book.hash)) : rows;
  }
  const rows = await db.select<{ payload: string }>(
    hashes
      ? `SELECT payload FROM ${TABLE} WHERE key IN (SELECT 'book:' || value FROM json_each(?)) AND payload IS NOT NULL ORDER BY rowid`
      : `SELECT payload FROM ${TABLE} WHERE key LIKE 'book:%' AND payload IS NOT NULL ORDER BY rowid`,
    hashes ? [JSON.stringify(hashes)] : undefined,
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
  const changes: { current: Book; previous?: Book }[] = [];
  for (const book of books) {
    const previous = old.get(book.hash);
    // Merge-floor callers retain untouched row objects. Avoid serializing
    // those rows just to discover that their database value is unchanged.
    if (book !== previous) {
      const row = entry(book);
      if (row.payload !== (previous && JSON.stringify(previous))) {
        entries.push(row);
        changes.push({ current: book, previous });
      }
    }
    old.delete(book.hash);
  }
  for (const hash of old.keys())
    entries.push({ key: `book:${hash}`, payload: null, fingerprint: null });
  const vault = useSettingsStore.getState().settings.icloud?.vaultId;
  const log = isVaultId(vault) && changes.length ? await catalog(db, vault) : undefined;
  await upsert(db, entries, false, log ? await log.stage(changes) : []);
}

async function catalog(db: DatabaseService, vault: string) {
  const { CatalogJournal } = await import('./sync/providers/icloud/catalogJournal');
  const log = new CatalogJournal(db, vault);
  await log.init();
  return log;
}

export async function withVaultCatalog<T>(
  io: LibraryIO & Pick<FileSystem, 'getPrefix'>,
  vault: string,
  fn: (log: CatalogJournal, db: DatabaseService) => Promise<T>,
) {
  return withLibraryLock(io, async () => {
    const db = await database(io);
    if (!db || !isVaultId(vault)) throw new Error('iCloud library database unavailable');
    return fn(await catalog(db, vault), db);
  });
}

export async function syncCatalog(
  io: LibraryIO & Pick<FileSystem, 'getPrefix'>,
  provider: import('./sync/file/provider').FileSyncProvider,
  direction: 'pull' | 'push',
  check: () => void,
  delivery?: ReturnType<typeof import('./sync/providers/icloud/delivery').segmentDelivery>,
) {
  const vault = provider.vaultId!;
  const access = <T>(fn: (log: CatalogJournal, db: DatabaseService) => Promise<T>) =>
    withVaultCatalog(io, vault, (log, db) => {
      check();
      return fn(log, db);
    });
  const unverified: Pick<Book, 'hash' | 'title'>[] = [];
  let legacy: Book[] = [];
  if (direction === 'pull') {
    const { buildLibraryPath } = await import('./sync/file/layout');
    const { parseRemoteLibraryIndex, stripDeviceLocalFields } = await import('./sync/file/wire');
    const raw = await provider.readText(buildLibraryPath('/'));
    if (raw !== null) {
      const index = parseRemoteLibraryIndex(raw);
      if (!index) throw new Error('Cannot verify the previous iCloud book index');
      legacy = index.books
        .filter((b) => !b.glossaCloud && !b.duplicateOf)
        .map(stripDeviceLocalFields);
    }
  }
  await access(async (log, db) => {
    const books = await loadLibraryRows(io);

    const initial = await log.stage(
      books.map((current) => ({ current })),
      true,
    );
    if (initial.length) await db.batch(initial);
    const locals = new Map(books.map((b) => [b.hash, b]));
    for (const row of legacy) {
      const existing = locals.get(row.hash);
      if (
        (existing &&
          (existing.glossaCloud || existing.contentFingerprint !== row.contentFingerprint)) ||
        !(await log.importLegacy(row))
      )
        unverified.push({ hash: row.hash, title: row.title });
    }
  });
  const { exchangeSegments } = await import('./sync/providers/icloud/exchangeSegments');
  await exchangeSegments(
    provider,
    provider.rootPath + '/catalog',
    direction,
    {
      cursor: () => access((j) => j.cursor()),
      receive: (raw) => access((j) => j.receive(raw)),
      published: (id) => access((j) => j.published(id)),
      pending: () => access((j) => j.pending()),
    },
    check,
    delivery,
  );
  return access(async (log, db) => {
    const current = await loadLibraryRows(io);
    const rows = new Map(current.map((b) => [b.hash, b]));
    const changes: Entry[] = [];
    const confirmations: { book: Book; actor: string; seq: number }[] = [];
    const { projectVaultBook } = await import('./sync/providers/icloud/catalogJournal');
    for (const b of await log.books()) {
      const old = rows.get(b.hash);
      if (old && (old.contentFingerprint !== b.contentFingerprint || old.glossaCloud)) continue;
      const next = projectVaultBook(old, b);
      if (direction === 'push' && next.removal?.cloudTargets?.['icloud'] === 'pending') {
        const stamp = await log.removalSegment(next);
        if (stamp) confirmations.push({ book: next, ...stamp });
      }
      if (JSON.stringify(next) !== JSON.stringify(old)) changes.push(entry(next));
      rows.set(b.hash, next);
    }
    if (changes.length) await upsert(db, changes);
    return { books: [...rows.values()], changed: changes.length, unverified, confirmations };
  });
}
