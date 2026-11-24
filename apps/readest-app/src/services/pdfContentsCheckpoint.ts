import { z } from 'zod';
import type { AppService, FileSystem } from '@/types/system';
import { withBookDataWrite } from './bookDataLifecycle';
import { withLibraryLock } from './libraryLock';
import { hashData } from '@/glossa/harness/derivedStore';
import type { PDFCacheOwner } from './pdfEnhancement';

export type PDFContentsCheckpointStorage = {
  read: () => Promise<unknown>;
  write: (checkpoint: unknown) => Promise<void>;
};
type CheckpointHost = Pick<AppService, 'readFile' | 'writeFile' | 'deleteFile' | 'exists'> & {
  fs?: Pick<FileSystem, 'moveFile'> & Partial<Pick<FileSystem, 'getPrefix'>>;
};
const BOOK_BYTES = 16 * 1024 * 1024;
const TOTAL_BYTES = 64 * 1024 * 1024;
const CHUNK_CHARS = 80000; // Even unpaired surrogates encode within 320KB.
const bytes = (text: string) => new TextEncoder().encode(text).length;
const partSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(0).max(320000),
});
const manifestSchema = z.object({
  version: z.literal(2),
  generation: z.number().int().nonnegative(),
  parts: z.array(partSchema).max(220),
  bytes: z.number().int().max(BOOK_BYTES),
});
const recordSchema = z.object({
  bookId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  parts: z.array(partSchema).max(440),
  touched: z.number(),
  activeUntil: z.number(),
});
const registrySchema = z.array(recordSchema).max(5000);
const registryPath = 'pdf-contents-cache-index.json';

/** Immutable, checksummed parts; a single atomic manifest publishes a generation.
 * The quota ledger reserves parts BEFORE writing them, including interrupted
 * generations. Eviction touches only these disposable, registered checkpoints.
 */
