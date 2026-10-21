import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ClosableFile } from '@/utils/file';
import type { PDFContentsReport } from '@/services/pdfAutoContents';
import { eventDispatcher } from '@/utils/event';

// Only the existing document-access services are passed to this bundled plugin.
type Host = Pick<AppService, 'resolveNativeBookFilePath' | 'loadBookContent'>;
export async function prepareContents(
  host: Host,
  book: Book,
  document: BookDoc | undefined,
  signal: AbortSignal,
): Promise<void> {
  if (book.format !== 'PDF' || signal.aborted) return;
  const { supportsLocalPDF, openPDFCache } = await import('@/services/pdfEnhancement');
  if (signal.aborted || !supportsLocalPDF()) return;
  let owned: BookDoc | undefined;
  let file: ClosableFile | undefined;
  let report: PDFContentsReport | undefined;
  let result = 'unavailable';
  try {
    const source = await host.resolveNativeBookFilePath(book);
    if (signal.aborted || !source) return;
    if (!document) {
      const cache = await openPDFCache(source);
      if (signal.aborted) return;
      if (
        cache &&
        ((!cache.generator && (cache.outline !== null || cache.revision > 0)) ||
          (cache.generator === 'glossa-contents-3' && cache.outline?.length))
      )
        return;
      file = (await host.loadBookContent(book)).file as ClosableFile;
      if (signal.aborted) return;
      const { DocumentLoader } = await import('@/libs/document');
      if (signal.aborted) return;
      owned = (await new DocumentLoader(file).open()).book;
      document = owned;
    }
    if (signal.aborted || !document) return;
    const { preparePDFContents } = await import('@/services/pdfAutoContents');
    if (signal.aborted) return;
    result = await preparePDFContents(source, document, signal, (value) => {
      report = value;
    });
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
  if (!signal.aborted && result === 'unavailable') {
    const { default: i18n } = await import('i18next');
    if (signal.aborted) return;
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
}
