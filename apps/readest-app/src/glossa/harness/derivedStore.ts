import { z } from 'zod';
import { withBookDataWrite } from '@/services/bookDataLifecycle';
import { checkAborted as throwIfAborted } from '@/glossa/context/text';

export async function hashData(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export interface BookDataOwner {
  bookId: string;
  revision: number;
}
export interface DerivedStore<T> {
  load(key: string, owner?: BookDataOwner): Promise<T | null>;
  save(key: string, points: T, signal: AbortSignal, owner?: BookDataOwner): Promise<void>;
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
      bookId: z.string().min(1).max(200).optional(),
      dataRevision: z.number().int().nonnegative().optional(),
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
  const load = async (key: string, owner?: BookDataOwner, cutoff = 0): Promise<T | null> => {
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
      if (
        owner &&
        ((entry.data.bookId && entry.data.bookId !== owner.bookId) ||
          (entry.data.dataRevision ?? 0) < cutoff)
      )
        return null;
      const ownership = entry.data.bookId
        ? { bookId: entry.data.bookId, dataRevision: entry.data.dataRevision }
        : {};
      if (
        (await hashData({ key, points: entry.data.points, ...ownership })) !== entry.data.checksum
      )
        return null;
      if (owner && !entry.data.bookId) {
        const owned = {
          ...entry.data,
          bookId: owner.bookId,
          dataRevision: owner.revision,
          checksum: await hashData({
            key,
            points: entry.data.points,
            bookId: owner.bookId,
            dataRevision: owner.revision,
          }),
        };
        let adopted = false;
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('inventories', 'readwrite'),
            store = tx.objectStore('inventories');
          const request = store.get(key);
          request.onsuccess = () => {
            // Explicit legacy cleanup or another book may have changed this row
            // while its checksum was being verified. Never recreate or relabel it.
            if (JSON.stringify(request.result) !== JSON.stringify(raw)) return;
            store.put(owned);
            adopted = true;
          };
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => reject(new Error('Inventory cache unavailable'));
        });
        if (!adopted) return null;
      }
      return entry.data.points;
    } finally {
      db.close();
    }
  };
  const save = async (
    key: string,
    points: T,
    signal: AbortSignal,
    owner?: BookDataOwner,
  ): Promise<void> => {
    throwIfAborted(signal);
    const valid = schema.parse(points);
    const entry = entrySchema.parse({
      key,
      updatedAt: Date.now(),
      points: valid,
      ...(owner ? { bookId: owner.bookId, dataRevision: owner.revision } : {}),
      checksum: await hashData({
        key,
        points: valid,
        ...(owner ? { bookId: owner.bookId, dataRevision: owner.revision } : {}),
      }),
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
  };
  return {
    load: (key, owner) =>
      owner
        ? withBookDataWrite(owner.bookId, owner.revision, (cutoff) => load(key, owner, cutoff))
        : load(key),
    save: (key, points, signal, owner) =>
      owner
        ? withBookDataWrite(owner.bookId, owner.revision, () => save(key, points, signal, owner))
        : save(key, points, signal),
  };
}
