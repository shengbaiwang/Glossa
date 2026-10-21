import { z } from 'zod';
import type { TOCItem } from '@/libs/document';
import * as CFI from 'foliate-js/epubcfi.js';
import { isTauriAppPlatform } from './environment';

const lineSchema = z
  .object({
    text: z.string().min(1).max(10000),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
    endLine: z.boolean().optional(),
  })
  .refine((l) => l.x + l.width <= 1.001 && l.y + l.height <= 1.001);
const pageSchema = z
  .object({
    index: z.number().int().min(0).max(4999),
    native: z.boolean(),
    lines: z.array(lineSchema).max(10000),
    recognizer: z.string().max(80).optional(),
    emptyReason: z.enum(['no_observations', 'no_word_boxes']).optional(),
  })
  .refine((p) => p.lines.reduce((n, l) => n + l.text.length, 0) <= 100000);
export type OCRPage = z.infer<typeof pageSchema>;
// Empty legacy results own no text offsets. Nonempty/native layers are durable,
// and a current empty checkpoint proves its bounded recovery already finished.
export const needsOCRRecovery = (page: OCRPage | null) =>
  !!page &&
  !page.native &&
  !page.lines.length &&
  (page.recognizer !== 'vision-multiscale-1' || page.emptyReason === 'no_word_boxes');
export const outlineEntrySchema = z.object({
  title: z.string().trim().min(1).max(500),
  pageIndex: z.number().int().min(0).max(4999),
  level: z.number().int().min(0).max(5),
});
export type PDFOutlineEntry = z.infer<typeof outlineEntrySchema>;
export type OutlineCandidate = PDFOutlineEntry & { verified: boolean };
const cacheSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/),
  pages: z.array(z.number().int().min(0).max(4999)).max(5000),
  outline: z.array(outlineEntrySchema).max(1000).nullable(),
  revision: z.number().int().nonnegative(),
  generator: z.string().max(80).nullable().optional(),
});
export type PDFCache = z.infer<typeof cacheSchema>;
const statusSchema = z.object({
  cacheId: z.string(),
  jobId: z.string().optional(),
  state: z.enum(['running', 'completed', 'cancelled', 'failed']),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type PDFOCRStatus = z.infer<typeof statusSchema>;

export const supportsLocalPDF = () =>
  isTauriAppPlatform() &&
  typeof navigator !== 'undefined' &&
  /Mac/.test(navigator.platform) &&
  navigator.maxTouchPoints < 2;

const call = async (name: string, args: Record<string, unknown>) => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<unknown>(name, args);
};
export const openPDFCache = async (source: string, create = false): Promise<PDFCache | null> => {
  const value = await call('pdf_open_cache', { source, create });
  return value === null ? null : cacheSchema.parse(value);
};
export const parseOCRPage = (value: unknown, index: number): OCRPage | null => {
  const parsed = pageSchema.safeParse(value);
  return parsed.success && parsed.data.index === index ? parsed.data : null;
};
export const readOCRPage = async (
  cacheId: string,
  index: number,
  detect = false,
  contents = false,
) =>
  parseOCRPage(
    await call('pdf_read_ocr_page', {
      cacheId,
      index,
      ...(detect ? { detect } : {}),
      ...(contents ? { contents } : {}),
    }),
    index,
  );
export const startPDFOCR = async (
  source: string,
  cacheId: string,
  pages: number[],
  detect = false,
  contents = false,
) =>
  statusSchema.parse(
    await call('pdf_start_ocr', {
      source,
      cacheId,
      pages,
      ...(detect ? { detect } : {}),
      ...(contents ? { contents } : {}),
    }),
  );
export const getPDFOCRStatus = async (cacheId: string): Promise<PDFOCRStatus | null> => {
  const value = await call('pdf_ocr_status', { cacheId });
  return value === null ? null : statusSchema.parse(value);
};
export const cancelPDFOCR = (cacheId: string, jobId?: string) =>
  call('pdf_cancel_ocr', { cacheId, ...(jobId ? { jobId } : {}) });
export const waitForPDFOCR = async (
  cacheId: string,
  signal: AbortSignal,
  onStatus: (status: PDFOCRStatus) => void,
  jobId?: string,
): Promise<PDFOCRStatus> => {
  while (!signal.aborted) {
    const status = await getPDFOCRStatus(cacheId);
    if (signal.aborted) break;
    if (!status) throw new Error('pdf_worker_unavailable');
    if (jobId && status.jobId !== jobId) throw new Error('pdf_job_changed');
    onStatus(status);
    if (status.state !== 'running') return status;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, 600);
      signal.addEventListener('abort', done, { once: true });
    });
  }
  throw new DOMException('Cancelled', 'AbortError');
};
export const OCRPageText = (page: OCRPage | null) =>
  page?.lines.map((line) => line.text + (line.endLine ? '\n' : '')).join('') ?? '';

