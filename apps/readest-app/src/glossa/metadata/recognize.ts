import type { BookDoc } from '@/libs/document';
import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { ClosableFile } from '@/utils/file';
import { resolveBookContentSource } from '@/services/bookContent';
import { fingerprintPath, libraryIdentityIO } from '@/services/bookIdentity';
import { importResourceGate } from '@/services/importTaskQueue';
import { metadataFingerprint, saveMetadataRecognition } from './storage';
import {
  deduplicateCandidates,
  extractCopyrightMetadata,
  extractFileMetadata,
  extractFrontMatterAuthors,
  scoreCopyrightPage,
} from './extract';
import type { MetadataCandidate, MetadataRecognition } from './types';

const MAX_PAGE_TEXT = 24000;
const textUsable = (text: string) =>
  text.replace(/[\s\uFFFD]/g, '').length >= 20 &&
  (text.match(/\uFFFD/g)?.length ?? 0) < text.length / 20;
/** Old PDF layers can be nonempty yet too damaged for bibliographic extraction. */
export function metadataTextNeedsOCR(text: string): boolean {
  if (!textUsable(text)) return true;
  const sample = text.slice(0, MAX_PAGE_TEXT);
  const fragmented = sample.match(/(?:[a-zA-Z][ \t]){3,}[a-zA-Z]/g) ?? [];
  if (fragmented.join('').length > sample.length / 5) return true;
  if ((sample.match(/[\uE000-\uF8FF]/g)?.length ?? 0) > sample.length / 50) return true;
  return (
    /\bCIP\b/i.test(sample) &&
    /\bISBN\b/i.test(sample) &&
    !extractCopyrightMetadata(sample, { kind: 'text', label: 'Copyright page', excerpt: '' }).some(
      (item) => item.field === 'isbn',
    )
  );
}
export function metadataScanIndices(total: number, expanded = false): number[] {
  const first = expanded ? 40 : 16;
  const last = expanded ? 16 : 8;
  return [
    ...new Set([
      ...Array.from({ length: Math.min(first, total) }, (_, i) => i),
      ...Array.from({ length: Math.min(last, total) }, (_, i) => total - Math.min(last, total) + i),
    ]),
  ];
}

