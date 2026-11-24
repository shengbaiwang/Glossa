import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ClosableFile } from '@/utils/file';
import type { PDFContentsReport } from '@/services/pdfAutoContents';
import { eventDispatcher } from '@/utils/event';
import { pdfContentsCheckpointStorage } from '@/services/pdfContentsCheckpoint';
import { enqueuePDFContentsTask } from '@/services/pdfContentsTaskQueue';

// Only the existing document-access services are passed to this bundled plugin.
type Host = Pick<AppService, 'resolveNativeBookFilePath' | 'loadBookContent'> &
  Partial<Pick<AppService, 'readFile' | 'writeFile' | 'deleteFile'>>;
type PreparationRequest = {
  regenerate?: boolean;
  notify?: boolean;
  autoContinue?: boolean;
  onReport?: (report: PDFContentsReport) => void;
};
export async function prepareContents(
  host: Host,
  book: Book,
  document: BookDoc | undefined,
  signal: AbortSignal,
  options: PreparationRequest = {},
): Promise<{ result: string; report?: PDFContentsReport }> {
  if (book.format !== 'PDF' || signal.aborted) return { result: 'cancelled' };
  try {
    return await enqueuePDFContentsTask(
      () => prepareContentsNow(host, book, document, signal, options),
      signal,
    );
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError'))
      return { result: 'cancelled' };
    throw error;
  }
}

async function prepareContentsNow(
  host: Host,
  book: Book,
  document: BookDoc | undefined,
  signal: AbortSignal,
  options: PreparationRequest,
): Promise<{ result: string; report?: PDFContentsReport }> {
  if (signal.aborted) return { result: 'cancelled' };
  const { supportsLocalPDF, openPDFCache } = await import('@/services/pdfEnhancement');
  if (signal.aborted || !supportsLocalPDF()) return { result: 'unavailable' };
  let owned: BookDoc | undefined;
  let file: ClosableFile | undefined;
  let report: PDFContentsReport | undefined;
  let result = 'unavailable';
  try {
    const source = await host.resolveNativeBookFilePath(book);
    if (signal.aborted || !source) return { result: signal.aborted ? 'cancelled' : 'unavailable' };
    if (!document) {
      const cache = await openPDFCache(source, false, {
        bookId: book.hash,
        revision: book.removal?.revision ?? 0,
      });
      if (signal.aborted) return { result: 'cancelled' };
      if (
        cache &&
        ((!cache.generator && (cache.outline !== null || cache.revision > 0)) ||
          (!options.regenerate && cache.generator === 'glossa-contents-3' && cache.outline?.length))
      )
        return { result: 'preserved' };
      file = (await host.loadBookContent(book)).file as ClosableFile;
      if (signal.aborted) return { result: 'cancelled' };
      const { DocumentLoader } = await import('@/libs/document');
      if (signal.aborted) return { result: 'cancelled' };
      owned = (await new DocumentLoader(file).open()).book;
      document = owned;
    }
    if (signal.aborted || !document) return { result: 'cancelled' };
    const { preparePDFContents } = await import('@/services/pdfAutoContents');
    if (signal.aborted) return { result: 'cancelled' };
    const owner = { bookId: book.hash, revision: book.removal?.revision ?? 0 };
    const checkpoint = pdfContentsCheckpointStorage(host, owner);
    const deadline = performance.now() + 540_000;
    for (let round = 0; round < (options.autoContinue ? 3 : 1); round++) {
      const timeoutMs = deadline - performance.now();
      if (timeoutMs <= 0 || signal.aborted) break;
      const roundReport: { value?: PDFContentsReport } = {};
      const receive = (value: PDFContentsReport) => {
        roundReport.value = value;
        options.onReport?.(value);
      };
      try {
        result = await preparePDFContents(source, document, signal, receive, {
          regenerate: options.regenerate,
          owner,
          checkpoint,
          timeoutMs,
        });
      } catch {
        // The service also reports bounded interruptions that throw. A durable
        // cursor, rather than the transport of the error, controls continuation.
        result = 'unavailable';
      }
      report = roundReport.value;
      if (result !== 'unavailable' || !report?.canResume || !report.checkpointAdvanced) break;
    }
  } catch {
    // The preparation report holds only safe phase/error codes. Preserve the
    // imported book and all native checkpoints for the next explicit retry.
  } finally {
    try {
      await owned?.destroy?.();
    } catch {}
    try {
      await file?.close?.();
    } catch {}
  }
  if (options.notify !== false && !signal.aborted && result === 'unavailable') {
    const { default: i18n } = await import('i18next');
    if (signal.aborted) return { result: 'cancelled', report };
    const code = report?.code;
    const message =
      code === 'pdf_contents_timeout' || code === 'pdf_contents_ocr_limit'
        ? 'Contents preparation reached its limit. Import this PDF again to continue. Page navigation is available.'
        : code?.endsWith('_limit')
          ? 'This PDF exceeds automatic contents limits. Page navigation is available.'
          : report?.stage === 'ocr' || code === 'pdf_access_denied'
            ? 'Local text recognition could not finish. Import this PDF again to retry. Page navigation is available.'
            : report?.stage === 'save'
              ? 'Contents could not be saved. Import this PDF again to retry. Page navigation is available.'
              : 'A reliable contents list could not be verified. Page navigation is available.';
    void eventDispatcher.dispatch('toast', {
      type: 'info',
      message: `${book.title}: ${i18n.t(message, { defaultValue: message })}`,
    });
  }
  return { result: signal.aborted ? 'cancelled' : result, report };
}