export function pdfContentsCheckpointStorage(
  host: Partial<CheckpointHost>,
  owner: PDFCacheOwner,
): PDFContentsCheckpointStorage | undefined {
  if (!host.readFile || !host.writeFile || !host.fs?.moveFile || !host.deleteFile) return;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(owner.bookId)) return;
  const { bookId, revision } = owner;
  const path = `${bookId}/pdf-contents-checkpoint.json`;
  const partPath = (id: string, hash: string) => `${id}/pdf-contents-part-${hash}.json`;
  const lock = {
    getPrefix: async () => `${(await host.fs?.getPrefix?.('Books')) ?? 'local'}/pdf-contents-cache`,
  };
  const readText = async (path: string) => {
    const value = await host.readFile!(path, 'Books', 'text').catch(() => null);
    return typeof value === 'string' ? value : null;
  };
  const atomic = async (path: string, value: unknown) => {
    const temporary = `${path}.tmp`;
    try {
      const raw = JSON.stringify(value);
      if (bytes(raw) > 320000) throw new Error('pdf_contents_checkpoint_limit');
      await host.writeFile!(temporary, 'Books', raw);
      await host.fs!.moveFile!(temporary, 'Books', path, 'Books');
    } finally {
      await host.deleteFile!(temporary, 'Books').catch(() => {});
    }
  };
  const load = async () => {
    const raw = await readText(path);
    if (!raw || bytes(raw) > 320000) return null;
    try {
      const value = JSON.parse(raw);
      if (value.generation !== revision) return null;
      if (value.version !== 2) return value.checkpoint ?? null;
      const manifest = manifestSchema.parse(value);
      const pieces: string[] = [];
      for (const part of manifest.parts) {
        const raw = await readText(partPath(bookId, part.hash));
        if (raw === null || bytes(raw) !== part.bytes || (await hashData(raw)) !== part.hash)
          return null;
        pieces.push(raw);
      }
      const text = pieces.join('');
      if (bytes(text) !== manifest.bytes) return null;
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  };
  return {
    read: () => withLibraryLock(lock, load),
    async write(checkpoint) {
      const raw = JSON.stringify(checkpoint);
      if (bytes(raw) > BOOK_BYTES) throw new Error('pdf_contents_checkpoint_limit');
      const pieces = new Map<string, string>();
      const parts: z.infer<typeof partSchema>[] = [];
      for (let start = 0; start < raw.length; ) {
        let end = Math.min(start + CHUNK_CHARS, raw.length);
        // Never split an UTF-16 surrogate pair across independently encoded files.
        if (end < raw.length && /[\uD800-\uDBFF]/.test(raw[end - 1]!)) end--;
        const text = raw.slice(start, end);
        const hash = await hashData(text);
        parts.push({ hash, bytes: bytes(text) });
        pieces.set(hash, text);
        start = end;
      }
      await withLibraryLock(lock, () =>
        withBookDataWrite(bookId, revision, async () => {
          // A read error is not evidence that the quota ledger is absent.
          // Resetting it could discard reservations from an interrupted write.
          const registryText = await host.readFile!(registryPath, 'Books', 'text').catch(
            async (error: unknown) => {
              if (host.exists && !(await host.exists(registryPath, 'Books'))) return null;
              throw error;
            },
          );
          if (registryText !== null && typeof registryText !== 'string')
            throw new Error('pdf_contents_checkpoint_invalid');
          let registry = registryText ? registrySchema.parse(JSON.parse(registryText)) : [];
          const previous = registry.find((entry) => entry.bookId === bookId);
          const reserved = [
            ...new Map(
              [...(previous?.parts ?? []), ...parts].map((part) => [part.hash, part]),
            ).values(),
          ];
          const now = Date.now();
          const state = (checkpoint as { checks?: { run?: { state?: string } } })?.checks?.run
            ?.state;
          registry = registry.filter((entry) => entry.bookId !== bookId);
          const size = (entries: typeof registry) =>
            entries.reduce((n, entry) => n + entry.parts.reduce((n, part) => n + part.bytes, 0), 0);
          const needed = reserved.reduce((n, part) => n + part.bytes, 0);
          if (needed > BOOK_BYTES) throw new Error('pdf_contents_checkpoint_limit');
          for (const victim of [...registry].sort((a, b) => a.touched - b.touched)) {
            if (size(registry) + needed <= TOTAL_BYTES) break;
            if (victim.activeUntil > now) continue;
            // Do not evict a generation while another window is reading it: all
            // readers and writers share this same library-scoped transaction lock.
            await host.deleteFile!(`${victim.bookId}/pdf-contents-checkpoint.json`, 'Books');
            const remaining: typeof victim.parts = [];
            for (const part of victim.parts) {
              try {
                await host.deleteFile!(partPath(victim.bookId, part.hash), 'Books');
              } catch {
                remaining.push(part);
              }
            }
            if (remaining.length) victim.parts = remaining;
            else registry = registry.filter((entry) => entry.bookId !== victim.bookId);
          }
          if (size(registry) + needed > TOTAL_BYTES)
            throw new Error('pdf_contents_checkpoint_limit');
          const record = {
            bookId,
            parts: reserved,
            touched: now,
            activeUntil: state === 'running' ? now + 240000 : 0,
          };
          // Reservation is durable even if the process exits during chunk writing.
          await atomic(registryPath, [...registry, record]);
          for (const [hash, text] of pieces) {
            const existing = await readText(partPath(bookId, hash));
            if (existing !== text) await host.writeFile!(partPath(bookId, hash), 'Books', text);
          }
          await atomic(path, { version: 2, generation: revision, parts, bytes: bytes(raw) });
          const retained = new Set(parts.map((part) => part.hash));
          const accounted = [...parts];
          for (const part of reserved)
            if (!retained.has(part.hash)) {
              try {
                await host.deleteFile!(partPath(bookId, part.hash), 'Books');
              } catch {
                accounted.push(part);
              }
            }
          // Failure here leaves a conservative reservation; never destroys the
          // just-committed checkpoint or an earlier recoverable generation.
          await atomic(registryPath, [...registry, { ...record, parts: accounted }]).catch(
            () => {},
          );
        }),
      );
    },
  };
}