/** Reconstruct horizontal TOC rows without changing the persisted reading/CFI order. */
export function OCRContentsLines(page: OCRPage, allRows = false): string[] {
  type Fragment = {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    words: OCRPage['lines'];
  };
  const fragments: Fragment[] = [];
  let fragment: Fragment | undefined;
  for (const word of page.lines) {
    if (!fragment) fragment = { ...word, words: [word] };
    else {
      const right = Math.max(fragment.x + fragment.width, word.x + word.width);
      const bottom = Math.max(fragment.y + fragment.height, word.y + word.height);
      fragment.x = Math.min(fragment.x, word.x);
      fragment.y = Math.min(fragment.y, word.y);
      fragment.width = right - fragment.x;
      fragment.height = bottom - fragment.y;
      fragment.text += word.text;
      fragment.words.push(word);
    }
    if (word.endLine) {
      fragments.push(fragment);
      fragment = undefined;
    }
  }
  if (fragment) fragments.push(fragment);
  // Large text fragments anchor rows first; tiny dot leaders must not merge adjacent rows.
  const rows: { anchor: Fragment; parts: Fragment[] }[] = [];
  for (const part of fragments.sort((a, b) => b.height - a.height)) {
    const center = part.y + part.height / 2;
    const row = rows
      .filter(({ anchor }) => {
        const overlap =
          Math.min(anchor.y + anchor.height, part.y + part.height) - Math.max(anchor.y, part.y);
        return (
          overlap >= Math.min(anchor.height, part.height) * 0.5 &&
          Math.abs(anchor.y + anchor.height / 2 - center) <=
            Math.max(anchor.height, part.height) * 0.6
        );
      })
      .sort(
        (a, b) =>
          Math.abs(a.anchor.y + a.anchor.height / 2 - center) -
          Math.abs(b.anchor.y + b.anchor.height / 2 - center),
      )[0];
    if (row) row.parts.push(part);
    else rows.push({ anchor: part, parts: [part] });
  }
  const prepared = rows
    .sort((a, b) => a.anchor.y - b.anchor.y)
    .map(({ parts, anchor }) => {
      parts.sort((a, b) => a.x - b.x);
      const text = parts
        .map((p) => p.text.trim())
        .join(' ')
        .normalize('NFKC');
      // A paragraph ending in a number is not a TOC row. Require printed leaders
      // or an actual horizontal gap before a separate page-number token.
      const words = parts.flatMap((p) => p.words).sort((a, b) => a.x - b.x);
      const last = words.at(-1);
      const previous = words.at(-2);
      const gap =
        last &&
        previous &&
        /^[.·…_。•⋯∙●‧﹒:：\s]*(?:\d{1,4}|[ivxlcdm]+)$/i.test(last.text.normalize('NFKC').trim()) &&
        last.x - (previous.x + previous.width) >= Math.max(last.height, previous.height) * 1.5;
      const leader = /[.·…_。•⋯∙●‧﹒](?:\s*[.·…_。•⋯∙●‧﹒])+\s*(?:\d{1,4}|[ivxlcdm]+)\s*$/i.test(
        text,
      );
      // Vision often attaches a single leader dot to the page token. A real
      // horizontal gap has already proved it is a separate number column.
      const cleaned =
        gap && last
          ? text.replace(
              /\S+$/,
              last.text
                .normalize('NFKC')
                .trim()
                .replace(/^[.·…_。•⋯∙●‧﹒:：\s]+/, ''),
            )
          : text;
      return { text: cleaned, contents: !!(gap || leader), height: anchor.height };
    });
  const sizes = prepared
    .filter((row) => row.contents)
    .map((row) => row.height)
    .sort((a, b) => a - b);
  const minimum = (sizes[Math.floor(sizes.length / 2)] ?? 0) * 0.8;
  return prepared
    .filter((row) => (allRows ? row.height >= minimum : row.contents))
    .map((row) => row.text);
}

