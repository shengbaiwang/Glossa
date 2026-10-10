import { expect, it } from 'vitest';
import { createDerivedStore } from '@/glossa/harness/derivedStore';
import { argumentPointsSchema } from '@/glossa/harness/evidence';

const key = () => crypto.randomUUID().replaceAll('-', '').repeat(2);
const points = [{ text: 'Only under both conditions.', sourceIds: ['s1'] }];

it('bounds reading caches across fresh instances and removes malformed entries on the next write', async () => {
  const name = `harness-cache-test-${crypto.randomUUID()}`;
  const limits = { entries: 2, entryBytes: 2000, totalBytes: 4000 };
  const store = createDerivedStore(name, argumentPointsSchema, limits);
  const first = key(),
    last = key();
  const signal = new AbortController().signal;
  try {
    await store.save(first, points, signal);
    expect(await createDerivedStore(name, argumentPointsSchema, limits).load(first)).toEqual(
      points,
    );
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('inventories', 'readwrite');
        tx.objectStore('inventories').put({ key: 'broken', unexpected: 'x'.repeat(6000) });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      await store.save(key(), points, signal);
      await store.save(last, points, signal);
      expect(await store.load(last)).toEqual(points);
      expect(await store.load(first)).toBeNull();
      const rows: unknown[] = await new Promise((resolve) => {
        const request = db.transaction('inventories').objectStore('inventories').getAll();
        request.onsuccess = () => resolve(request.result);
      });
      expect(rows).toHaveLength(2);
      expect(JSON.stringify(rows)).not.toContain('unexpected');
    } finally {
      db.close();
    }
  } finally {
    indexedDB.deleteDatabase(name);
  }
});
