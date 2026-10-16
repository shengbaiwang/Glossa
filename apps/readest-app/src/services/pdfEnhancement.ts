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
  })
  .refine((p) => p.lines.reduce((n, l) => n + l.text.length, 0) <= 100000);
export type OCRPage = z.infer<typeof pageSchema>;
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
});
export type PDFCache = z.infer<typeof cacheSchema>;
const statusSchema = z.object({
  cacheId: z.string(),
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
export const readOCRPage = async (cacheId: string, index: number) =>
  parseOCRPage(await call('pdf_read_ocr_page', { cacheId, index }), index);
export const startPDFOCR = async (source: string, cacheId: string, pages: number[]) =>
  statusSchema.parse(await call('pdf_start_ocr', { source, cacheId, pages }));
export const getPDFOCRStatus = async (cacheId: string): Promise<PDFOCRStatus | null> => {
  const value = await call('pdf_ocr_status', { cacheId });
  return value === null ? null : statusSchema.parse(value);
};
export const cancelPDFOCR = (cacheId: string) => call('pdf_cancel_ocr', { cacheId });
export const waitForPDFOCR = async (
  cacheId: string,
  signal: AbortSignal,
  onStatus: (status: PDFOCRStatus) => void,
): Promise<PDFOCRStatus> => {
  while (!signal.aborted) {
    const status = await getPDFOCRStatus(cacheId);
    if (signal.aborted) break;
    if (!status) throw new Error('pdf_worker_unavailable');
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
) => {
  if (outline) outlineToTOC(outline, pageCount);
  return cacheSchema.parse(
    await call('pdf_save_outline', {
      source,
      cacheId: cache.id,
      revision: cache.revision,
      outline,
      pageCount,
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
): OutlineCandidate[] {
  const result: OutlineCandidate[] = [];
  for (const line of lines) {
    const match = line.trim().match(/^(.+?)(?:\s*[.．·…_]{2,}\s*|\s+)(\d{1,4}|[ivxlcdm]+)\s*$/i);
    if (!match) continue;
    const title = match[1]!.replace(/[.．·…_\s]+$/, '').trim();
    const printedPage = match[2]!;
    const matches = labels.flatMap((label, i) =>
      label.toLowerCase() === printedPage.toLowerCase() ? [i] : [],
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
      verified: target.includes(heading) || (bare.length >= 4 && target.includes(bare)),
    });
    if (result.length === 1000) break;
  }
  return result;
}
