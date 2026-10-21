import { z } from 'zod';
import type { BookDoc, TOCItem } from '@/libs/document';
import { createDerivedStore, hashData } from '@/glossa/harness/derivedStore';
import {
  OCRContentsLines,
  OCRPageText,
  openPDFCache,
  readOCRPage,
  savePDFOutline,
  needsOCRRecovery,
  type PDFOutlineEntry,
  type OCRPage,
} from './pdfEnhancement';
import { recognizePDFPages } from './pdfOCR';

const MAX_OCR_PAGES = 96;
const MAX_ENTRIES = 128;
const GENERATOR = 'glossa-contents-3';
const EXTRACTOR = 'pdf-contents-6';
const operationSchema = z.enum([
  'cache_read',
  'native_text',
  'native_layout',
  'detection_read',
  'fine_ocr',
  'detection_ocr',
]);
const reportSchema = z.object({
  algorithm: z.enum(['pdf-contents-4', 'pdf-contents-5', 'pdf-contents-6']),
  stage: z.enum(['open', 'embedded', 'discovery', 'extraction', 'ocr', 'verification', 'save']),
  state: z.enum(['running', 'completed', 'unavailable', 'failed', 'cancelled']),
  code: z
    .string()
    .regex(/^[a-z_0-9]{1,80}$/)
    .optional(),
  updatedAt: z.number().finite(),
  operation: operationSchema.optional(),
  pageIndex: z.number().int().min(0).max(999).optional(),
  errorKind: z
    .enum(['type_error', 'range_error', 'abort_error', 'error', 'native_error'])
    .optional(),
});
export type PDFContentsReport = z.infer<typeof reportSchema>;
// OCR, extraction and evidence checks have independent versions.
const checksSchema = z.object({
  run: reportSchema.optional(),
  verifier: z.literal('pdf-heading-2'),
  entries: z
    .array(
      z.object({
        title: z.string().max(500),
        index: z.number().int().min(0).max(999),
        evidence: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(MAX_ENTRIES),
});
const checksStore = createDerivedStore('glossa-pdf-contents', checksSchema, {
  entryBytes: 128000,
  entries: 16,
  totalBytes: 2000000,
});
const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/衞/g, '衛')
    .replace(/[\s\p{P}\p{S}\p{Cc}]/gu, '');
const isContentsLine = (text: string) =>
  /^(?:(?:\d+|[ivxlcdm]+)\s+)?(?:目\s*[录錄]|(?:table\s+of\s+)?contents)(?:\s+(?:\d+|[ivxlcdm]+))?$/i.test(
    text.trim(),
  );
const contentsLines = (text: string) => text.replace(/目\s*\n\s*([录錄])/g, '目$1').split('\n');
const isContents = (text: string) => contentsLines(text).some(isContentsLine);
const isOtherIndex = (text: string) =>
  /^(?:(?:\d+|[ivxlcdm]+)\s+)?(?:插[图圖]目[录錄]|[图圖表]目[录錄]|(?:list\s+of\s+)?(?:illustrations|figures|tables|maps|plates))(?:\s+(?:\d+|[ivxlcdm]+))?$/i.test(
    text
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? '',
  );
// These are section groupings with dates, not destinations with page numbers.
const isGrouping = (text: string) =>
  /^(?:第[一二三四五六七八九十\d]+部分|part\s+[ivxlcdm\d]+)\s*\d{4}\s*[-—–~～至]\s*\d{4}$/i.test(
    text.trim(),
  );
const validTitle = (text: string) => text.length >= 2 || /^\p{Script=Han}$/u.test(text);
const bareTitle = (text: string) =>
  normalize(text.replace(/^[一二三四五六七八九十百零〇]+[、.．\s]+(?=\S)/u, '')).replace(
    /^(?:第[\d一二三四五六七八九十百零〇]+[章节部篇]|(?:chapter|part)\d+|\d+(?:\d+)*)/,
    '',
  );
// Normalize a page once. Comparing every title against every page otherwise
// repeats Unicode normalization hundreds of thousands of times on long books.
const headingMatcher = (text: string) => {
  const lines = text.split('\n');
  const candidates = lines.flatMap((line, index) => {
    let joined = line.trim().replace(/[①-⑳❶-❿]+$/u, '');
    const values = [{ text: normalize(joined), bare: bareTitle(joined), index }];
    for (const next of lines.slice(index + 1, index + 4)) {
      if (!next.trim() || joined.length > 500) break;
      joined += `\n${next.trim().replace(/[①-⑳❶-❿]+$/u, '')}`;
      values.push({ text: normalize(joined), bare: bareTitle(joined), index });
    }
    return values;
  });
  const exact = new Set(candidates.map((candidate) => candidate.text));
  const bareHeadings = new Set(candidates.map((candidate) => candidate.bare));
  return (title: string, ocr = false) => {
    const full = normalize(title);
    const bare = bareTitle(title);
    if (!validTitle(full)) return false;
    const indexHeading = /^listof(?:illustrations|figures|tables|maps|plates)$/.test(full)
      ? full.slice(6)
      : full;
    if (
      exact.has(full) ||
      (bare.length >= 4 && exact.has(bare)) ||
      bareHeadings.has(full) ||
      exact.has(indexHeading)
    )
      return true;
    const number = full.match(/^第[\d一二三四五六七八九十百零〇]+[章节部篇]/)?.[0];
    if (!ocr || !number || bare.length < 8) return false;
    return candidates.some((candidate) => {
      if (candidate.index >= 10 || !candidate.text.startsWith(number)) return false;
      const actual = bareTitle(candidate.text);
      return (
        actual.length === bare.length - 1 &&
        [...bare].some(
          (char, i) =>
            /\p{Script=Han}/u.test(char) && bare.slice(0, i) + bare.slice(i + 1) === actual,
        )
      );
    });
  };
};
const romanNumber = (value: string) => {
  const digits: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  return [...value.toLowerCase()].reduce((n, c, i, all) => {
    const digit = digits[c] ?? 0;
    return n + (digit < (digits[all[i + 1]!] ?? 0) ? -digit : digit);
  }, 0);
};
type Row = {
  title: string;
  base: number | null;
  level: number;
  system?: 'roman' | 'arabic';
  printed?: number;
};

type PrintedLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  words: OCRPage['lines'];
};
function printedLines(page: OCRPage | null): PrintedLine[] {
  const rows: PrintedLine[] = [];
  let words: NonNullable<typeof page>['lines'] = [];
  for (const word of page?.lines ?? []) {
    words.push(word);
    if (!word.endLine) continue;
    const x = Math.min(...words.map((w) => w.x));
    const y = Math.min(...words.map((w) => w.y));
    rows.push({
      text: words.map((w) => w.text).join(''),
      x,
      y,
      width: Math.max(...words.map((w) => w.x + w.width)) - x,
      height: Math.max(...words.map((w) => w.y + w.height)) - y,
      words,
    });
    words = [];
  }
  return rows;
}

// Re-read the same printed fragments at another precise raster size. Uncovered
// original fragments remain candidates: an alternate pass cannot erase a row.
function contentsEvidence(primary: OCRPage, alternate: OCRPage): OCRPage {
  const replacement = printedLines(alternate);
  const retained = printedLines(primary).filter(
    (row) =>
      !replacement.some((other) => {
        const vertical =
          Math.min(row.y + row.height, other.y + other.height) - Math.max(row.y, other.y);
        const horizontal =
          Math.min(row.x + row.width, other.x + other.width) - Math.max(row.x, other.x);
        const ratio = row.width / other.width;
        return (
          vertical >= Math.min(row.height, other.height) * 0.5 &&
          horizontal >= Math.min(row.width, other.width) * 0.8 &&
          ratio >= 0.7 &&
          ratio <= 1.4
        );
      }),
  );
  return { ...alternate, lines: [...replacement, ...retained].flatMap((row) => row.words) };
}

// A header template is established above an explicit Contents label. Only
// matching marginal geometry may identify it on continuation pages; chapter
// title verification never uses this tolerance or modifies OCR text.
function isRunningHeader(line: PrintedLine, header: PrintedLine) {
  const a = normalize(line.text);
  const b = normalize(header.text);
  return (
    line.y < 0.1 &&
    Math.abs(line.y - header.y) < 0.015 &&
    Math.abs(line.x - header.x) < 0.04 &&
    Math.abs(line.width - header.width) < 0.08 &&
    Math.abs(line.height - header.height) <= header.height * 0.25 &&
    a.length >= 8 &&
    a.length === b.length &&
    [...a].filter((char, i) => char !== b[i]).length <= 1
  );
}
function sameFolioHeader(a: PrintedLine, b: PrintedLine) {
  const title = (line: PrintedLine) => line.text.replace(/^\d{1,4}\s+|\s+\d{1,4}$/g, '');
  const folio = (line: PrintedLine) => line.text.match(/^\d{1,4}(?=\s)|\d{1,4}$/)?.[0];
  const text = normalize(title(a));
  return (
    a.y < 0.1 &&
    b.y < 0.1 &&
    title(a) !== a.text &&
    title(b) !== b.text &&
    folio(a) !== folio(b) &&
    text.length >= 6 &&
    text === normalize(title(b)) &&
    Math.abs(a.x - b.x) < 0.04 &&
    Math.abs(a.y - b.y) < 0.015 &&
    Math.abs(a.width - b.width) < 0.04 &&
    Math.abs(a.height - b.height) < 0.01
  );
}
// Only use a visibly separated interior title to disambiguate a missing page
// number from repeated running headers. Ambiguous layouts keep page navigation.
function prominentTitles(page: import('./pdfEnhancement').OCRPage | null) {
  const rows: { text: string; top: number; bottom: number }[] = [];
  let words: NonNullable<typeof page>['lines'] = [];
  for (const word of page?.lines ?? []) {
    words.push(word);
    if (!word.endLine) continue;
    rows.push({
      text: words.map((w) => w.text).join(''),
      top: Math.min(...words.map((w) => w.y)),
      bottom: Math.max(...words.map((w) => w.y + w.height)),
    });
    words = [];
  }
  return rows
    .filter(
      (row) =>
        row.top >= 0.1 &&
        row.top <= 0.5 &&
        rows
          .filter((other) => other.top > row.bottom)
          .every((other) => other.top - row.bottom >= (row.bottom - row.top) * 2),
    )
    .map((row) => row.text);
}

function contentsRows(lines: string[], labels: string[], count: number, confirmed = false) {
  const rows: Row[] = [];
  let rejected = 0;
  for (const line of lines) {
    if (
      isGrouping(line) ||
      isContentsLine(line) ||
      /^(?:part|chapter)\s+[ivxlcdm\d]+$/i.test(line.trim())
    )
      continue;
    const cleaned = line.normalize('NFKC').trim();
    const match = confirmed
      ? (cleaned.match(/^(.+?)(?:\s*[.·…_。•⋯∙●‧﹒:：]+\s*|\s+)(\d{1,4}|[ivxlcdm]+)\s*$/i) ??
        cleaned.match(/^(.*?\p{Script=Han})(\d{1,4}|[ivxlcdm]+)\s*$/iu))
      : cleaned.match(/^(.+?)(?:\s*[.·…_。•⋯∙●‧﹒]{2,}\s*|\s+)(\d{1,4}|[ivxlcdm]+)\s*$/i);
    if (!match) continue;
    const title = match[1]!.replace(/[.·…_。•⋯∙●‧﹒\s]+$/, '').trim();
    if (!validTitle(title) || title.length > 500) {
      rejected++;
      continue;
    }
    const printed = match[2]!.toLowerCase();
    const indices = labels.flatMap((label, i) =>
      label.normalize('NFKC').trim().toLowerCase() === printed ? [i] : [],
    );
    const base =
      indices.length === 1
        ? indices[0]!
        : (/^\d+$/.test(printed) ? Number(printed) : romanNumber(printed)) - 1;
    if (base < 0 || base >= count) {
      rejected++;
      continue;
    }
    const decimal = title.match(/^(\d+(?:\.\d+)+)[.\s]/);
    const level = decimal
      ? Math.min(5, decimal[1]!.split('.').length - 1)
      : /^第.+节/.test(title)
        ? 1
        : 0;
    rows.push({
      title,
      base,
      level,
      system: /^\d+$/.test(printed) ? 'arabic' : 'roman',
      printed: /^\d+$/.test(printed) ? Number(printed) : romanNumber(printed),
    });
  }
  return { rows, rejected };
}
function flatten(toc: TOCItem[]): TOCItem[] {
  return toc.flatMap((item) => [item, ...flatten(item.subitems ?? [])]);
}

// The native recognizer owns one worker. Batch imports in this WebView must
// finish in order instead of failing every file after the first as "busy".
let preparation: Promise<unknown> = Promise.resolve();
export function preparePDFContents(
  source: string,
  book: BookDoc,
  signal?: AbortSignal,
  onReport?: (report: PDFContentsReport) => void,
) {
  const next = preparation.then(() => prepareContents(source, book, signal, onReport));
  preparation = next.catch(() => {});
  return next;
}

/** Local import preparation. Never persists a partial or unchecked chapter list. */
async function prepareContents(
  source: string,
  book: BookDoc,
  signal?: AbortSignal,
  onReport?: (report: PDFContentsReport) => void,
): Promise<'preserved' | 'generated' | 'unavailable'> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    abort();
  }, 180_000);
  const check = () => {
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  };
  const bounded = <T>(promise: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const stop = () => {
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      controller.signal.addEventListener('abort', stop, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener('abort', stop));
      if (controller.signal.aborted) stop();
    });
  let stage: PDFContentsReport['stage'] = 'open';
  let context: Pick<PDFContentsReport, 'operation' | 'pageIndex'> | undefined;
  const perform = async <T>(
    operation: z.infer<typeof operationSchema>,
    pageIndex: number,
    task: () => Promise<T>,
  ): Promise<T> => {
    context = { operation, pageIndex };
    const value = await bounded(task());
    context = undefined;
    return value;
  };
  let persist = async (_report: PDFContentsReport) => {};
  const report = async (
    state: PDFContentsReport['state'],
    code?: string,
    errorKind?: PDFContentsReport['errorKind'],
  ) => {
    const value: PDFContentsReport = {
      algorithm: EXTRACTOR,
      stage,
      state,
      code,
      updatedAt: Date.now(),
      ...context,
      ...(errorKind ? { errorKind } : {}),
    };
    // Reporting cannot turn optional navigation preparation into a failed import.
    try {
      onReport?.(value);
    } catch {}
    await persist(value).catch(() => {});
  };
  const phase = async (next: PDFContentsReport['stage']) => {
    if (stage === next) return;
    stage = next;
    await report('running');
    check();
  };
  let fallback = async () => {};
  const unavailable = async (code = 'pdf_contents_incomplete'): Promise<'unavailable'> => {
    await fallback();
    await report('unavailable', code);
    return 'unavailable';
  };
  const complete = async (result: 'preserved' | 'generated') => {
    await report('completed');
    return result;
  };
  try {
    await report('running');
    check();
    const cache = await bounded(openPDFCache(source, true));
    check();
    if (!cache || !book.getPDFText) return unavailable('pdf_contents_unavailable');
    // A user's saved outline always wins, including a deliberately empty one.
    if (!cache.generator && (cache.outline !== null || cache.revision > 0))
      return complete('preserved');
    if (cache.generator === GENERATOR && cache.outline?.length) return complete('preserved');
    const count = book.sections.length;
    if (count < 2 || count > 1000) return unavailable('pdf_contents_page_limit');
    const checksKey = await bounded(hashData({ id: cache.id, count })).catch(() => null);
    const checks = checksKey ? await bounded(checksStore.load(checksKey)).catch(() => null) : null;
    check();
    const verified = checks?.entries ?? [];
    persist = async (run) => {
      if (!checksKey) return;
      // Terminal status must survive our own timeout/cancellation. No book text
      // or raw native exception is stored; this cache has fixed eviction limits.
      const status = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          checksStore.save(
            checksKey,
            { verifier: 'pdf-heading-2', entries: verified, run },
            status.signal,
          ),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              status.abort();
              resolve();
            }, 1000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        status.abort();
      }
    };
    await report('running');
    const available = new Set(cache.pages);
    const matchers = new Map<string, ReturnType<typeof headingMatcher>>();
    const matchesHeading = (text: string, title: string, ocr = false) => {
      let matcher = matchers.get(text);
      if (!matcher) {
        matcher = headingMatcher(text);
        matchers.set(text, matcher);
      }
      return matcher(title, ocr);
    };
    const pages = new Map<
      number,
      {
        text: string;
        lines: string[];
        allLines: string[];
        prominent: string[];
        ocr: boolean;
        layout: OCRPage | null;
      }
    >();
    let ocrCount = 0;
    const attempted = new Set<number>();
    let characters = 0;
    const evidencePages = new Map<number, OCRPage | null>();
    const accurateEvidence = async (index: number) => {
      if (evidencePages.has(index)) return evidencePages.get(index)!;
      let page = await perform('cache_read', index, () =>
        readOCRPage(cache.id, index, false, true),
      );
      if (!page) {
        if (++ocrCount > MAX_OCR_PAGES) throw new Error('pdf_contents_ocr_limit');
        const previousStage = stage;
        await phase('ocr');
        const done = await perform('fine_ocr', index, () =>
          recognizePDFPages(source, cache.id, [index], controller.signal, undefined, false, true),
        );
        check();
        if (done.state !== 'completed') throw new Error(done.error ?? 'pdf_recognition_failed');
        await phase(previousStage);
        page = await perform('cache_read', index, () => readOCRPage(cache.id, index, false, true));
        if (!page) throw new Error('pdf_recognition_failed');
      }
      characters += OCRPageText(page).length;
      if (characters > 2_000_000) throw new Error('pdf_contents_text_limit');
      evidencePages.set(index, page);
      return page;
    };
    const fromOCR = (ocr: OCRPage) => ({
      text: OCRPageText(ocr),
      layout: ocr,
      ocr: !ocr.native,
      lines: OCRContentsLines(ocr),
      allLines: OCRContentsLines(ocr, true),
      prominent: prominentTitles(ocr),
    });
    const read = async (index: number) => {
      check();
      if (pages.has(index)) return pages.get(index)!;
      const ocr = available.has(index)
        ? await perform('cache_read', index, () => readOCRPage(cache.id, index))
        : null;
      check();
      const text =
        ocr && !ocr.native
          ? OCRPageText(ocr)
          : await perform('native_text', index, () => book.getPDFText!(index));
      check();
      characters += text.length;
      if (characters > 2_000_000) throw new Error('pdf_contents_text_limit');
      const lines =
        ocr && !ocr.native
          ? OCRContentsLines(ocr)
          : book.getPDFContentsLines
            ? await perform('native_layout', index, () => book.getPDFContentsLines!(index))
            : contentsLines(text);
      check();
      const page = {
        text,
        layout: ocr,
        ocr: !!ocr && !ocr.native,
        lines,
        allLines:
          ocr && !ocr.native
            ? OCRContentsLines(ocr, true)
            : book.getPDFContentsLines
              ? await perform('native_layout', index, () => book.getPDFContentsLines!(index, true))
              : contentsLines(text),
        prominent: prominentTitles(ocr),
      };
      pages.set(index, page);
      return page;
    };
    const recognize = async (indices: number[]) => {
      const missing = [...new Set(indices)].filter(
        (index) =>
          !attempted.has(index) &&
          !pages.get(index)?.text.trim() &&
          (!available.has(index) ||
            !pages.get(index)?.layout ||
            needsOCRRecovery(pages.get(index)!.layout)),
      );
      if (!missing.length) return;
      if (ocrCount + missing.length > MAX_OCR_PAGES) throw new Error('pdf_contents_ocr_limit');
      ocrCount += missing.length;
      missing.forEach((index) => attempted.add(index));
      check();
      const previousStage = stage;
      await phase('ocr');
      const done = await perform('fine_ocr', missing[0]!, () =>
        recognizePDFPages(source, cache.id, missing, controller.signal),
      );
      check();
      if (done.state !== 'completed') throw new Error(done.error ?? 'pdf_recognition_failed');
      await phase(previousStage);
      for (const index of missing) {
        available.add(index);
        pages.delete(index);
      }
    };
    // Detection text is never passed to verify(). It can only nominate pages.
    const previews = new Map<number, { text: string; lines: string[] }>();
    const rememberPreview = (index: number, page: import('./pdfEnhancement').OCRPage) => {
      const text = OCRPageText(page);
      characters += text.length;
      if (characters > 2_000_000) throw new Error('pdf_contents_text_limit');
      previews.set(index, { text, lines: OCRContentsLines(page) });
    };
    const detect = async (index: number) => {
      const page = await read(index);
      if (page.text.trim() || (page.layout && !needsOCRRecovery(page.layout))) return page.text;
      if (previews.has(index)) return previews.get(index)!.text;
      // Small batches amortize worker startup/polling while keeping discovery
      // progressive. Accurate OCR remains strictly page-demanded.
      const batch: number[] = [];
      for (let i = index; i < Math.min(count, index + 16); i++) {
        const known = await read(i);
        if (
          known.text.trim() ||
          (known.layout && !needsOCRRecovery(known.layout)) ||
          previews.has(i)
        )
          continue;
        const cached = await perform('detection_read', i, () => readOCRPage(cache.id, i, true));
        if (cached) rememberPreview(i, cached);
        else batch.push(i);
      }
      if (batch.length) {
        const previousStage = stage;
        await phase('ocr');
        const done = await perform('detection_ocr', batch[0]!, () =>
          recognizePDFPages(source, cache.id, batch, controller.signal, undefined, true),
        );
        check();
        if (done.state !== 'completed') throw new Error(done.error ?? 'pdf_recognition_failed');
        await phase(previousStage);
        for (const i of batch) {
          const preview = await perform('detection_read', i, () => readOCRPage(cache.id, i, true));
          if (!preview) throw new Error('pdf_recognition_failed');
          rememberPreview(i, preview);
        }
      }
      return previews.get(index)!.text;
    };
    const verify = async (index: number, title: string) => {
      if (index < 0 || index >= count) return false;
      await read(index);
      await recognize([index]);
      let page = await read(index);
      if (!matchesHeading(page.text, title, page.ocr) && page.ocr && page.text.trim()) {
        const alternate = await accurateEvidence(index);
        if (alternate && matchesHeading(OCRPageText(alternate), title, true)) {
          page = fromOCR(alternate);
          pages.set(index, page);
        }
      }
      const evidence = await bounded(hashData({ text: page.text, ocr: page.ocr })).catch(
        () => null,
      );
      check();
      if (
        evidence &&
        verified.some(
          (entry) => entry.index === index && entry.title === title && entry.evidence === evidence,
        )
      )
        return true;
      if (!matchesHeading(page.text, title, page.ocr)) return false;
      if (checksKey && evidence) {
        const old = verified.findIndex((entry) => entry.index === index && entry.title === title);
        if (old >= 0) verified.splice(old, 1);
        verified.push({ title, index, evidence });
        if (verified.length > MAX_ENTRIES) verified.shift();
        await bounded(
          checksStore.save(
            checksKey,
            {
              verifier: 'pdf-heading-2',
              entries: verified,
              run: { algorithm: EXTRACTOR, stage, state: 'running', updatedAt: Date.now() },
            },
            controller.signal,
          ),
        ).catch(() => {});
        check();
      }
      return true;
    };
    const embedded = flatten(book.toc ?? []);
    const pageNavigation =
      embedded.length === count &&
      embedded.every(
        (item, i) =>
          item.index === i && item.label === (book.pageList?.[i]?.label ?? String(i + 1)),
      );
    fallback = async () => {
      if (!expired || signal?.aborted) check();
      // Persist rejection of a bad embedded outline too. Reopening must not
      // bring its wrong links back; a later explicit import can retry discovery.
      if (embedded.length && !pageNavigation)
        await savePDFOutline(source, cache, null, count, 'glossa-pages-1');
    };
    await phase('embedded');
    // A complete previous result needs only the stable verifier, not discovery.
    if (cache.generator === 'glossa-contents-2' && cache.outline?.length) {
      let valid = true;
      for (const entry of cache.outline) {
        if (!(await verify(entry.pageIndex, entry.title))) {
          valid = false;
          break;
        }
      }
      if (valid) {
        await savePDFOutline(source, cache, cache.outline, count, GENERATOR);
        return complete('preserved');
      }
    }
    if (
      !pageNavigation &&
      embedded.length &&
      embedded.some((item) => !/^(?:目录|contents|tableofcontents)$/.test(normalize(item.label))) &&
      embedded.length <= MAX_ENTRIES &&
      embedded.every(
        (item) =>
          item.label.trim() &&
          Number.isInteger(item.index) &&
          item.index >= 0 &&
          item.index < count,
      )
    ) {
      let valid = true;
      for (const item of embedded) {
        if (!(await verify(item.index, item.label))) {
          valid = false;
          break;
        }
      }
      if (valid) {
        if (cache.generator) await savePDFOutline(source, cache, null, count, GENERATOR);
        return complete('preserved');
      }
    }

    // Discover actual contents pages, rather than parsing every numbered paragraph.
    // Even a broken outline can point to the real contents after a long preface.
    // Treat its destination as an untrusted hint, never as verified contents.
    await phase('discovery');
    const hints = [
      ...new Set(
        embedded
          .filter(
            (item) =>
              /^(?:目录|contents|tableofcontents)$/.test(normalize(item.label)) &&
              Number.isInteger(item.index) &&
              item.index >= 0 &&
              item.index < count,
          )
          .map((item) => item.index),
      ),
    ].slice(0, 4);
    let discovered: number | undefined;
    for (const index of hints) {
      if (isContents(await detect(index))) {
        discovered = index;
        break;
      }
    }
    // Native text and existing accurate OCR are cheap: inspect the whole book,
    // including a late TOC, before spending any OCR on discovery.
    for (let i = 0; i < count; i++) await read(i);
    if (discovered === undefined)
      discovered = [...pages].find(([, page]) => isContents(page.text))?.[0];
    const tableLike = (index: number) => {
      const lines = (previews.get(index)?.lines ?? pages.get(index)!.lines).filter((line) =>
        line.trim(),
      );
      const found = contentsRows(lines, [], count).rows.length;
      return found >= 4 || (found >= 2 && found === lines.length);
    };
    if (discovered === undefined) {
      let probes = 0;
      for (let i = 0; i < count; i++) {
        if (isContents(await detect(i))) {
          discovered = i;
          break;
        }
        // A coarse pass can corrupt the word "Contents" itself. Confirm a
        // few geometric table candidates now, instead of wasting the entire
        // discovery budget on the remaining hundreds of scanned pages.
        // Only accurate recognition of an explicit label ends this search.
        if (previews.has(i) && tableLike(i) && probes < 4) {
          probes++;
          await recognize([i]);
          if (isContents((await read(i)).text)) {
            discovered = i;
            break;
          }
        }
      }
    }
    if (discovered === undefined) {
      for (let i = 0; i < count; i++) {
        if (tableLike(i)) {
          discovered = i;
          break;
        }
      }
    }
    await phase('extraction');
    const labels = book.pageList?.map((item) => item.label) ?? [];
    const contentsPages = new Set<number>();
    const rows: Row[] = [];
    const runningHeaders: PrintedLine[] = [];
    const margins: { index: number; line: PrintedLine }[] = [];
    const marginalRows = new Map<Row, { index: number; line: PrintedLine }>();
    for (let index = discovered ?? count; index < count; index++) {
      await read(index);
      await recognize([index]);
      let page = await read(index);
      // Independent evidence is for contents extraction only. The durable
      // reading layer, selection offsets and annotations are never replaced.
      if (
        page.ocr &&
        page.layout &&
        (isContents(page.text) || contentsPages.has(index - 1) || tableLike(index))
      ) {
        const alternate = await accurateEvidence(index);
        if (alternate && !alternate.native)
          page = fromOCR(contentsEvidence(page.layout, alternate));
      }
      const namedContents = isContents(page.text);
      const continuation = contentsPages.has(index - 1);
      const geometricRows = printedLines(page.layout);
      const label = geometricRows.find((row) => isContentsLine(row.text));
      if (label) {
        for (const row of geometricRows) {
          if (
            row.y < 0.1 &&
            row.y + row.height + 0.02 < label.y &&
            normalize(row.text).length >= 8 &&
            !/\d/.test(row.text) &&
            !runningHeaders.some((header) => isRunningHeader(row, header))
          )
            runningHeaders.push(row);
        }
      }
      const excluded = geometricRows.filter((row) =>
        runningHeaders.some((header) => isRunningHeader(row, header)),
      );
      const tableLayout =
        page.layout && excluded.length
          ? {
              ...page.layout,
              lines: page.layout.lines.filter(
                (word) =>
                  !excluded.some(
                    (header) =>
                      word.y >= header.y &&
                      word.y + word.height <= header.y + header.height + 0.001,
                  ),
              ),
            }
          : null;
      let tableLines = contentsLines(
        (tableLayout ? OCRContentsLines(tableLayout, true) : page.allLines).join('\n'),
      );
      // Text above an explicit label is front matter, never a contents entry.
      const labelIndex = tableLines.findIndex(isContentsLine);
      if (labelIndex >= 0) tableLines = tableLines.slice(labelIndex + 1);
      const { rows: found, rejected } = contentsRows(
        namedContents || continuation ? tableLines : page.lines,
        labels,
        count,
        namedContents || continuation,
      );
      if (continuation && !namedContents && !page.lines.length && !found.length) break;
      // Lists of illustrations/tables are a separate index, not continuation
      // of the chapter contents. Do not turn figure captions into chapters.
      if (!namedContents && isOtherIndex(page.text)) {
        if (rows.length) break;
        else continue;
      }
      const completeRows =
        found.length >= 2 && page.lines.filter((line) => line.trim()).length === found.length;
      // A bad page number cannot silently disappear from a recognized TOC.
      if (rejected && (namedContents || continuation || found.length + rejected >= 4))
        return unavailable();
      if (namedContents) contentsPages.add(index);
      if (namedContents || (found.length && (continuation || completeRows || found.length >= 4))) {
        contentsPages.add(index);
        for (const line of geometricRows.filter((row) => row.y < 0.1))
          margins.push({ index, line });
        // A named contents page may contain a title whose short page number
        // OCR missed. Keep that title and require an independent destination;
        // silently dropping it would falsely publish a complete chapter list.
        const candidates =
          namedContents || continuation
            ? tableLines.flatMap((line) => {
                const title = normalize(line);
                if (
                  !title ||
                  isGrouping(line) ||
                  isContentsLine(line) ||
                  /^[\d ivxlcdm.·…_。•⋯∙●‧﹒:：]+$/i.test(line.trim())
                )
                  return [];
                const known = found.find((row) => title.startsWith(normalize(row.title)));
                return [known ?? { title: line.trim(), base: null, level: 0 }];
              })
            : found;
        const joined: Row[] = [];
        for (const row of candidates) {
          const previous = joined.at(-1);
          if (
            previous?.base === null &&
            (/^(?:part|chapter)\s+[ivxlcdm\d]+$/i.test(previous.title) ||
              (/^第[\d一二三四五六七八九十百零〇]+[章节部篇]/.test(previous.title) &&
                !/^(?:第[\d一二三四五六七八九十百零〇]+[章节部篇]|[一二三四五六七八九十百]+[、\s]|\d+[.、\s])/.test(
                  row.title,
                )) ||
              /^\p{Ll}/u.test(row.title))
          ) {
            joined.pop();
            joined.push({ ...row, title: `${previous.title} ${row.title}` });
          } else joined.push(row);
        }
        for (const row of joined) {
          const existing = rows.find(
            (existing) =>
              existing.base === row.base && normalize(existing.title) === normalize(row.title),
          );
          const matching = geometricRows.filter(
            (line) => normalize(line.text) === normalize(row.title),
          );
          const interior = matching.some((line) => line.y >= 0.1);
          if (existing) {
            if (interior) marginalRows.delete(existing);
          } else {
            rows.push(row);
            const line = matching.find((line) => line.y < 0.1);
            if (line && !interior) marginalRows.set(row, { index, line });
          }
        }
      } else if (found.length >= 2) return unavailable();
      else break;
      if (rows.length > MAX_ENTRIES) return unavailable('pdf_contents_entry_limit');
    }
    // Continuation pages can have no Contents label. Repeated marginal titles
    // with changing folios provide independent header evidence; interior titles
    // and unmatched marginal rows remain subject to destination verification.
    for (let i = rows.length - 1; i >= 0; i--) {
      const origin = marginalRows.get(rows[i]!);
      if (
        origin &&
        margins.some(
          (other) => other.index !== origin.index && sameFolioHeader(origin.line, other.line),
        )
      )
        rows.splice(i, 1);
    }
    if (
      (discovered !== undefined && rows.length < 2) ||
      rows.length > MAX_ENTRIES ||
      contentsPages.has(count - 1)
    )
      return unavailable();
    if (rows.length >= 2) {
      await phase('verification');
      // Numbering systems and restarts have independent offsets. A physical
      // page-label match is only a proposal; every destination uses verify().
      let group = 0;
      const groups = rows.map((row, i) => {
        const previous = rows[i - 1];
        if (
          previous &&
          row.base !== null &&
          previous.base !== null &&
          (row.system !== previous.system || row.printed! <= previous.printed!)
        )
          group++;
        return group;
      });
      const offsets = new Map<number, number>();
      for (const g of new Set(groups)) {
        const votes = new Map<number, Set<number>>();
        rows.forEach((row, r) => {
          if (groups[r] !== g || row.base === null) return;
          for (const [index, page] of pages) {
            if (!contentsPages.has(index) && matchesHeading(page.text, row.title, page.ocr)) {
              const offset = index - row.base;
              if (!votes.has(offset)) votes.set(offset, new Set());
              votes.get(offset)!.add(r);
            }
          }
        });
        const ranked = [...votes].sort((a, b) => b[1].size - a[1].size);
        if (ranked[0] && ranked[0][1].size >= 2 && ranked[0][1].size !== ranked[1]?.[1].size)
          offsets.set(g, ranked[0][0]);
      }
      const entries: PDFOutlineEntry[] = [];
      for (const [r, row] of rows.entries()) {
        const g = groups[r]!;
        // Once calibrated, batch only destinations already nominated by coarse
        // headings at that offset. This amortizes native worker startup without
        // treating previews as evidence or spending OCR on untested guesses.
        if (offsets.has(g)) {
          const offset = offsets.get(g)!;
          const nominated = rows.slice(r, r + 8).flatMap((candidate, j) => {
            if (groups[r + j] !== g || candidate.base === null) return [];
            const index = candidate.base + offset;
            const preview = previews.get(index);
            return index >= 0 &&
              index < count &&
              !contentsPages.has(index) &&
              preview &&
              matchesHeading(preview.text, candidate.title, true)
              ? [index]
              : [];
          });
          await recognize(nominated);
        }
        let target = row.base === null ? -1 : row.base + (offsets.get(g) ?? 0);
        if (contentsPages.has(target) || !(await verify(target, row.title))) {
          // Relocation needs an independent exact heading. Preview matches only
          // nominate candidates; accurate OCR must show an interior title.
          const hits: number[] = [];
          for (let i = 0; i < count; i++) {
            if (contentsPages.has(i)) continue;
            if (matchesHeading(await detect(i), row.title, true)) hits.push(i);
          }
          const confirmed: number[] = [];
          for (const index of hits) {
            if (!(await verify(index, row.title))) continue;
            const page = await read(index);
            if (!page.ocr || page.prominent.some((title) => matchesHeading(title, row.title)))
              confirmed.push(index);
          }
          if (confirmed.length !== 1)
            return unavailable(
              confirmed.length
                ? 'pdf_contents_heading_ambiguous'
                : 'pdf_contents_heading_unverified',
            );
          target = confirmed[0]!;
        }
        if (r && target < entries[r - 1]!.pageIndex) return unavailable('pdf_contents_order');
        entries.push({ title: row.title, pageIndex: target, level: row.level });
        if (row.base !== null) offsets.set(g, target - row.base);
      }
      entries.forEach((entry, i) => {
        entry.level = Math.min(entry.level, i ? entries[i - 1]!.level + 1 : 0);
      });
      check();
      await phase('save');
      await savePDFOutline(source, cache, entries, count, GENERATOR);
      return complete('generated');
    }

    // With no printed TOC, detection must cover every page; only explicit
    // numbered headings are nominated for accurate recognition and verification.
    await phase('verification');
    const headings: PDFOutlineEntry[] = [];
    const sequence = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const text = await detect(i);
      const heading = text
        .split('\n')
        .slice(0, 4)
        .map((line) => line.trim())
        .find(
          (line) =>
            line.length <= 120 &&
            !/[.·…_。•⋯∙●‧﹒]{2,}/.test(line) &&
            /^(?:第[\d一二三四五六七八九十百零〇]+[章部篇]|chapter\s+\d+)(?:[\s:：.、]|$)/i.test(
              line.normalize('NFKC'),
            ),
        );
      if (heading && !headings.some((entry) => normalize(entry.title) === normalize(heading))) {
        if (!(await verify(i, heading))) return unavailable();
        const numbered = heading
          .normalize('NFKC')
          .match(/^(?:第([\d一二三四五六七八九十百零〇]+)([章部篇])|chapter\s+(\d+))/i)!;
        const token = numbered[1] ?? numbered[3]!;
        let ordinal = Number(token);
        if (!Number.isFinite(ordinal)) {
          let digit = 0;
          ordinal = 0;
          for (const char of token) {
            const value = '零一二三四五六七八九'.indexOf(char);
            if (value >= 0) digit = value;
            else if (char === '十' || char === '百') {
              ordinal += (digit || 1) * (char === '十' ? 10 : 100);
              digit = 0;
            }
          }
          ordinal += digit;
        }
        const kind = numbered[2] ?? '章';
        if (ordinal !== (sequence.get(kind) ?? 0) + 1) return unavailable();
        sequence.set(kind, ordinal);
        headings.push({ title: heading, pageIndex: i, level: 0 });
      }
    }
    if (headings.length < 2 || headings.length > MAX_ENTRIES) return unavailable();
    check();
    await phase('save');
    await savePDFOutline(source, cache, headings, count, GENERATOR);
    return complete('generated');
  } catch (error) {
    const failedContext = context;
    if (expired || !controller.signal.aborted) await fallback().catch(() => {});
    context = failedContext;
    const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const code = expired
      ? 'pdf_contents_timeout'
      : controller.signal.aborted
        ? 'pdf_contents_cancelled'
        : /^(?:pdf_[a-z_0-9]+|invalid_pdf(?:_outline|_cache)?|outline_changed|source_changed)$/.test(
              raw,
            ) && raw.length <= 80
          ? raw
          : context?.operation
            ? `pdf_contents_${context.operation}_failed`
            : 'pdf_contents_failed';
    const errorKind =
      error instanceof TypeError
        ? 'type_error'
        : error instanceof RangeError
          ? 'range_error'
          : error instanceof DOMException && error.name === 'AbortError'
            ? 'abort_error'
            : error instanceof Error
              ? 'error'
              : 'native_error';
    await report(
      expired ? 'unavailable' : controller.signal.aborted ? 'cancelled' : 'failed',
      code,
      errorKind,
    );
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
