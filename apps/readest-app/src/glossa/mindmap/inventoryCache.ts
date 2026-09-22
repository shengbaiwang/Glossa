import { z } from 'zod';
import { validateProviderConfig, type ProviderConfig } from '@/glossa/ai/provider';
import type { ChapterSource } from '@/glossa/context/types';
import { sourceWire, type BookReadingAccess } from '@/glossa/harness/book';
import { throwIfAborted } from '@/glossa/passages/types';
import { inventoryPointsSchema } from './checkpoints';
import { hashMindmapData } from './identity';

export type InventoryPoints = z.infer<typeof inventoryPointsSchema>;
export interface MapInventoryStore {
  load(key: string): Promise<InventoryPoints | null>;
  save(key: string, points: InventoryPoints, signal: AbortSignal): Promise<void>;
}

/** The exact extraction input, including context and anchors, must agree across targets. */
export async function getMapInventoryKey(
  access: BookReadingAccess,
  sources: ChapterSource[],
  input: ProviderConfig,
): Promise<string> {
  const config = validateProviderConfig(input);
  return hashMindmapData({
    version: 'map-inventory-4',
    documentHash: access.documentHash,
    provider: [
      config.id,
      config.baseUrl,
      config.model,
      config.reasoningEffort ?? null,
      config.maxTokens ?? null,
    ],
    sources: sources.map((source) => ({
      ...sourceWire(source, access),
      anchor: source.anchor,
    })),
  });
}

const entrySchema = z
  .object({
    key: z.string().regex(/^[a-f0-9]{64}$/),
    updatedAt: z.number().finite(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    points: inventoryPointsSchema,
  })
  .strict();
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    let failed = false;
    const request = indexedDB.open('glossa-map-inventories', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('inventories', { keyPath: 'key' });
    request.onerror = request.onblocked = () => {
      failed = true;
      reject(new Error('Inventory cache unavailable'));
    };
    request.onsuccess = () => {
      if (failed) request.result.close();
      else resolve(request.result);
    };
  });

/** Disposable, bounded derived data. Cache failure never invalidates a durable job checkpoint. */
export const mapInventoryStore: MapInventoryStore = {
  async load(key) {
    const db = await open();
    try {
      const raw: unknown = await new Promise((resolve, reject) => {
        const tx = db.transaction('inventories', 'readonly');
        const request = tx.objectStore('inventories').get(key);
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(new Error('Inventory cache unavailable'));
      });
      if (raw === undefined || bytes(raw) > 32000) return null;
      const entry = entrySchema.safeParse(raw);
      if (!entry.success || entry.data.key !== key) return null;
      return (await hashMindmapData({ key, points: entry.data.points })) === entry.data.checksum
        ? entry.data.points
        : null;
    } finally {
      db.close();
    }
  },
  async save(key, points, signal) {
    throwIfAborted(signal);
    const valid = inventoryPointsSchema.parse(points);
    const entry = entrySchema.parse({
      key,
      updatedAt: Date.now(),
      points: valid,
      checksum: await hashMindmapData({ key, points: valid }),
    });
    if (bytes(entry) > 32000) return;
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
        all.onsuccess = () => {
          let total = bytes(entry),
            count = 1;
          const entries = (all.result as unknown[])
            .flatMap((value) => {
              const parsed = entrySchema.safeParse(value);
              return parsed.success && parsed.data.key !== key ? [parsed.data] : [];
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
          for (const old of entries) {
            total += bytes(old);
            if (++count > 128 || total > 4000000) store.delete(old.key);
          }
        };
        if (signal.aborted) abort();
      });
    } finally {
      db.close();
    }
  },
};
