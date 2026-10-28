import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, remove, exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { NativeDatabaseService } from '@/services/database/nativeDatabaseService';
import {
  LIBRARY_DATABASE_FILENAME,
  loadLibraryRows,
  registerLibraryDatabase,
  writeLibraryRows,
} from '@/services/libraryRepository';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';

// This capability-scoped folder is isolated from both daily and dev profiles.
const SANDBOX = `${process.env['CWD']}/.readest-test-sandbox-tauri/library-repository`;
const TABLE = 'glossa_library_entries';
let root: string;
const opened = new Set<NativeDatabaseService>();
const book = (hash: string, title = hash): Book => ({
  hash,
  title,
  author: 'Original test fixture',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
});

async function connection(prefix = root) {
  const db = await NativeDatabaseService.open(`sqlite:${prefix}/${LIBRARY_DATABASE_FILENAME}`);
  opened.add(db);
  return db;
}

async function close(db: NativeDatabaseService) {
  opened.delete(db);
  await db.close();
}

function adapter() {
  const fs = {
    getPrefix: async () => root,
    exists: async (path: string, base: string) =>
      exists(base === 'None' ? path : `${root}/${path}`),
    readFile: async (path: string, base: string) =>
      readTextFile(base === 'None' ? path : `${root}/${path}`),
    writeFile: async (path: string, _base: unknown, text: string) =>
      writeTextFile(`${root}/${path}`, text),
  } as unknown as FileSystem;
  registerLibraryDatabase(fs, connection);
  return fs;
}

beforeEach(async () => {
  root = `${SANDBOX}/${crypto.randomUUID()}`;
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await Promise.all([...opened].map((db) => close(db).catch(() => {})));
  await remove(root, { recursive: true });
});

describe('native transactional library repository', () => {
  it('migrates once, persists bound JSON1 values and reopens without reading the old JSON', async () => {
    const initial = book('legacy', 'Original personal title');
    await writeTextFile(`${root}/library.json`, JSON.stringify([initial]));
    const fs = adapter();
    expect(await loadLibraryRows(fs)).toEqual([initial]);
    const updated = book('legacy', "Quoted title: '; SELECT 'unchanged'; --");
    await writeLibraryRows(fs, [updated]);
    expect(await readTextFile(`${root}/library.json`)).toBe(JSON.stringify([initial]));
    for (const db of [...opened]) await close(db);
    await writeTextFile(`${root}/library.json`, '[]');
    expect(await loadLibraryRows(adapter())).toEqual([updated]);
  });

  it('rolls back the whole bound multi-row SQL statement on a later constraint failure', async () => {
    const seed = await connection();
    await seed.execute(`CREATE TABLE ${TABLE} (
      key TEXT PRIMARY KEY CHECK (key != 'book:reject'), payload TEXT, fingerprint TEXT
    )`);
    await close(seed);
    const fs = adapter();
    expect(await loadLibraryRows(fs)).toEqual([]);
    await expect(writeLibraryRows(fs, [book('first'), book('reject')])).rejects.toThrow();
    expect(await loadLibraryRows(fs)).toEqual([]);
    await writeLibraryRows(fs, [book('retry')]);
    expect(await loadLibraryRows(fs)).toEqual([book('retry')]);
  });

  it('fails closed on invalid committed rows after reopen instead of returning legacy records', async () => {
    await writeTextFile(`${root}/library.json`, JSON.stringify([book('stale-json')]));
    const fs = adapter();
    await loadLibraryRows(fs);
    await writeLibraryRows(fs, [book('current')]);
    const db = [...opened][0]!;
    await db.execute(`UPDATE ${TABLE} SET payload = ? WHERE key = ?`, [
      'not valid JSON',
      'book:current',
    ]);
    await close(db);
    await expect(loadLibraryRows(adapter())).rejects.toThrow();
    expect(await readTextFile(`${root}/library.json`)).toBe(JSON.stringify([book('stale-json')]));
  });
});
