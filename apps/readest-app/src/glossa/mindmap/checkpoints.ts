import { z } from 'zod';
import { validateProviderConfig, type ProviderConfig } from '@/glossa/ai/provider';
import { tokenUsageSchema } from '@/glossa/ai/usage';
import { PassageError, throwIfAborted } from '@/glossa/passages/types';
import { stubTranslation as _ } from '@/utils/misc';
import { mindmapBodySchema } from './schema';

export const OVERVIEW_VERSION = 'mindmap-overview-2';
export type MapTarget = { kind: 'book' } | { kind: 'chapter'; chapterId: string };
export const inventoryPointsSchema = z
  .array(
    z
      .object({
        text: z.string().trim().min(1).max(240),
        sourceIds: z.array(z.string().min(1).max(200)).min(1).max(4),
      })
      .strict(),
  )
  .max(12);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const mapCheckpointSchema = z
  .object({
    version: z.literal(1),
    contentHash: digestSchema,
    sourceCount: z.number().int().min(1).max(4800),
    characterCount: z.number().int().min(1).max(240000),
    batches: z
      .array(
        z
          .object({
            start: z.number().int().nonnegative().max(4799),
            end: z.number().int().min(1).max(4800),
            points: inventoryPointsSchema.optional(),
            elapsedMs: z.number().finite().nonnegative().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(24),
    result: mindmapBodySchema.optional(),
    requests: z
      .array(
        z
          .object({
            phase: z.enum(['inventory', 'synthesis']),
            batch: z.number().int().nonnegative().max(24),
            elapsedMs: z.number().finite().nonnegative(),
            firstTextMs: z.number().finite().nonnegative().optional(),
            outputBudget: z.number().int().min(1).max(65536),
            outcome: z.enum(['received', 'timeout', 'truncated', 'failed']),
            usage: tokenUsageSchema.optional(),
          })
          .strict(),
      )
      .max(64)
      .optional(),
  })
  .strict()
  .refine(
    (job) =>
      job.batches[0]!.start === 0 &&
      job.batches.at(-1)!.end === job.sourceCount &&
      job.batches.every(
        (batch, i) =>
          batch.end > batch.start &&
          batch.end - batch.start <= 200 &&
          (!i || job.batches[i - 1]!.end === batch.start),
      ) &&
      (!job.result || job.batches.every((batch) => batch.points !== undefined)),
  );
export type MapCheckpoint = z.infer<typeof mapCheckpointSchema>;
export interface CheckpointEntry {
  revision: string | null;
  checkpoint: MapCheckpoint | null;
}
export interface MapCheckpointStore {
  load(key: string): Promise<CheckpointEntry>;
  save(
    key: string,
    expected: string | null,
    checkpoint: MapCheckpoint,
    signal: AbortSignal,
  ): Promise<string>;
}

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** No credential, body text or mutable provider display name enters a task identity. */
export async function getMapCheckpointKey(input: {
  bookId: string;
  title: string;
  target: MapTarget;
  config: ProviderConfig;
}): Promise<string> {
  const config = validateProviderConfig(input.config);
  return digest({
    version: OVERVIEW_VERSION,
    batching: 2,
    bookId: input.bookId,
    title: input.title.slice(0, 500),
    target: input.target.kind === 'book' ? ['book'] : ['chapter', input.target.chapterId],
    provider: [
      config.id,
      config.baseUrl,
      config.model,
      config.reasoningEffort ?? null,
      config.maxTokens ?? null,
    ],
  });
}

const storageError = () =>
  new PassageError(
    'unavailable',
    _('Could not save mind map progress on this device. Free some storage and try again.'),
  );
const conflictError = () =>
  new PassageError(
    'unavailable',
    _('Mind map progress changed in another window. Continue to load the latest progress.'),
  );
const envelopeSchema = z
  .object({
    key: digestSchema,
    revision: z.string().uuid(),
    updatedAt: z.number().finite(),
    checksum: digestSchema,
    checkpoint: z.unknown(),
  })
  .strict();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let failed = false;
    const request = indexedDB.open('glossa-map-generation', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('checkpoints', { keyPath: 'key' });
    request.onerror = request.onblocked = () => {
      failed = true;
      reject(storageError());
    };
    request.onsuccess = () => {
      if (failed) request.result.close();
      else resolve(request.result);
    };
  });
}

/** Small, disposable derived inventories; raw book text remains in the reading adapter. */
export const mapCheckpointStore: MapCheckpointStore = {
  async load(key) {
    const db = await open().catch(() => {
      throw storageError();
    });
    try {
      const raw: unknown = await new Promise((resolve, reject) => {
        const tx = db.transaction('checkpoints', 'readonly');
        const request = tx.objectStore('checkpoints').get(key);
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(storageError());
      });
      const saved = envelopeSchema.safeParse(raw);
      if (!saved.success || saved.data.key !== key) return { revision: null, checkpoint: null };
      const parsed = mapCheckpointSchema.safeParse(saved.data.checkpoint);
      const valid = parsed.success && (await digest(parsed.data)) === saved.data.checksum;
      return { revision: saved.data.revision, checkpoint: valid ? parsed.data : null };
    } finally {
      db.close();
    }
  },
  async save(key, expected, checkpoint, signal) {
    throwIfAborted(signal);
    const valid = mapCheckpointSchema.parse(checkpoint);
    const entry = {
      key,
      revision: crypto.randomUUID(),
      updatedAt: Date.now(),
      checksum: await digest(valid),
      checkpoint: valid,
    };
    // The schema limits each entry well below 1 MB; keep only eight recent jobs.
    if (new TextEncoder().encode(JSON.stringify(entry)).length > 1000000) throw storageError();
    throwIfAborted(signal);
    const db = await open().catch(() => {
      throw storageError();
    });
    try {
      throwIfAborted(signal);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('checkpoints', 'readwrite');
        const store = tx.objectStore('checkpoints');
        let reason: Error | undefined;
        const abort = () => {
          reason = new DOMException('Cancelled', 'AbortError');
          tx.abort();
        };
        signal.addEventListener('abort', abort, { once: true });
        tx.oncomplete = () => {
          signal.removeEventListener('abort', abort);
          resolve();
        };
        tx.onerror = tx.onabort = () => {
          signal.removeEventListener('abort', abort);
          reject(reason ?? storageError());
        };
        const current = store.get(key);
        current.onsuccess = () => {
          const previous = envelopeSchema.safeParse(current.result);
          if ((previous.success ? previous.data.revision : null) !== expected) {
            reason = conflictError();
            tx.abort();
            return;
          }
          store.put(entry);
          const all = store.getAll();
          all.onsuccess = () => {
            const ordered = (all.result as unknown[])
              .flatMap((value) => {
                const record = envelopeSchema.safeParse(value);
                return record.success && record.data.key !== key ? [record.data] : [];
              })
              .sort((a, b) => b.updatedAt - a.updatedAt);
            for (const old of ordered.slice(7)) store.delete(old.key);
          };
        };
        if (signal.aborted) abort();
      });
      return entry.revision;
    } finally {
      db.close();
    }
  },
};
