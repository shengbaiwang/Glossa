import { cancelPDFOCR, startPDFOCR, waitForPDFOCR, type PDFOCRStatus } from './pdfEnhancement';

let pending: Promise<unknown> = Promise.resolve();
const cancelled = () => new DOMException('Cancelled', 'AbortError');
function until<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/** All three OCR callers share ownership; a busy native worker is never stolen. */
export function recognizePDFPages(
  source: string,
  cacheId: string,
  pages: number[],
  callerSignal: AbortSignal,
  onStatus: (status: PDFOCRStatus) => void = () => {},
  detect = false,
  contents = false,
  heading = false,
  session?: string,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  callerSignal.addEventListener('abort', abort, { once: true });
  if (callerSignal.aborted) abort();
  const timer = setTimeout(abort, 1_800_000);
  const signal = controller.signal;
  const task = pending.then(async () => {
    const check = () => {
      if (signal.aborted) throw cancelled();
    };
    let owned: PDFOCRStatus | undefined;
    let stopping: Promise<unknown> | undefined;
    const stop = () => {
      if (owned && !stopping)
        stopping = Promise.resolve(
          owned.jobId ? cancelPDFOCR(cacheId, owned.jobId) : cancelPDFOCR(cacheId),
        ).catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    try {
      for (;;) {
        check();
        try {
          // Do not detach a late start: establish its ownership before cancellation.
          owned = session
            ? await startPDFOCR(source, cacheId, pages, detect, contents, heading, session)
            : heading
              ? await startPDFOCR(source, cacheId, pages, false, false, true)
              : contents
                ? await startPDFOCR(source, cacheId, pages, false, true)
                : detect
                  ? await startPDFOCR(source, cacheId, pages, true)
                  : await startPDFOCR(source, cacheId, pages);
          break;
        } catch (error) {
          if ((error instanceof Error ? error.message : String(error)) !== 'pdf_ocr_busy')
            throw error;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await until(
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, 300);
              }),
              signal,
            );
          } finally {
            clearTimeout(timer);
          }
        }
      }
      check();
      onStatus(owned);
      const done = await until(waitForPDFOCR(cacheId, signal, onStatus, owned.jobId), signal);
      check();
      // A failed/finished worker no longer belongs to this request.
      owned = undefined;
      return done;
    } finally {
      if (owned) stop();
      await stopping;
      signal.removeEventListener('abort', stop);
    }
  });
  pending = task.catch(() => {});
  return until(task, signal).finally(() => {
    clearTimeout(timer);
    callerSignal.removeEventListener('abort', abort);
  });
}