const branchEnd = (entries: PDFOutlineEntry[], index: number) => {
  let end = index + 1;
  while (end < entries.length && entries[end]!.level > entries[index]!.level) end++;
  return end;
};
export function changeOutlineLevel<T extends PDFOutlineEntry>(
  entries: T[],
  index: number,
  delta: number,
): T[] {
  if (!entries[index]) return entries;
  const end = branchEnd(entries, index);
  const level = entries[index]!.level + delta;
  if (
    level < 0 ||
    level > (index ? entries[index - 1]!.level + 1 : 0) ||
    entries.slice(index, end).some((entry) => entry.level + delta > 5)
  )
    return entries;
  return entries.map((entry, i) =>
    i >= index && i < end ? { ...entry, level: entry.level + delta } : entry,
  );
}
export function moveOutlineBranch<T extends PDFOutlineEntry>(
  entries: T[],
  from: number,
  to: number,
): T[] {
  if (!entries[from] || from === to) return entries;
  const end = branchEnd(entries, from);
  if (to > from && to < end) to = end;
  if (!entries[to]) return entries;
  const delta = entries[to]!.level - entries[from]!.level;
  const branch = entries
    .slice(from, end)
    .map((entry) => ({ ...entry, level: entry.level + delta }));
  if (branch.some((entry) => entry.level > 5)) return entries;
  const insertion = to < from ? to : branchEnd(entries, to) - branch.length;
  const remaining = [...entries.slice(0, from), ...entries.slice(end)];
  remaining.splice(insertion, 0, ...branch);
  return remaining;
}
export function removeOutlineEntry<T extends PDFOutlineEntry>(entries: T[], index: number): T[] {
  if (!entries[index]) return entries;
  const end = branchEnd(entries, index);
  return entries.flatMap((entry, i) =>
    i === index ? [] : [i > index && i < end ? { ...entry, level: entry.level - 1 } : entry],
  );
}
export const savePDFOutline = async (
  source: string,
  cache: PDFCache,
  outline: PDFOutlineEntry[] | null,
  pageCount: number,
  generator?: 'glossa-contents-2' | 'glossa-contents-3' | 'glossa-pages-1',
) => {
  if (outline) outlineToTOC(outline, pageCount);
  return cacheSchema.parse(
    await call('pdf_save_outline', {
      source,
      cacheId: cache.id,
      revision: cache.revision,
      outline,
      pageCount,
      generator: generator ?? null,
    }),
  );
};

export function outlineToTOC(entries: PDFOutlineEntry[], pageCount: number): TOCItem[] {
  const checked = z.array(outlineEntrySchema).max(1000).parse(entries);
  const root: TOCItem[] = [];
  const stack: TOCItem[] = [];
  checked.forEach((entry, id) => {
    if (entry.pageIndex >= pageCount || entry.level > stack.length)
      throw new Error('invalid_outline');
    const item: TOCItem = {
      id,
      label: entry.title,
      index: entry.pageIndex,
      href: JSON.stringify([entry.pageIndex, { name: 'Fit' }]),
      cfi: CFI.fake.fromIndex(entry.pageIndex),
    };
    if (entry.level === 0) root.push(item);
    else (stack[entry.level - 1]!.subitems ??= []).push(item);
    stack.length = entry.level;
    stack.push(item);
  });
  return root;
}

const normalized = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');

/** Candidates come only from explicit TOC rows. Unresolvable printed labels are omitted. */
export function buildOutlineCandidates(
  lines: string[],
  labels: string[],
  pageTexts: Map<number, string>,
  pageOffset = 0,
  contentsPages: ReadonlySet<number> = new Set(),
): OutlineCandidate[] {
  const result: OutlineCandidate[] = [];
  for (const line of lines) {
    const match = line
      .normalize('NFKC')
      .trim()
      .match(/^(.+?)(?:\s*(?:[.·…_。•⋯∙●‧﹒]{2,}|•)\s*|\s+)(\d{1,4}|[ivxlcdm]+)\s*$/i);
    if (!match) continue;
    const title = match[1]!.replace(/[.·…_。•⋯∙●‧﹒\s]+$/, '').trim();
    const printedPage = match[2]!;
    const matches = labels.flatMap((label, i) =>
      label.normalize('NFKC').trim().toLowerCase() === printedPage.toLowerCase() ? [i] : [],
    );
    if (title.length < 2 || title.length > 500 || matches.length !== 1) continue;
    const pageIndex = matches[0]! + pageOffset;
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= labels.length) continue;
    const decimal = title.match(/^(\d+(?:\.\d+)+)[.\s]/);
    const level = decimal
      ? Math.min(5, decimal[1]!.split('.').length - 1)
      : /^第.+节/.test(title)
        ? 1
        : 0;
    const heading = normalized(title);
    const target = normalized((pageTexts.get(pageIndex) ?? '').slice(0, 2500));
    const bare = heading.replace(
      /^(?:第[\d一二三四五六七八九十百]+[章节]|chapter\d+|\d+(?:\d+)*)/,
      '',
    );
    result.push({
      title,
      pageIndex,
      level: Math.min(level, result.length ? result[result.length - 1]!.level + 1 : 0),
      verified:
        !contentsPages.has(pageIndex) &&
        (target.includes(heading) || (bare.length >= 4 && target.includes(bare))),
    });
    if (result.length === 1000) break;
  }
  return result;
}

export const exportPDFCopy = (
  source: string,
  cacheId: string,
  destination: string,
  annotations: unknown[],
) => call('pdf_export_copy', { source, cacheId, destination, annotations });
export const cancelPDFExport = (cacheId: string) => call('pdf_cancel_export', { cacheId });

/** Calibrate against page labels as well as physical numbering. */
export function calibratePDFPageOffset(
  labels: string[],
  printed: string,
  actual: number,
): number | null {
  const label = printed.normalize('NFKC').trim().toLowerCase();
  const matches = labels.flatMap((value, index) =>
    value.normalize('NFKC').trim().toLowerCase() === label ? [index] : [],
  );
  return matches.length === 1 && Number.isInteger(actual) && actual >= 1 && actual <= labels.length
    ? actual - 1 - matches[0]!
    : null;
}
