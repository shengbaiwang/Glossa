import { z } from 'zod';
import { checkAborted as throwIfAborted } from '@/glossa/context/text';

export async function hashData(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export interface DerivedStore<T> {
  load(key: string): Promise<T | null>;
  save(key: string, points: T, signal: AbortSignal): Promise<void>;
}
/** Shared derived-data storage; existing map envelope/database remain compatible. */
export function createDerivedStore<T>(
  database: string,
  schema: z.ZodType<T>,
  limits = { entryBytes: 32000, entries: 128, totalBytes: 4000000 },
): DerivedStore<T> {
  const entrySchema = z
    .object({
      key: z.string().regex(/^[a-f0-9]{64}$/),
      updatedAt: z.number().finite(),
      checksum: z.string().regex(/^[a-f0-9]{64}$/),
      points: schema,
    })
    .strict();
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      let failed = false;
      const timer = setTimeout(() => {
        failed = true;
        reject(new Error('Inventory cache unavailable'));
      }, 1000);
      const request = indexedDB.open(database, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('inventories', { keyPath: 'key' });
      request.onerror = request.onblocked = () => {
        clearTimeout(timer);
        failed = true;
        reject(new Error('Inventory cache unavailable'));
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (failed) request.result.close();
        else resolve(request.result);
      };
    });

  /** Disposable, bounded derived data. Cache failure never invalidates a durable job checkpoint. */
  return {
    async load(key) {
      const db = await open();
      try {
        const raw: unknown = await new Promise((resolve, reject) => {
          const tx = db.transaction('inventories', 'readonly');
          const request = tx.objectStore('inventories').get(key);
          tx.oncomplete = () => resolve(request.result);
          tx.onerror = tx.onabort = () => reject(new Error('Inventory cache unavailable'));
        });
        if (raw === undefined || bytes(raw) > limits.entryBytes) return null;
        const entry = entrySchema.safeParse(raw);
        if (!entry.success || entry.data.key !== key) return null;
        return (await hashData({ key, points: entry.data.points })) === entry.data.checksum
          ? entry.data.points
          : null;
      } finally {
        db.close();
      }
    },
    async save(key, points, signal) {
      throwIfAborted(signal);
      const valid = schema.parse(points);
      const entry = entrySchema.parse({
        key,
        updatedAt: Date.now(),
        points: valid,
        checksum: await hashData({ key, points: valid }),
      });
      if (bytes(entry) > limits.entryBytes) return;
      throwIfAborted(signal);
      const db = await open();
      try {
        throwIfAborted(signal);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('inventories', 'readwrite'),
            store = tx.objectStore('inventories');
          const abort = () => tx.abort();
          signal.addEventListener('abort', abort, { once: true });
          tx.oncomplete = () => {
            signal.removeEventListener('abort', abort);
            resolve();
          };
          tx.onerror = tx.onabort = () => {
            signal.removeEventListener('abort', abort);
            reject(
              signal.aborted
                ? new DOMException('Cancelled', 'AbortError')
                : new Error('Inventory cache unavailable'),
            );
          };
          store.put(entry);
          const all = store.getAll();
          const keys = store.getAllKeys();
          keys.onsuccess = () => {
            let total = bytes(entry),
              count = 1;
            const entries = (all.result as unknown[])
              .flatMap((value, index) => {
                const parsed = entrySchema.safeParse(value);
                if (!parsed.success || bytes(value) > limits.entryBytes) {
                  store.delete(keys.result[index]!);
                  return [];
                }
                return parsed.success && parsed.data.key !== key ? [parsed.data] : [];
              })
              .sort((a, b) => b.updatedAt - a.updatedAt);
            for (const old of entries) {
              total += bytes(old);
              if (++count > limits.entries || total > limits.totalBytes) store.delete(old.key);
            }
          };
          if (signal.aborted) abort();
        });
      } finally {
        db.close();
      }
    },
  };
}
