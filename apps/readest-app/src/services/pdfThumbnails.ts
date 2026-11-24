import type { BookDoc } from '@/libs/document';

const width = 180;
const maxImages = 64;
const maxBytes = 24 * 1024 * 1024;
const concurrency = 2;

type CachedImage = { blob: Blob; bytes: number };
const caches = new WeakMap<BookDoc, Map<number, CachedImage>>();

export const clearPDFThumbnails = (book: BookDoc) => {
  caches.delete(book);
};

export function createPDFThumbnailQueue(
  book: BookDoc,
  onImage: (index: number, blob: Blob) => void,
  onFailure: (failed: boolean) => void,
) {
  const cache = caches.get(book) ?? new Map<number, CachedImage>();
  caches.set(book, cache);
  const active = new Map<number, AbortController>();
  const failed = new Set<number>();
  const delivered = new Set<number>();
  let wanted = new Set<number>();
  let visible = new Set<number>();
  let closed = false;

  function remember(index: number, blob: Blob) {
    cache.delete(index);
    cache.set(index, { blob, bytes: blob.size + width * width * 8 });
    let bytes = [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [key, entry] of cache) {
      if (cache.size <= maxImages && bytes <= maxBytes) break;
      cache.delete(key);
      bytes -= entry.bytes;
    }
  }

  function pump() {
    if (closed) return;
    for (const index of wanted) {
      if (delivered.has(index) || failed.has(index) || active.has(index)) continue;
      const cached = cache.get(index);
      if (cached) {
        cache.delete(index);
        cache.set(index, cached);
        deliver(index, cached.blob);
        continue;
      }
      if (active.size >= concurrency) continue;
      const controller = new AbortController();
      active.set(index, controller);
      void Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted();
          return book.getPDFImage!(index, width, undefined, controller.signal);
        })
        .then((blob) => {
          if (controller.signal.aborted) return;
          remember(index, blob);
          deliver(index, blob);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            failed.add(index);
            updateFailure();
          }
        })
        .finally(() => {
          active.delete(index);
          pump();
        });
    }
  }

  function deliver(index: number, blob: Blob) {
    delivered.add(index);
    if (!visible.has(index)) return;
    onImage(index, blob);
  }

  function updateFailure() {
    onFailure([...visible].some((index) => failed.has(index)));
  }

  return {
    update(start: number, end: number, count: number) {
      const pages = Array.from(
        { length: Math.max(0, Math.min(end + 1, count) - start) },
        (_, i) => start + i,
      );
      visible = new Set(pages);
      wanted = new Set(pages);
      for (let i = 1; i <= Math.min(pages.length, 16); i++) {
        if (end + i < count) wanted.add(end + i);
        if (start - i >= 0) wanted.add(start - i);
      }
      delivered.clear();
      for (const index of failed) if (!wanted.has(index)) failed.delete(index);
      for (const [index, controller] of active) {
        if (
          !wanted.has(index) ||
          (!visible.has(index) &&
            pages.some(
              (page) =>
                !cache.has(page) && !delivered.has(page) && !active.has(page) && !failed.has(page),
            ))
        )
          controller.abort();
      }
      updateFailure();
      pump();
    },
    retry() {
      failed.clear();
      updateFailure();
      pump();
    },
    close() {
      closed = true;
      for (const controller of active.values()) controller.abort();
    },
  };
}
