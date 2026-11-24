import { describeObject } from '@glossa/sync-contracts/chunker';
import type { Book } from '@/types/book';
import { decodeHeadPreview, maxPreviewBytes, previewCodec } from './headPreview';

export function previewScope(p: NonNullable<Book['glossaCloud']>) {
  return JSON.stringify([
    p.origin,
    p.subject,
    p.book_id,
    p.manifest_id,
    p.file_blake3,
    previewCodec,
  ]);
}

async function previewCache(scope: string) {
  const cache = await caches.open('glossa-head-previews-v1');
  const key = new URL('/.glossa-cache/preview/' + encodeURIComponent(scope), location.href).href;
  return { cache, key };
}

async function readCache(scope: string, hash?: string) {
  if (typeof caches === 'undefined') return;
  try {
    const { cache, key } = await previewCache(scope);
    const response = await cache.match(key);
    if (!response) return;
    const recordedHash = response.headers.get('X-Glossa-Digest');
    const size = Number(response.headers.get('Content-Length'));
    const fileBytes = Number(response.headers.get('X-Glossa-Source-Size'));
    if (
      !recordedHash ||
      (hash && hash !== recordedHash) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > maxPreviewBytes ||
      !Number.isSafeInteger(fileBytes) ||
      fileBytes < 1
    )
      return;
    const blob = await response.blob();
    if (blob.size === size) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (describeObject(bytes).blake3 === recordedHash) return { bytes, fileBytes };
    }
  } catch {
    /* The verified object read can recover a missing or damaged cache. */
  }
  return undefined;
}

export async function cachedHeadPreview(
  p: NonNullable<Book['glossaCloud']>,
  format: 'pdf' | 'epub',
) {
  const hit = await readCache(previewScope(p));
  return hit && decodeHeadPreview(hit.bytes, p.file_blake3, hit.fileBytes, format);
}

export async function loadPreviewBytes(
  scope: string | undefined,
  hash: string,
  size: number,
  fileBytes: number,
  load: () => Promise<Uint8Array<ArrayBuffer>>,
) {
  const cached = scope && (await readCache(scope, hash));
  if (cached && cached.bytes.length === size && cached.fileBytes === fileBytes) return cached.bytes;
  const bytes = await load();
  if (scope && typeof caches !== 'undefined') {
    try {
      const { cache, key } = await previewCache(scope);
      await cache.put(
        key,
        new Response(bytes, {
          headers: {
            'Content-Length': String(bytes.length),
            'X-Glossa-Digest': hash,
            'X-Glossa-Source-Size': String(fileBytes),
          },
        }),
      );
      const entries = await cache.keys();
      await Promise.all(
        entries.slice(0, Math.max(0, entries.length - 8)).map((entry) => cache.delete(entry)),
      );
    } catch {
      /* Browsers may refuse storage or evict entries. */
    }
  }
  return bytes;
}
