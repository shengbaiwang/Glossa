import { afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import type { DatabaseService } from '@/types/database';

const databases = new WeakMap<object, Promise<DatabaseService>>();
const opened = new Set<Promise<DatabaseService>>();

/** Import tests use the real SQL contract instead of a truthy, empty mock. */
export function openTestLibraryDatabase(owner: object): Promise<DatabaseService> {
  let database = databases.get(owner);
  if (!database) {
    database = NodeDatabaseService.open(':memory:');
    databases.set(owner, database);
    opened.add(database);
  }
  return database;
}

afterEach(async () => {
  const current = [...opened];
  opened.clear();
  await Promise.all(current.map(async (database) => (await database).close()));
});
