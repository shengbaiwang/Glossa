import { needsOCRRecovery, readOCRPage, type OCRPage, type PDFCache } from './pdfEnhancement';
import { recognizePDFPages } from './pdfOCR';

// Only loaded reader pages enter this queue. Search/import/thumbnail parsing
// never schedules recognition. One worker at a time, including multiple books.
let pending: Promise<unknown> = Promise.resolve();
export function createPDFReadingOCR(source: string, cache: PDFCache) {
  const controller = new AbortController();
  const attempts = new Map<
    number,
    { task: Promise<OCRPage | null>; consumers: Set<() => boolean> }
  >();
  const failed = new Set<number>();
  return {
    recognize(index: number, current: () => boolean) {
      if (controller.signal.aborted) return Promise.resolve(null);
      if (failed.has(index)) return Promise.reject(new Error('pdf_recognition_failed'));
      const existingAttempt = attempts.get(index);
      if (existingAttempt) {
        existingAttempt.consumers.add(current);
        return existingAttempt.task;
      }
      const consumers = new Set([current]);
      const isCurrent = () => [...consumers].some((connected) => connected());
      const task = pending.then(async () => {
        if (controller.signal.aborted || !isCurrent()) return null;
        const existing = await readOCRPage(cache.id, index);
        if (existing && !needsOCRRecovery(existing)) return existing;
        const timeout = new AbortController();
        const abort = () => timeout.abort();
        controller.signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 30_000);
        try {
          if (controller.signal.aborted || !isCurrent()) return null;
          const done = await recognizePDFPages(source, cache.id, [index], timeout.signal);
          if (done.state !== 'completed') throw new Error(done.error ?? 'pdf_recognition_failed');
          const page = await readOCRPage(cache.id, index);
          if (!page || needsOCRRecovery(page)) throw new Error('pdf_recognition_failed');
          return page;
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', abort);
        }
      });
      // Bound failed/no-longer-visible attempts too; no automatic retry loops.
      attempts.set(index, { task, consumers });
      pending = task.then(
        () => attempts.delete(index),
        () => {
          failed.add(index);
          attempts.delete(index);
        },
      );
      return task;
    },
    destroy() {
      controller.abort();
      attempts.clear();
    },
  };
}