/** Only explicitly selected local book bytes reach the recognizer. No URL fallback. */
export async function recognizeBookMetadata(
  book: Book,
  envConfig: EnvConfigType,
  signal: AbortSignal,
  options: { expanded?: boolean; onStage?: (stage: string) => void } = {},
): Promise<MetadataRecognition> {
  signal.throwIfAborted();
  if (book.deletedAt) throw new Error('metadata_book_deleted');
  const app = await envConfig.getAppService();
  const io = libraryIdentityIO(app);
  const source = await resolveBookContentSource(io, book);
  signal.throwIfAborted();
  if (source.kind !== 'managed' && source.kind !== 'external')
    throw new Error('metadata_local_file_required');
  let fingerprint = '';
  let file: ClosableFile | undefined;
  let doc: BookDoc | undefined;
  let lease: { release: () => void } | undefined;
  let cache: Awaited<ReturnType<typeof import('@/services/pdfEnhancement').openPDFCache>> = null;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const activeSignal = controller.signal;
  try {
    lease = await importResourceGate.acquire(undefined, activeSignal);
    activeSignal.throwIfAborted();
    timer = setTimeout(() => controller.abort(new Error('metadata_time_limit')), 90000);
    options.onStage?.('Verifying local file');
    fingerprint = await fingerprintPath(io, source.path, source.base, activeSignal);
    const expected = metadataFingerprint(book);
    if (expected && expected !== fingerprint) throw new Error('metadata_source_changed');
    activeSignal.throwIfAborted();
    file = (await app.openFile(source.path, source.base)) as ClosableFile;
    activeSignal.throwIfAborted();
    options.onStage?.('Reading file metadata');
    const { DocumentLoader } = await import('@/libs/document');
    const opened = await new DocumentLoader(file, {
      loadPDFCache: false,
      autoPDFOCR: false,
    }).open();
    doc = opened.book;
    activeSignal.throwIfAborted();
    const candidates = extractFileMetadata(doc.metadata);
    const frontMatter: Parameters<typeof extractFrontMatterAuthors>[0] = [];
    let indices = metadataScanIndices(doc.sections.length, options.expanded);
    const eligibleForOCR = new Set([
      ...Array.from(
        { length: Math.min(options.expanded ? 16 : 8, doc.sections.length) },
        (_, i) => i,
      ),
      ...Array.from(
        { length: Math.min(options.expanded ? 8 : 4, doc.sections.length) },
        (_, i) =>
          doc!.sections.length - Math.min(options.expanded ? 8 : 4, doc!.sections.length) + i,
      ),
    ]);
    let found = false;
    let limited = indices.length < doc.sections.length;
    let unavailableOCR = false;
    let ocrCount = 0;
    const pdf = await import('@/services/pdfEnhancement');
    let nativePath: string | null = null;
    if (book.format === 'PDF' && pdf.supportsLocalPDF()) {
      nativePath = await app.resolveNativeBookFilePath(book);
      activeSignal.throwIfAborted();
      if (nativePath)
        cache = await pdf.openPDFCache(
          nativePath,
          true,
          { bookId: book.hash, revision: book.removal?.revision ?? 0 },
          true,
        );
    }
    const copyrightSections = new Set<number>();
    // Copyright landmarks can point to a section in the middle of an EPUB.
    if (book.format === 'EPUB') {
      const epub = doc as BookDoc & { landmarks?: { type?: string[]; href?: string }[] };
      const landmarks = (epub.landmarks ?? [])
        .filter((item) => item.type?.includes('copyright-page'))
        .map((item) => item.href?.split('#')[0]);
      const semantic = doc.sections.flatMap((section, index) =>
        landmarks.includes(section.href ?? section.id) ? [index] : [],
      );
      for (const index of semantic.slice(0, 8)) copyrightSections.add(index);
      indices = [...new Set([...copyrightSections, ...indices])];
    }
    for (const index of indices) {
      activeSignal.throwIfAborted();
      options.onStage?.('Finding copyright page');
      const section = doc.sections[index];
      if (!section) continue;
      let text = '';
      let dom: Document | undefined;
      let kind: MetadataCandidate['source']['kind'] = 'text';
      let semantic = copyrightSections.has(index);
      const sectionPath = section.href ?? section.id;
      if (book.format === 'PDF')
        text = ((await doc.getPDFText?.(index)) ?? '').slice(0, MAX_PAGE_TEXT);
      else if (book.format === 'EPUB') {
        dom = await section.createDocument();
        activeSignal.throwIfAborted();
        semantic ||= !!dom.querySelector(
          '[epub\\:type~="copyright-page"], [type~="copyright-page"]',
        );
        dom.querySelectorAll('script,style,noscript').forEach((node) => node.remove());
        dom
          .querySelectorAll('p,div,li,br,h1,h2,h3,h4,tr,section')
          .forEach((node) => node.append(dom!.createTextNode('\n')));
        text = (dom.body?.textContent ?? dom.documentElement?.textContent ?? '').slice(
          0,
          MAX_PAGE_TEXT,
        );
      } else break;
      activeSignal.throwIfAborted();
      const originalText = text;
      if (
        metadataTextNeedsOCR(text) &&
        (semantic || eligibleForOCR.has(index)) &&
        ocrCount < (options.expanded ? 24 : 12)
      ) {
        if (book.format === 'PDF' && cache && nativePath) {
          options.onStage?.('Recognizing copyright page text');
          // Discovery OCR has its own versioned sidecar. Reading OCR deliberately
          // preserves native text and CFI offsets, including damaged old layers.
          let page = await pdf.readOCRPage(cache.id, index, false, true);
          activeSignal.throwIfAborted();
          if (!page || pdf.needsOCRRecovery(page) || metadataTextNeedsOCR(pdf.OCRPageText(page))) {
            ocrCount++;
            const { recognizePDFPages } = await import('@/services/pdfOCR');
            await recognizePDFPages(
              nativePath,
              cache.id,
              [index],
              activeSignal,
              undefined,
              false,
              true,
              false,
              cache.session ?? undefined,
            );
            activeSignal.throwIfAborted();
            page = await pdf.readOCRPage(cache.id, index, false, true);
          }
          if (page) {
            const recognized = pdf.OCRPageText(page).slice(0, MAX_PAGE_TEXT);
            if (
              textUsable(recognized) &&
              (!textUsable(text) ||
                !metadataTextNeedsOCR(recognized) ||
                scoreCopyrightPage(recognized) >= scoreCopyrightPage(text))
            ) {
              text = recognized;
              kind = 'ocr';
            }
          }
        } else if (book.format === 'EPUB' && pdf.supportsLocalPDF() && dom && doc.loadBlob) {
          const image = dom.querySelector('img[src], image');
          const raw =
            image?.getAttribute('src') ??
            image?.getAttribute('href') ??
            image?.getAttribute('xlink:href');
          if (raw && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) {
            const href = decodeURIComponent(
              new URL(raw, `https://epub.local/${sectionPath ?? ''}`).pathname.slice(1),
            );
            const blob = await doc.loadBlob(href);
            activeSignal.throwIfAborted();
            if (blob && blob.size <= 8 * 1024 * 1024) {
              ocrCount++;
              options.onStage?.('Recognizing copyright page text');
              const { recognizeMetadataImage } = await import('./imageOCR');
              const recognized = (await recognizeMetadataImage(blob, activeSignal)).slice(
                0,
                MAX_PAGE_TEXT,
              );
              if (
                textUsable(recognized) &&
                (!textUsable(text) ||
                  !metadataTextNeedsOCR(recognized) ||
                  scoreCopyrightPage(recognized) >= scoreCopyrightPage(text))
              ) {
                text = recognized;
                kind = 'ocr';
              }
            }
          }
        } else unavailableOCR = true;
      } else if (metadataTextNeedsOCR(text)) limited = true;
      activeSignal.throwIfAborted();
      const uncertain = metadataTextNeedsOCR(text);
      if (
        kind === 'ocr' &&
        originalText !== text &&
        textUsable(originalText) &&
        scoreCopyrightPage(originalText, semantic) >= 5
      ) {
        const recognizedNames = extractCopyrightMetadata(text, {
          kind,
          label: 'Copyright page',
          excerpt: '',
        });
        // A cleaner-looking OCR page can still misspell a person's name. Keep
        // the independent native spelling as evidence so a conflict needs review.
        candidates.push(
          ...extractCopyrightMetadata(originalText, {
            kind: 'text',
            label: 'Copyright page',
            excerpt: '',
            ...(book.format === 'PDF' ? { pageIndex: index } : { href: sectionPath }),
          })
            .filter(
              (item) =>
                (item.field === 'author' || item.field === 'translator') &&
                !recognizedNames.some(
                  (recognized) =>
                    recognized.field === item.field && recognized.value === item.value,
                ),
            )
            .map(
              (item): MetadataCandidate => ({
                ...item,
                confidence: 'review',
                reason: 'Uncertain text recognition',
              }),
            ),
        );
      }
      if (index < 8 || scoreCopyrightPage(text, semantic) >= 5)
        frontMatter.push({
          index,
          text,
          uncertain,
          source: {
            kind,
            label: 'Copyright page',
            excerpt: '',
            ...(book.format === 'PDF' ? { pageIndex: index } : { href: sectionPath }),
          },
        });
      if (scoreCopyrightPage(text, semantic) >= 5) {
        found ||= scoreCopyrightPage(text, semantic) >= 5;
        candidates.push(
          ...extractCopyrightMetadata(text, {
            kind,
            label: 'Copyright page',
            excerpt: '',
            ...(book.format === 'PDF' ? { pageIndex: index } : { href: sectionPath }),
          }).map(
            (item): MetadataCandidate =>
              uncertain
                ? { ...item, confidence: 'review', reason: 'Uncertain text recognition' }
                : item,
          ),
        );
      }
      // Yield between pages so reading and cancellation remain responsive.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    candidates.push(...extractFrontMatterAuthors(frontMatter));
    activeSignal.throwIfAborted();
    options.onStage?.('Verifying local file');
    if ((await fingerprintPath(io, source.path, source.base, activeSignal)) !== fingerprint)
      throw new Error('metadata_source_changed');
    activeSignal.throwIfAborted();
    const result: MetadataRecognition = {
      version: 1,
      fingerprint,
      candidates: deduplicateCandidates(candidates).slice(0, 128),
      complete:
        !['EPUB', 'PDF'].includes(book.format) ||
        found ||
        (!limited && !unavailableOCR && (book.format === 'EPUB' || book.format === 'PDF')),
      ...(!['EPUB', 'PDF'].includes(book.format)
        ? { reason: 'metadata_file_metadata_only' }
        : !found
          ? {
              reason: unavailableOCR
                ? 'metadata_ocr_unavailable'
                : limited
                  ? 'metadata_scan_limit'
                  : 'metadata_copyright_not_found',
            }
          : {}),
    };
    options.onStage?.('Saving recognition candidates');
    await saveMetadataRecognition(book, envConfig, result, activeSignal);
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    if (cache)
      await (await import('@/services/pdfEnhancement'))
        .releasePDFSourceSession(cache)
        .catch(() => {});
    try {
      await doc?.destroy?.();
    } catch {}
    try {
      await file?.close?.();
    } catch {}
    lease?.release();
  }
}

/** Adoption rechecks the current local bytes; opening the information view does not. */
export async function verifyMetadataSource(
  book: Book,
  envConfig: EnvConfigType,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const io = libraryIdentityIO(await envConfig.getAppService());
  const source = await resolveBookContentSource(io, book);
  if (source.kind !== 'managed' && source.kind !== 'external')
    throw new Error('metadata_local_file_required');
  const fingerprint = await fingerprintPath(io, source.path, source.base, signal);
  signal.throwIfAborted();
  const expected = metadataFingerprint(book);
  if (expected && fingerprint !== expected) throw new Error('metadata_source_changed');
  return fingerprint;
}
