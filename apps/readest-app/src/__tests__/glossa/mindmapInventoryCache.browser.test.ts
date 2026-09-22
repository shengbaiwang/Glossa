import { expect, it, vi } from 'vitest';
import { mapInventoryStore } from '@/glossa/mindmap/inventoryCache';

const key = () => crypto.randomUUID().replaceAll('-', '').repeat(2);
const signal = () => new AbortController().signal;
const points = [{ text: 'A claim holds only under its stated conditions.', sourceIds: ['s1'] }];
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('glossa-map-inventories', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

it('persists only derived inventory through fresh connections and returns independent copies', async () => {
  const id = key();
  await mapInventoryStore.save(id, points, signal());
  const result = await mapInventoryStore.load(id);
  expect(result).toEqual(points);
  result![0]!.text = 'Edited';
  expect(await mapInventoryStore.load(id)).toEqual(points);
  const db = await open();
  try {
    const value: unknown = await new Promise((resolve) => {
      const read = db.transaction('inventories').objectStore('inventories').get(id);
      read.onsuccess = () => resolve(read.result);
    });
    expect(Object.keys(value as object).sort()).toEqual(['checksum', 'key', 'points', 'updatedAt']);
    expect(JSON.stringify(value)).not.toContain('anchor');
  } finally {
    db.close();
  }
});

it('rejects tampered cache contents without clearing saved maps or accepting another key', async () => {
  const id = key(),
    other = key();
  await mapInventoryStore.save(id, points, signal());
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('inventories', 'readwrite'),
        store = tx.objectStore('inventories');
      const read = store.get(id);
      read.onsuccess = () => {
        store.put({ ...read.result, points: [{ text: 'Tampered', sourceIds: ['s1'] }] });
        store.put({ ...read.result, key: other });
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  expect(await mapInventoryStore.load(id)).toBeNull();
  expect(await mapInventoryStore.load(other)).toBeNull();
});

it('rolls back a cancelled cache write and retains the previous valid inventory', async () => {
  const id = key(),
    controller = new AbortController();
  await mapInventoryStore.save(id, points, signal());
  const put = IDBObjectStore.prototype.put;
  const intercepted = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const request = put.call(this, value, key);
    queueMicrotask(() => controller.abort());
    return request;
  });
  try {
    await expect(
      mapInventoryStore.save(id, [{ text: 'New', sourceIds: ['s1'] }], controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    intercepted.mockRestore();
  }
  expect(await mapInventoryStore.load(id)).toEqual(points);
});

it('bounds the cache to 128 records and four megabytes without deleting workspace databases', async () => {
  const removed = vi.spyOn(IDBFactory.prototype, 'deleteDatabase');
  let last = '';
  try {
    for (let i = 0; i < 130; i++) {
      last = key();
      await mapInventoryStore.save(last, points, signal());
    }
    expect(await mapInventoryStore.load(last)).toEqual(points);
    const db = await open();
    try {
      const records: unknown[] = await new Promise((resolve) => {
        const read = db.transaction('inventories').objectStore('inventories').getAll();
        read.onsuccess = () => resolve(read.result);
      });
      expect(records.length).toBeLessThanOrEqual(128);
      expect(
        records.reduce<number>(
          (size, record) => size + new TextEncoder().encode(JSON.stringify(record)).length,
          0,
        ),
      ).toBeLessThanOrEqual(4000000);
    } finally {
      db.close();
    }
    expect(removed).not.toHaveBeenCalled();
  } finally {
    removed.mockRestore();
  }
});
