import { z } from 'zod';
import type { BookDoc, TOCItem, PDFContentsLine } from '@/libs/document';
import { createDerivedStore, hashData } from '@/glossa/harness/derivedStore';
import {
  OCRContentsLines,
  OCRContentsLayout,
  isPDFSizeAtLeast,
  OCRPageText,
  openPDFCache,
  releasePDFSourceSession,
  readOCRPage,
  savePDFOutline,
  needsOCRRecovery,
  outlineEntrySchema,
  type PDFOutlineEntry,
  type OCRPage,
  type PDFOCRRegion,
} from './pdfEnhancement';
import { recognizePDFPages } from './pdfOCR';
import { alignContentsTargets } from './pdfContentsAlignment';
import type { PDFContentsCheckpointStorage } from './pdfContentsCheckpoint';
import { classifyFailure } from './pdfContentsDiagnostics';
import { initSimpleCC, runSimpleCC } from '@/utils/simplecc';

const MAX_OCR_PAGES = 96;
const MAX_ENTRIES = 1000;
const MAX_PAGES = 5000;
const GENERATOR = 'glossa-contents-3';
const EXTRACTOR = 'pdf-contents-19';
const rowSchema = z.object({
  title: z.string().min(1).max(500),
  alternatives: z.array(z.string().min(1).max(500)).max(2).optional(),
  targetPage: z
    .number()
    .int()
    .min(0)
    .max(MAX_PAGES - 1)
    .nullable(),
  printedLabel: z.string().max(80).optional(),
  sourcePage: z
    .number()
    .int()
    .min(0)
    .max(MAX_PAGES - 1)
    .optional(),
  scope: z
    .number()
    .int()
    .min(0)
    .max(MAX_PAGES - 1)
    .optional(),
  level: z.number().int().min(0).max(5),
  system: z.enum(['roman', 'arabic']).optional(),
  printed: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  direct: z.boolean().optional(),
});
const planSchema = z.object({
  // Retain stable verifier entries while routing changes invalidate old plans.
  extractor: z.enum([
    'pdf-contents-7',
    'pdf-contents-8',
    'pdf-contents-9',
    'pdf-contents-10',
    'pdf-contents-11',
    'pdf-contents-12',
    'pdf-contents-13',
    'pdf-contents-14',
    'pdf-contents-15',
    'pdf-contents-16',
    'pdf-contents-17',
    EXTRACTOR,
  ]),
  revision: z.number().int().nonnegative(),
  regenerate: z.boolean(),
  labels: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(rowSchema).min(2).max(MAX_ENTRIES),
  contentsPages: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(MAX_PAGES - 1),
    )
    .max(MAX_PAGES),
  sources: z
    .array(
      z.object({
        index: z
          .number()
          .int()
          .min(0)
          .max(MAX_PAGES - 1),
        evidence: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(MAX_PAGES),
  completed: z.array(outlineEntrySchema).max(MAX_ENTRIES),
  targets: z.array(z.array(outlineEntrySchema).max(16)).max(MAX_ENTRIES).optional(),
  targetIssues: z
    .array(
      z.object({
        row: z
          .number()
          .int()
          .min(0)
          .max(MAX_ENTRIES - 1),
        reason: z.enum(['heading_unverified', 'multiple_targets']),
      }),
    )
    .max(MAX_ENTRIES)
    .optional(),
  // Full source inventory before target verification. Resuming must not allow
  // a missing parent or altered ownership to pass as a smaller complete TOC.
  structure: z
    .array(
      z.object({
        title: z.string().min(1).max(500),
        alternatives: z.array(z.string().min(1).max(500)).max(2).optional(),
        level: z.number().int().min(0).max(5),
        parent: z.number().int().min(0).max(MAX_ENTRIES).nullable(),
        scope: z
          .number()
          .int()
          .min(0)
          .max(MAX_PAGES - 1)
          .optional(),
      }),
    )
    .max(MAX_ENTRIES)
    .optional(),
  scopeReceipt: z
    .object({
      kind: z.enum(['local-tables', 'explicit-volume']),
      volume: z.number().int().positive().optional(),
      evidencePage: z
        .number()
        .int()
        .min(0)
        .max(MAX_PAGES - 1)
        .optional(),
      excluded: z
        .array(
          z.object({
            title: z.string().max(500),
            sourcePage: z
              .number()
              .int()
              .min(0)
              .max(MAX_PAGES - 1)
              .optional(),
            reason: z.enum(['other-volume', 'volume-label']),
          }),
        )
        .max(MAX_ENTRIES),
    })
    .optional(),
  search: z
    .object({
      nativeNext: z.number().int().min(0).max(MAX_PAGES),
      coarseNext: z.number().int().min(0).max(MAX_PAGES),
      candidates: z
        .array(
          z
            .array(
              z.object({
                index: z
                  .number()
                  .int()
                  .min(0)
                  .max(MAX_PAGES - 1),
                exact: z.boolean(),
                prominent: z.boolean(),
              }),
            )
            .max(128),
        )
        .max(MAX_ENTRIES),
    })
    .optional(),
  offsets: z
    .array(
      z.tuple([
        z.number().int().min(0).max(MAX_ENTRIES),
        z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
      ]),
    )
    .max(MAX_ENTRIES),
});
const operationSchema = z.enum([
  'cache_read',
  'native_text',
  'native_layout',
  'detection_read',
  'fine_ocr',
  'heading_ocr',
  'detection_ocr',
]);
const reportSchema = z.object({
  algorithm: z.enum([
    'pdf-contents-4',
    'pdf-contents-5',
    'pdf-contents-6',
    'pdf-contents-7',
    'pdf-contents-8',
    'pdf-contents-9',
    'pdf-contents-10',
    'pdf-contents-11',
    'pdf-contents-12',
    'pdf-contents-13',
    'pdf-contents-14',
    'pdf-contents-15',
    'pdf-contents-16',
    EXTRACTOR,
  ]),
  stage: z.enum(['open', 'embedded', 'discovery', 'extraction', 'ocr', 'verification', 'save']),
  state: z.enum(['running', 'completed', 'unavailable', 'failed', 'cancelled']),
  code: z
    .string()
    .regex(/^[a-z_0-9]{1,80}$/)
    .optional(),
  updatedAt: z.number().finite(),
  elapsedMs: z.number().nonnegative().optional(),
  verifiedCount: z.number().int().min(0).max(MAX_ENTRIES).optional(),
  totalCount: z.number().int().min(0).max(MAX_ENTRIES).optional(),
  resumed: z.boolean().optional(),
  remainingCount: z.number().int().min(0).max(MAX_ENTRIES).optional(),
  canResume: z.boolean().optional(),
  checkpointAdvanced: z.boolean().optional(),
  issues: z
    .array(
      z.object({
        title: z.string().max(500),
        sourcePage: z
          .number()
          .int()
          .min(0)
          .max(MAX_PAGES - 1)
          .optional(),
        reason: z.enum(['heading_unverified', 'multiple_targets']),
      }),
    )
    .max(8)
    .optional(),
  checkpointSaveFailed: z.boolean().optional(),
  checkpointValidationFailed: z.boolean().optional(),
  failureCategory: z.string().max(40).optional(),
  operation: operationSchema.optional(),
  pageIndex: z
    .number()
    .int()
    .min(0)
    .max(MAX_PAGES - 1)
    .optional(),
  errorKind: z
    .enum(['type_error', 'range_error', 'abort_error', 'error', 'native_error'])
    .optional(),
});
export type PDFContentsReport = z.infer<typeof reportSchema>;
const pageIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_PAGES - 1);
const evidenceSchema = z.string().regex(/^[a-f0-9]{64}$/);
const boxSchema = z.object({
  text: z.string().max(2000),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
});
const extractionSchema = z.object({
  next: z.number().int().min(0).max(MAX_PAGES),
  linkedTable: z.boolean(),
  visualTable: z.boolean(),
  sources: z.array(z.tuple([pageIndexSchema, evidenceSchema])).max(MAX_PAGES),
  contentsPages: z.array(pageIndexSchema).max(MAX_PAGES),
  rows: z
    .array(
      z.object({
        row: rowSchema,
        layout: boxSchema
          .extend({
            page: pageIndexSchema,
            before: z.number().finite(),
            after: z.number().finite(),
          })
          .optional(),
        marginal: z.object({ index: pageIndexSchema, line: boxSchema }).optional(),
      }),
    )
    .max(MAX_ENTRIES),
  synopsisStyles: z
    .array(z.object({ x: z.number().finite(), height: z.number().positive() }))
    .max(100)
    .optional(),
  headers: z.array(boxSchema).max(MAX_ENTRIES),
  margins: z.array(z.object({ index: pageIndexSchema, line: boxSchema })).max(MAX_ENTRIES * 4),
});
const scanSchema = z.object({
  extractor: z.literal(EXTRACTOR),
  revision: z.number().int().nonnegative(),
  regenerate: z.boolean(),
  labels: evidenceSchema,
  discovery: z.object({
    next: z.number().int().min(0).max(MAX_PAGES),
    probes: z.number().int().min(0).max(4),
    nativeNext: z.number().int().min(0).max(MAX_PAGES).default(0),
    tables: z.array(pageIndexSchema).max(MAX_PAGES).default([]),
    indexed: z.array(pageIndexSchema).max(MAX_PAGES).default([]),
    images: z.array(pageIndexSchema).max(MAX_PAGES).default([]),
    general: z.array(pageIndexSchema).max(MAX_PAGES).default([]),
    fallback: pageIndexSchema.optional(),
    found: pageIndexSchema.optional(),
  }),
  extraction: extractionSchema.optional(),
});
// OCR, extraction and evidence checks have independent versions.
const checksSchema = z.object({
  run: reportSchema.optional(),
  plan: planSchema.optional(),
  scan: scanSchema.optional(),
  verifier: z.literal('pdf-heading-2'),
  entries: z
    .array(
      z.object({
        title: z.string().max(500),
        index: z
          .number()
          .int()
          .min(0)
          .max(MAX_PAGES - 1),
        evidence: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(MAX_ENTRIES),
});
const checkpointSchema = z.object({
  key: z.string(),
  checks: checksSchema,
});
type PreparationOptions = {
  regenerate?: boolean;
  timeoutMs?: number;
  owner?: import('./pdfEnhancement').PDFCacheOwner;
  checkpoint?: PDFContentsCheckpointStorage;
};

export async function readPDFContentsCheckpoint(
  checkpoint: PDFContentsCheckpointStorage | undefined,
  cache: { id: string; revision: number },
  count: number,
) {
  if (!checkpoint) return;
  const parsed = checkpointSchema.safeParse(await checkpoint.read());
  if (!parsed.success || parsed.data.key !== (await hashData({ id: cache.id, count }))) return;
  const { plan, scan, run } = parsed.data.checks;
  const checkpointState = plan ?? scan;
  if (
    checkpointState?.extractor === EXTRACTOR &&
    checkpointState.revision === cache.revision &&
    run?.algorithm === EXTRACTOR &&
    run.state !== 'completed'
  )
    return run;
  return undefined;
}

const checksStore = createDerivedStore('glossa-pdf-contents', checksSchema, {
  entryBytes: 320000,
  entries: 16,
  totalBytes: 2000000,
});
let variantsReady = false;
const equivalentGlyphs = (text: string) => text.replace(/衞/g, '衛').replace(/晩/g, '晚');
const normalize = (text: string) =>
  (variantsReady ? runSimpleCC(equivalentGlyphs(text), 't2s') : equivalentGlyphs(text))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}\p{Cc}]/gu, '');
// Repair presentation only from an already verified target with the same
// letters/digits (including known equivalent glyphs). Never invent words.
function verifiedDisplayTitle(title: string, lines: string[]) {
  const clean = equivalentGlyphs(title.replace(/^[◎○●•]\s*/u, ''));
  const balanced = (value: string) =>
    ['“”', '‘’', '（）', '()'].every(
      ([open, close]) => value.split(open!).length === value.split(close!).length,
    );
  if (balanced(clean)) return clean;
  const lexical = (value: string) =>
    equivalentGlyphs(value)
      .normalize('NFKC')
      .replace(/[\s\p{P}\p{S}\p{Cc}]/gu, '');
  const original = lexical(clean);
  for (let start = 0; start < Math.min(lines.length, 500); start++) {
    let candidate = '';
    for (let end = start; end < Math.min(lines.length, start + 6); end++) {
      candidate += (candidate ? ' ' : '') + lines[end]!.trim();
      if (lexical(candidate).length > original.length) break;
      if (lexical(candidate) === original && balanced(candidate)) return candidate;
    }
  }
  return clean;
}

const isGeneralContents = (text: string) =>
  contentsLines(text).some((line) =>
    /^(?:总目(?:录)?|全书目录|generalcontents|completecontents)(?:\d+)?$/.test(normalize(line)),
  );
const isContentsLine = (text: string) =>
  /^(?:(?:第[\d一二三四五六七八九十百零〇]+卷|[上中下]卷|本卷|volume[ivxlcdm\d]+))目录(?:\d+)?$/.test(
    normalize(text),
  ) ||
  /^(?:\d+)?(?:目录|tableofcontents|contents)(?:\d+)?$/.test(normalize(text)) ||
  /^(?:(?:\d+|[ivxlcdm]+)\s+)?(?:目\s*[录錄]|(?:table\s+of\s+)?contents)(?:\s+(?:\d+|[ivxlcdm]+))?$/i.test(
    text.trim(),
  );
const contentsLines = (text: string) => text.replace(/目\s*\n\s*([录錄])/g, '目$1').split('\n');
const isContents = (text: string) => contentsLines(text).some(isContentsLine);
const isChapterIndex = (lines: string[]) =>
  new Set(
    lines.flatMap((line) => {
      const heading = line
        .trim()
        .replace(/^[•●·\-]\s*/, '')
        .normalize('NFKC');
      return /^(?:第[\d一二三四五六七八九十百零〇]+章|chapter\s+\d+)(?:\s|[：:.、]|$)/i.test(
        heading,
      )
        ? [normalize(heading)]
        : [];
    }),
  ).size >= 3;
const isOtherIndex = (text: string) =>
  /^(?:(?:\d+|[ivxlcdm]+)\s+)?(?:插[图圖]目[录錄]|[图圖]表目[录錄]|[图圖表]目[录錄]|(?:list\s+of\s+)?(?:illustrations|figures|tables|maps|plates))(?:\s+(?:\d+|[ivxlcdm]+))?$/i.test(
    text
      .split('\n')
      .find((line) => normalize(line))
      ?.trim() ?? '',
  );
// Group headings remain destinations even when the printed table omits a folio.
const partRank = (text: string): number | undefined => {
  const chinese = normalize(text).match(
    /^(?:第[一二三四五六七八九十百零〇\d]+(部分|部|卷|辑|篇|编)|(辑|部|卷|篇|编)[一二三四五六七八九十百零〇\d]+)/,
  );
  const unit = chinese?.[1] ?? chinese?.[2];
  if (unit) return unit === '篇' ? 2 : unit === '辑' ? 1 : 0;
  if (/^part\s+(?:[ivxlcdm]+|\d+)(?:\s|$|[:：.])/i.test(text.trim())) return 0;
  if (!/^第.+[章节]/.test(text.trim()) && /^.{1,30}?\s*[（(]\s*[上中下]\s*[）)]/u.test(text.trim()))
    return 0;
  return undefined;
};
const standaloneMatter = (text: string) =>
  /^(?:引言|绪论|结语|结论|尾声|主要人名索引|征引书目|\d{4}年第.+卷后记)/.test(normalize(text)) ||
  /^(?:总\s*序|中文版序言|序(?:言|章)?|前言|引言|绪论|导\s*论|结\s*论|结\s*语|后记|後記|跋|附[录錄]\s*[\d一二三四五六七八九十]*|征引文献|参考文献|參考文獻|致谢|致謝|索引|preface|foreword|prologue|introduction|conclusion|afterword|epilogue|appendix|references|notes|index|illustration credits|acknowledg(?:e)?ments?)(?:$|[《\s:：·・、—-])/i.test(
    text.trim(),
  );
const isMatterList = (lines: string[]) => {
  const titles = lines.map((line) => line.trim()).filter((line) => /\p{L}/u.test(line));
  return (
    new Set(titles.map(normalize)).size >= 3 &&
    titles.every((line) =>
      /^(?:notes|acknowledg(?:e)?ments?|illustration credits|index|appendix|references|bibliography)$/i.test(
        line,
      ),
    )
  );
};
const validTitle = (text: string) => text.length >= 2 || /^\p{Script=Han}$/u.test(text);
// Cost nomination only: acceptance still needs a complete precise heading.
const nearHeading = (text: string, title: string) => {
  const expected = bareTitle(title);
  if (expected.length < 6 || expected.length > 96) return false;
  return text
    .split('\n')
    .slice(0, 500)
    .some((line) => {
      const candidate = bareTitle(line);
      if (Math.abs(candidate.length - expected.length) > 2) return false;
      let previous = Array.from({ length: candidate.length + 1 }, (_, i) => i);
      for (const [i, char] of [...expected].entries()) {
        const next = [i + 1];
        for (const [j, other] of [...candidate].entries())
          next.push(
            Math.min(next[j]! + 1, previous[j + 1]! + 1, previous[j]! + (char === other ? 0 : 1)),
          );
        if (Math.min(...next) > Math.min(2, Math.floor(expected.length / 5))) return false;
        previous = next;
      }
      return previous.at(-1)! <= Math.min(2, Math.floor(expected.length / 5));
    });
};
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
const printedFolio = (text: string) => {
  const match = text.trim().match(/^(\d{1,9}|[ivxlcdm]+)(?:\s|$)|(?:^|\s)(\d{1,9}|[ivxlcdm]+)$/i);
  const token = match?.[1] ?? match?.[2];
  return token ? (/^\d+$/.test(token) ? Number(token) : romanNumber(token)) : undefined;
};
type Row = z.infer<typeof rowSchema>;
// A printed coordinate is not a physical index. Only a verified mapping can
// turn it into a destination; direct links carry a separate physical hint.
const coordinate = (row: Row | undefined): number | null =>
  row ? (row.direct ? row.targetPage : row.printed === undefined ? null : row.printed - 1) : null;
type RowLayout = PDFContentsLine & { page: number; before: number; after: number };

function rowLayout(
  title: string,
  lines: PDFContentsLine[],
  page: number,
  printed?: number,
): RowLayout | undefined {
  const key = normalize(title);
  if (!key) return undefined;
  const index = lines.findIndex((line) => {
    const lineKey = normalize(line.text.replace(/\s+(?:\d{1,9}|[ivxlcdm]+)$/i, ''));
    if (!normalize(line.text).startsWith(key) && !(lineKey.length >= 4 && key.startsWith(lineKey)))
      return false;
    if (!printed) return true;
    const folio = line.text.trim().match(/(\d{1,9}|[ivxlcdm]+)$/i)?.[1];
    // OCR may keep the number in its own fragment at the same baseline.
    return !folio || (/^\d+$/.test(folio) ? Number(folio) : romanNumber(folio)) === printed;
  });
  const line = lines[index];
  if (!line) return undefined;
  const previous = lines[index - 1];
  const next = lines[index + 1];
  return {
    ...line,
    page,
    before: previous ? line.y - previous.y - previous.height : 0,
    after: next ? next.y - line.y - line.height : 0,
  };
}

// A geometric group requires multiple independent layout clues.
function groupLayout(layout?: RowLayout, next?: RowLayout) {
  if (!layout || !next || layout.page !== next.page) return false;
  const larger = isPDFSizeAtLeast(layout.height, next.height * 1.15);
  const outdent = isPDFSizeAtLeast(next.x - layout.x, next.height * 0.8);
  const separated = isPDFSizeAtLeast(Math.max(layout.before, layout.after), layout.height * 1.5);
  return (larger && (outdent || separated)) || (outdent && separated);
}

// Resolve the whole printed table together so page breaks retain the owner.
// Link-derived levels already carry independent structure.
function restoreHierarchy(rows: Row[], layouts: Map<Row, RowLayout>) {
  const parents: { rank: number; level: number; layout?: RowLayout; volume?: boolean }[] = [];
  const styles: { rank: number; layout: RowLayout }[] = [];
  const hasChapters = rows.some((row) =>
    /^第[\d一二三四五六七八九十百零〇]+章/.test(normalize(row.title)),
  );
  rows.forEach((row, index) => {
    if (row.direct) return;
    if (index > 0 && row.scope !== rows[index - 1]!.scope) parents.length = 0;
    const layout = layouts.get(row);
    const next = layouts.get(rows[index + 1]!);
    const matter = standaloneMatter(row.title);
    const numberedTitle = normalize(row.title);
    const chapter = /^第[\d一二三四五六七八九十百零〇]+章/.test(numberedTitle);
    const section = hasChapters && /^[一二三四五六七八九十百]+[、,\s]/.test(row.title);
    let rank = partRank(row.title);
    if (chapter || (hasChapters && /^(?:绪论|序论|引言)$/.test(row.title))) rank = 3;
    if (/^第[\d一二三四五六七八九十百零〇]+节/.test(numberedTitle)) rank = hasChapters ? 4 : 3;
    if (
      rank === undefined &&
      !matter &&
      !section &&
      !hasChapters &&
      coordinate(row) === null &&
      layout &&
      groupLayout(layout, next)
    ) {
      // Compare with the whole table's established styles, not only the most
      // recent parent. Otherwise returning to an earlier style adds a new level
      // on every page and turns sibling sections into an ever-deeper chain.
      const sibling = styles.find(
        (style) =>
          isPDFSizeAtLeast(layout.height * 0.8, Math.abs(style.layout.x - layout.x)) &&
          isPDFSizeAtLeast(layout.height * 0.2, Math.abs(style.layout.height - layout.height)),
      );
      const owner = parents.at(-1);
      rank = sibling?.rank ?? (owner ? owner.rank + 1 : 0);
      if (!sibling) styles.push({ rank, layout });
    }
    if (rank !== undefined) {
      while (parents.length && parents.at(-1)!.rank >= rank) parents.pop();
      row.level = parents.length ? parents.at(-1)!.level + 1 : 0;
      parents.push({
        rank,
        level: row.level,
        layout,
        volume:
          /^第[\d一二三四五六七八九十百零〇]+[卷编]/u.test(numberedTitle) ||
          /^.{1,30}?\s*[（(]\s*[上中下]\s*[）)]/u.test(row.title),
      });
      return;
    }
    const owner = parents.at(-1);
    const visiblyInside =
      layout &&
      owner?.layout &&
      (isPDFSizeAtLeast(layout.x - owner.layout.x, layout.height * 0.8) ||
        !isPDFSizeAtLeast(layout.height, owner.layout.height * 0.9));
    const indented =
      layout && owner?.layout && isPDFSizeAtLeast(layout.x - owner.layout.x, layout.height * 0.8);
    const finalMatter = /^(?:尾声|主要人名索引|征引书目|\d{4}年第.+卷后记)/.test(numberedTitle);
    if (matter && (finalMatter || !visiblyInside || (hasChapters && !indented))) {
      // Front/back matter resets semantic chapters, but a volume owns its
      // introduction and conclusion even when these share the left margin.
      const volume = parents.findIndex((parent) => parent.volume);
      if (volume >= 0 && /^(?:引言|绪论|结语|结论)/.test(numberedTitle)) parents.splice(volume + 1);
      else parents.length = 0;
    }
    row.level = parents.length ? parents.at(-1)!.level + 1 : 0;
  });
  // A structure outside the shared outline protocol is an extraction failure,
  // never a disk failure. Keep the last valid scan for explicit retry.
  if (rows.some((row) => !rowSchema.safeParse(row).success))
    throw new Error('pdf_contents_structure_incomplete');
}

/** Exclude explanatory paragraphs only when their layout is independently
 * supported by repeated numbered headings. Small type alone cannot discard an
 * unnumbered parent or an unresolved title. */
function contentsWithoutSynopses(
  lines: string[],
  layout: PDFContentsLine[],
  count: number,
  styles: { x: number; height: number }[] = [],
) {
  const numbered = layout.filter((line) => contentsRows([line.text], [], count, true).rows.length);
  if (numbered.length < 2 && !styles.length) return lines;
  if (!numbered.length) return lines;
  const heights = numbered.map((line) => line.height).sort((a, b) => a - b);
  const size = heights[Math.floor(heights.length / 2)]!;
  const left = Math.min(
    ...numbered.map((line) => line.x),
    ...layout
      .filter((line) => /^(?:第.+[章节编部卷篇]|chapter\s+\d+|part\s+)/i.test(line.text.trim()))
      .map((line) => line.x),
  );
  const blocks: PDFContentsLine[][] = [];
  let block: PDFContentsLine[] = [];
  for (const line of layout) {
    const candidate =
      line.y >= 0.1 &&
      line.height <= size * 1.5 &&
      line.x > left + size * 3 &&
      !numbered.includes(line) &&
      partRank(line.text) === undefined &&
      !standaloneMatter(line.text) &&
      !/^(?:第[\d一二三四五六七八九十百零〇]+[章节部篇]|chapter\s+\d+)/i.test(line.text.trim());
    const prior = block.at(-1);
    if (!candidate || (prior && line.y - prior.y - prior.height > size * 1.5)) {
      if (block.length >= 2) blocks.push(block);
      block = [];
    }
    if (candidate) block.push(line);
  }
  if (block.length >= 2) blocks.push(block);
  const followsNumberedHeading = (rows: PDFContentsLine[]) => {
    const first = rows[0]!;
    const preceding = layout.findLast((line) => line.y < first.y);
    return (
      !!preceding &&
      numbered.includes(preceding) &&
      first.x > preceding.x + size * 1.5 &&
      first.y - preceding.y - preceding.height < size * 1.8
    );
  };
  const containsSynopsisSeparators = (text: string) =>
    (text.match(/[—–]+(?:\s*[—–]+)*|[；;]/g)?.length ?? 0) >= 2;
  const matchesSynopsisStyle = (line: PDFContentsLine) =>
    styles.some(
      (style) =>
        Math.abs(style.x - line.x) < 0.06 && Math.abs(style.height - line.height) < size * 0.35,
    );
  const paragraphs = blocks.filter((rows) => {
    const text = rows.map((row) => row.text).join(' ');
    return (
      (normalize(text).length >= 60 && /[。！？?!；;—–]|[a-z]\./i.test(text)) ||
      (normalize(text).length >= 24 &&
        containsSynopsisSeparators(text) &&
        (followsNumberedHeading(rows) ||
          (rows[0]!.y < numbered[0]!.y && matchesSynopsisStyle(rows[0]!))))
    );
  });
  if (
    paragraphs.length < 2 &&
    !paragraphs.some((rows) => matchesSynopsisStyle(rows[0]!) || followsNumberedHeading(rows))
  )
    return lines;
  for (const rows of paragraphs) {
    const row = rows[0]!;
    if (
      !styles.some(
        (style) => Math.abs(style.x - row.x) < 0.02 && Math.abs(style.height - row.height) < 0.003,
      )
    )
      styles.push({ x: row.x, height: row.height });
  }
  const prose = new Set(paragraphs.flat().map((line) => normalize(line.text)));
  // A paragraph can continue over the page break. A single long line in the
  // same established synopsis column is still description, not a new title.
  for (const [index, line] of layout.entries()) {
    const previous = layout[index - 1];
    if (
      previous &&
      prose.has(normalize(previous.text)) &&
      !numbered.includes(line) &&
      partRank(line.text) === undefined &&
      // A wrapped list can start midword on a character that also looks like a
      // front-matter label. Require list punctuation and continuous geometry.
      (!standaloneMatter(line.text) || /^\p{L}\s*[、，].+[—–]/u.test(line.text.trim())) &&
      !/^第[\d一二三四五六七八九十百零〇]+[章节部篇编]/.test(normalize(line.text)) &&
      matchesSynopsisStyle(line) &&
      Math.abs(line.x - previous.x) < size &&
      line.y - previous.y - previous.height < size * 1.5 &&
      line.width < previous.width * 0.85 &&
      /[、，。！？；—–]/.test(line.text)
    )
      prose.add(normalize(line.text));
    if (
      normalize(line.text).length >= 20 &&
      !numbered.includes(line) &&
      partRank(line.text) === undefined &&
      !standaloneMatter(line.text) &&
      followsNumberedHeading([line]) &&
      containsSynopsisSeparators(line.text) &&
      styles.some(
        (style) =>
          Math.abs(style.x - line.x) < size && Math.abs(style.height - line.height) < size * 0.3,
      )
    )
      prose.add(normalize(line.text));
    if (line.y < 0.85 || normalize(line.text).length < 20 || numbered.includes(line)) continue;
    if (
      paragraphs
        .flat()
        .some(
          (other) =>
            Math.abs(other.x - line.x) < size && Math.abs(other.height - line.height) < size * 0.5,
        )
    )
      prose.add(normalize(line.text));
  }
  for (let i = 1; i < layout.length - 1; i++) {
    const line = layout[i]!,
      before = layout[i - 1]!,
      after = layout[i + 1]!;
    if (
      prose.has(normalize(before.text)) &&
      prose.has(normalize(after.text)) &&
      !numbered.includes(line) &&
      partRank(line.text) === undefined &&
      normalize(line.text).length >= 20 &&
      /[。！？?!；;—–]/.test(line.text) &&
      Math.abs(line.height - before.height) < size * 0.3 &&
      Math.abs(line.x + line.width - before.x - before.width) < size * 2 &&
      line.y - before.y - before.height < size * 1.5 &&
      after.y - line.y - line.height < size * 1.5
    )
      prose.add(normalize(line.text));
  }
  return lines.filter((line) => !prose.has(normalize(line)));
}

function structureInventory(
  rows: { title: string; alternatives?: string[]; level: number; scope?: number }[],
) {
  const ancestors: number[] = [];
  return rows.map((row, index) => {
    while (ancestors.length && rows[ancestors.at(-1)!]!.level >= row.level) ancestors.pop();
    const parent = ancestors.at(-1) ?? null;
    ancestors.push(index);
    return {
      title: row.title,
      scope: row.scope,
      ...(row.alternatives?.length ? { alternatives: row.alternatives } : {}),
      level: row.level,
      parent,
    };
  });
}

// The text and layout adapters can each contain rows absent from the other.
// Recover uncovered rows within the printed table, and structural titles
// outside it, without replacing text fragments that have no boxes.
function withLayoutRows(text: string[], raw: string[], layout: PDFContentsLine[], page: number) {
  const result = [...text];
  const keys = new Set(text.map(normalize));
  const anchors = raw.flatMap((line, index) =>
    keys.has(normalize(line)) && !/^[\d ivxlcdm.·…_。•⋯∙●‧﹒:：]+$/i.test(line.trim())
      ? [index]
      : [],
  );
  for (const [index, line] of raw.entries()) {
    const key = normalize(line);
    if (!key || result.some((value) => normalize(value) === key)) continue;
    const insideTable = index >= (anchors[0] ?? Infinity) && index <= (anchors.at(-1) ?? -1);
    const structural =
      partRank(line) !== undefined ||
      standaloneMatter(line) ||
      groupLayout(rowLayout(line, layout, page), rowLayout(raw[index + 1] ?? '', layout, page));
    // Small text outside the table (for example a recurring footer) needs
    // independent structural evidence. Type size alone never excludes a parent.
    if (!insideTable && !structural) continue;
    const next = raw.slice(index + 1).map(normalize);
    const position = result.findIndex((value) => next.includes(normalize(value)));
    result.splice(position < 0 ? result.length : position, 0, line);
  }
  return result;
}

function partNumber(text: string): { kind: string; ordinal: number } | undefined {
  const chinese = normalize(text).match(
    /^(?:第([一二三四五六七八九十百零〇\d]+)(部分|部|卷|辑|篇|编)|([辑部卷篇编])([一二三四五六七八九十百零〇\d]+))/,
  );
  if (chinese) {
    const token = chinese[1] ?? chinese[4]!;
    const digits: Record<string, number> = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };
    let ordinal = 0;
    let digit = 0;
    if (/^\d+$/.test(token)) ordinal = Number(token);
    else
      for (const char of token) {
        if (char === '十' || char === '百') {
          ordinal += (digit || 1) * (char === '十' ? 10 : 100);
          digit = 0;
        } else digit = digits[char] ?? 0;
      }
    return { kind: chinese[2] ?? chinese[3]!, ordinal: ordinal + digit };
  }
  const english = text.trim().match(/^part\s+([ivxlcdm]+|\d+)(?:\s|$|[:：.])/i);
  return english
    ? {
        kind: 'part',
        ordinal: /^\d+$/.test(english[1]!) ? Number(english[1]) : romanNumber(english[1]!),
      }
    : undefined;
}

function completeStructure(
  entries: { title: string; level: number }[],
  expected: z.infer<typeof planSchema>['structure'],
) {
  if (!expected || entries.length !== expected.length) return false;
  const actual = structureInventory(entries);
  const sequence = new Map<string, number>();
  return actual.every((row, index) => {
    const source = expected[index]!;
    if (
      ![source.title, ...(source.alternatives ?? [])].some(
        (title) => normalize(row.title) === normalize(title),
      ) ||
      row.level !== source.level ||
      row.parent !== source.parent ||
      row.level !== (row.parent === null ? 0 : actual[row.parent]!.level + 1)
    )
      return false;
    const part = partNumber(row.title);
    if (part) {
      const key = `${source.scope}:${row.parent}:${part.kind}`;
      const previous = sequence.get(key);
      if (previous !== undefined && part.ordinal <= previous) return false;
      sequence.set(key, part.ordinal);
    }
    return true;
  });
}

type PrintedLine = {
  contents?: boolean;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  words: OCRPage['lines'];
};
function printedLines(page: OCRPage | null): PrintedLine[] {
  return page ? OCRContentsLayout(page) : [];
}

// A numeric suffix is not automatically punctuation. Treat it as a reference
// only for a numbered heading with a matching, smaller footnote below it.
// This derived evidence never changes the OCR layer or selection offsets.
function headingEvidenceText(page: OCRPage) {
  const rows = printedLines(page);
  const headings = rows.flatMap((row) => {
    const match = row.text.trim().match(/^(.*\p{Script=Han})\s*(\d{1,2})$/u);
    if (!match || !/^第[\d一二三四五六七八九十百零〇]+[章节部篇]/.test(normalize(match[1]!)))
      return [];
    const note = rows.some(
      (other) =>
        other.y >= 0.65 &&
        other.y > row.y + row.height &&
        other.height < row.height * 0.8 &&
        new RegExp(`^${match[2]}\\s*[【\\[（(《]`).test(other.text.trim()),
    );
    return note ? [match[1]!] : [];
  });
  return [OCRPageText(page), ...headings, ...transposedHeadings(page)].join('\n');
}

// A subtitle may precede the larger chapter title on its opening page, while
// the table prints them in the opposite order. Require two centered, isolated
// heading lines; never permute words in prose or accept only half the title.
function transposedHeadings(page: OCRPage | null) {
  const rows = printedLines(page);
  const result: string[] = [];
  for (const [i, first] of rows.entries()) {
    if (first.y < 0.06 || first.y > 0.25 || normalize(first.text).length < 4) continue;
    for (let j = i + 1; j < Math.min(rows.length, i + 4); j++) {
      const second = rows[j]!;
      if (second.y > 0.35 || second.y - first.y - first.height > 0.15) break;
      if (
        second.y <= first.y + first.height ||
        second.height < first.height * 1.15 ||
        Math.abs(first.x + first.width / 2 - second.x - second.width / 2) > first.height ||
        Math.abs(second.x + second.width / 2 - 0.5) > 0.08 ||
        normalize(second.text).length < 4 ||
        rows.slice(i + 1, j).some((line) => normalize(line.text).length > 3) ||
        !rows.slice(j + 1).length ||
        rows
          .slice(j + 1)
          .some((line) => line.y - second.y - second.height < Math.max(0.08, second.height * 2))
      )
        continue;
      result.push(`${second.text.trim()} ${first.text.trim()}`);
    }
  }
  return result;
}

// Re-read the same printed fragments at another precise raster size. Uncovered
// original fragments remain candidates: an alternate pass cannot erase a row.
function contentsEvidence(primary: OCRPage, alternate: OCRPage): OCRPage {
  const replacement = printedLines(alternate);
  const retained = printedLines(primary).filter((row) => {
    if (!normalize(row.text)) return false;
    const aligned = replacement.filter((other) => {
      const vertical =
        Math.min(row.y + row.height, other.y + other.height) - Math.max(row.y, other.y);
      return (
        vertical >= Math.min(row.height, other.height) * 0.5 &&
        Math.abs(row.y + row.height / 2 - other.y - other.height / 2) <=
          Math.max(row.height, other.height) * 0.6 &&
        other.x < row.x + row.width &&
        other.x + other.width > row.x
      );
    });
    if (!aligned.length) return true;
    if (aligned.some((other) => normalize(other.text) === normalize(row.text))) return false;
    if (
      row.x > 0.7 &&
      /^\d{1,4}$/.test(row.text.trim()) &&
      aligned.some((other) => other.text.trim().endsWith(row.text.trim()))
    )
      return false;
    // Compare the complete alternate row's envelope, including the number
    // column. Fragment-to-fragment width ratios retain overlapping readings
    // when one pass splits a title and folio differently, creating fake text.
    const left = Math.min(...aligned.map((other) => other.x));
    const right = Math.max(...aligned.map((other) => other.x + other.width));
    const covered = Math.min(row.x + row.width, right) - Math.max(row.x, left);
    return covered < row.width * 0.8;
  });
  return {
    ...alternate,
    alternatives: undefined,
    lines: [...replacement, ...retained]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .flatMap((row) => row.words),
  };
}

// A header template is established above an explicit Contents label. Only
// matching marginal geometry may identify it on continuation pages; chapter
// title verification never uses this tolerance or modifies OCR text.
function isRunningHeader(line: PDFContentsLine, header: PDFContentsLine) {
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
function sameFolioHeader(a: PDFContentsLine, b: PDFContentsLine) {
  const title = (line: PDFContentsLine) => {
    // Repeated volume running headers may have ornamental glyphs.
    const named =
      /^\d{1,4}/.test(line.text) && line.text.match(/第[\d一二三四五六七八九十百零〇]+卷.+$/)?.[0];
    return named || line.text.replace(/^\d{1,4}[\s/]+|[\s/]+\d{1,4}$/g, '');
  };
  const folio = (line: PDFContentsLine) => line.text.match(/^\d{1,4}(?=[\s/])|\d{1,4}$/)?.[0];
  const text = normalize(title(a));
  const other = normalize(title(b));
  // Ornamental marks can be recognized as one or two extra letters. Require
  // the same long suffix, changing folios and matching marginal geometry.
  const sameTitle =
    text === other ||
    (Math.min(text.length, other.length) >= 6 &&
      Math.abs(text.length - other.length) <= 2 &&
      (text.endsWith(other) || other.endsWith(text)));
  return (
    a.y < 0.1 &&
    b.y < 0.1 &&
    title(a) !== a.text &&
    title(b) !== b.text &&
    folio(a) !== folio(b) &&
    text.length >= 6 &&
    sameTitle &&
    Math.abs(a.x - b.x) < 0.04 &&
    Math.abs(a.y - b.y) < 0.015 &&
    Math.abs(a.width - b.width) < 0.04 &&
    Math.abs(a.height - b.height) < 0.01
  );
}
// Only use a visibly separated interior title to disambiguate a missing page
// number from repeated running headers. Ambiguous layouts keep page navigation.
function prominentTitles(page: import('./pdfEnhancement').OCRPage | null) {
  const rows: { text: string; top: number; bottom: number; left: number; right: number }[] = [];
  let words: NonNullable<typeof page>['lines'] = [];
  for (const word of page?.lines ?? []) {
    words.push(word);
    if (!word.endLine) continue;
    rows.push({
      text: words.map((w) => w.text).join(''),
      top: Math.min(...words.map((w) => w.y)),
      bottom: Math.max(...words.map((w) => w.y + w.height)),
      left: Math.min(...words.map((w) => w.x)),
      right: Math.max(...words.map((w) => w.x + w.width)),
    });
    words = [];
  }
  // A chapter number and title can occupy separate centered lines. Join
  // adjacent aligned boxes before testing the whitespace below the block.
  const blocks = rows.flatMap((first, i) => {
    const candidates = [first];
    let block = first;
    for (const next of rows.slice(i + 1, i + 4)) {
      const height = next.bottom - next.top;
      const center = (block.left + block.right) / 2;
      if (
        next.top < block.bottom ||
        next.top - block.bottom > height * 1.8 ||
        (Math.abs(next.left - first.left) > height &&
          Math.abs((next.left + next.right) / 2 - center) > height * 2)
      )
        break;
      block = { ...block, text: `${block.text}\n${next.text}`, bottom: next.bottom };
      candidates.push(block);
    }
    return candidates;
  });
  return blocks
    .filter((row) => {
      const below = rows.filter((other) => other.top > row.bottom);
      const height = row.bottom - row.top;
      const glyphHeight = Math.max(
        ...rows
          .filter((line) => line.top >= row.top && line.bottom <= row.bottom)
          .map((line) => line.bottom - line.top),
      );
      const bodyHeights = below.map((other) => other.bottom - other.top).sort((a, b) => a - b);
      // Real chapter titles can cross the top 10% boundary. Only a numbered
      // title with larger type and independent whitespace may cross it;
      // same-size running heads retain the stricter interior boundary.
      const largeNumbered =
        row.top >= 0.06 &&
        row.bottom >= 0.1 &&
        below.length >= 2 &&
        /^(?:chapter\s+\d+|第[\d一二三四五六七八九十百零〇]+[章部篇])(?:\s|[：:.、]|$)/i.test(
          row.text.normalize('NFKC'),
        ) &&
        height >= bodyHeights[Math.floor(bodyHeights.length / 2)]! * 1.2;
      return (
        (row.top >= 0.1 ||
          largeNumbered ||
          (row.top >= 0.06 &&
            below.length >= 2 &&
            below.every((other) => other.top - row.bottom >= 0.12))) &&
        row.top <= 0.5 &&
        below.every(
          (other) =>
            other.top - row.bottom >=
            Math.max(glyphHeight * 1.35, (other.bottom - other.top) * 1.8),
        )
      );
    })
    .map((row) => row.text)
    .concat(transposedHeadings(page));
}

function contentsRows(lines: string[], labels: string[], _count: number, confirmed = false) {
  const rows: Row[] = [];
  let rejected = 0;
  for (const line of lines) {
    if (isContentsLine(line) || /^(?:part|chapter)\s+[ivxlcdm\d]+$/i.test(line.trim())) continue;
    const cleaned = line
      .normalize('NFKC')
      .trim()
      .replace(/(\d)\s*[•·]$/, '$1');
    const match = confirmed
      ? (cleaned.match(/^(.+?)(?:\s*[/.·…_。•⋯∙●‧﹒:：]+\s*|\s+)(\d{1,9}|[ivxlcdm]+)\s*$/i) ??
        cleaned.match(/^(.*?\p{Script=Han})(\d{1,9}|[ivxlcdm]+)\s*$/iu))
      : cleaned.match(/^(.+?)(?:\s*[.·…_。•⋯∙●‧﹒]{2,}\s*|\s+)(\d{1,9}|[ivxlcdm]+)\s*$/i);
    if (!match) continue;
    const title = match[1]!
      .replace(/^[◎●•]\s*/, '')
      .replace(/[/.·…_。•⋯∙●‧﹒,，\s]+$/, '')
      .trim();
    if (!validTitle(title) || title.length > 500) {
      rejected++;
      continue;
    }
    const printed = match[2]!.toLowerCase();
    const indices = labels.flatMap((label, i) =>
      label.normalize('NFKC').trim().toLowerCase() === printed ? [i] : [],
    );
    const number = /^\d+$/.test(printed) ? Number(printed) : romanNumber(printed);
    if (!Number.isSafeInteger(number) || number <= 0) {
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
      targetPage: indices.length === 1 ? indices[0]! : null,
      printedLabel: match[2]!,
      level,
      system: /^\d+$/.test(printed) ? 'arabic' : 'roman',
      printed: number,
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
  options: PreparationOptions = {},
) {
  const next = preparation.then(() => prepareContents(source, book, signal, onReport, options));
  preparation = next.catch(() => {});
  return next;
}

/** Local import preparation. Never persists a partial or unchecked chapter list. */
async function prepareContents(
  source: string,
  book: BookDoc,
  signal?: AbortSignal,
  onReport?: (report: PDFContentsReport) => void,
  options: PreparationOptions = {},
): Promise<'preserved' | 'generated' | 'unavailable'> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let expired = false;
  const startedAt = performance.now();
  const progress = { verifiedCount: 0, totalCount: 0, resumed: false };
  const timer = setTimeout(
    () => {
      expired = true;
      abort();
    },
    Math.min(180_000, options.timeoutMs ?? 180_000),
  );
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
      elapsedMs: Math.round(performance.now() - startedAt),
      ...progress,
      ...(progress.totalCount
        ? { remainingCount: progress.totalCount - progress.verifiedCount }
        : {}),
      ...(state !== 'running' && state !== 'completed'
        ? { failureCategory: classifyFailure({ code, stage }) }
        : {}),
      ...context,
      ...(errorKind ? { errorKind } : {}),
    };
    // Only report durable continuation after the write has completed.
    await persist(value).catch(() => {});
    try {
      onReport?.(value);
    } catch {}
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
  let openedCache: Awaited<ReturnType<typeof openPDFCache>> = null;
  const invalidateSession = () => void releasePDFSourceSession(openedCache).catch(() => {});
  controller.signal.addEventListener('abort', invalidateSession, { once: true });
  try {
    await report('running');
    check();
    const cache = await bounded(
      openPDFCache(source, true, options.owner, true).then((opened) => {
        openedCache = opened;
        if (controller.signal.aborted) invalidateSession();
        return opened;
      }),
    );
    check();
    if (!cache || !book.getPDFText) return unavailable('pdf_contents_unavailable');
    // A user's saved outline always wins, including a deliberately empty one.
    if (!cache.generator && (cache.outline !== null || cache.revision > 0))
      return complete('preserved');
    const regenerate = !!options.regenerate && !!cache.generator;
    if (!regenerate && cache.generator === GENERATOR && cache.outline?.length)
      return complete('preserved');
    const count = book.sections.length;
    if (count < 2 || count > MAX_PAGES) return unavailable('pdf_contents_page_limit');
    // Reuse the reader's local converter for equivalent Chinese glyphs. A
    // failed optional WASM load retains exact matching, never guessed spelling.
    try {
      await bounded(initSimpleCC());
      check();
      variantsReady = true;
    } catch {
      check();
    }
    const checksKey = await bounded(hashData({ id: cache.id, count })).catch(() => null);
    const saved = checkpointSchema.safeParse(
      await bounded(options.checkpoint?.read() ?? Promise.resolve(null)).catch(() => null),
    );
    const derived = checksKey ? await bounded(checksStore.load(checksKey)).catch(() => null) : null;
    const checks = saved.success && saved.data.key === checksKey ? saved.data.checks : derived;

    check();
    const verified = checks?.entries ?? [];
    let plan: z.infer<typeof planSchema> | undefined;
    let scan: z.infer<typeof scanSchema> | undefined;
    let verificationCursor = 0;
    let lastSaved = '';
    const previousProgress = [
      checks?.scan?.discovery.next ?? 0,
      checks?.scan?.discovery.nativeNext ?? 0,
      checks?.scan?.extraction?.next ?? 0,
      checks?.plan?.search?.nativeNext ?? 0,
      checks?.plan?.search?.coarseNext ?? 0,
      checks?.plan?.targets?.length ?? 0,
      checks?.plan?.targets?.filter((values) => values.length === 1).length ?? 0,
      checks?.entries.length ?? 0,
      Number(!!checks?.plan),
    ];
    persist = async (run) => {
      if (run.state !== 'running' && run.state !== 'completed' && plan?.targetIssues?.length)
        run.issues = plan.targetIssues.slice(0, 8).flatMap((issue) => {
          const row = plan?.rows[issue.row];
          return row
            ? [{ title: row.title, sourcePage: row.sourcePage, reason: issue.reason }]
            : [];
        });
      if (!checksKey) return;
      if (options.checkpoint && (plan || scan)) {
        const signature = [
          run.state,
          run.code,
          verificationCursor,
          plan?.targets?.length,
          plan?.revision,
          scan?.discovery.next,
          scan?.discovery.nativeNext,
          plan?.search?.nativeNext,
          plan?.search?.coarseNext,
          scan?.discovery.found,
          scan?.extraction?.next,
        ].join(':');
        const canResume =
          !!(
            plan ||
            scan?.discovery.next ||
            scan?.discovery.nativeNext ||
            scan?.discovery.found !== undefined
          ) &&
          (run.state === 'running' ||
            run.state === 'cancelled' ||
            run.code === 'pdf_contents_timeout' ||
            run.code === 'pdf_contents_ocr_limit' ||
            run.code === 'pdf_contents_text_limit');
        const progress = [
          scan?.discovery.next ?? 0,
          scan?.discovery.nativeNext ?? 0,
          scan?.extraction?.next ?? 0,
          plan?.search?.nativeNext ?? 0,
          plan?.search?.coarseNext ?? 0,
          plan?.targets?.length ?? 0,
          plan?.targets?.filter((values) => values.length === 1).length ?? 0,
          verified.length,
          Number(!!plan),
        ];
        const checkpointAdvanced = progress.some((value, i) => value > previousProgress[i]!);
        const checks = checksSchema.safeParse({
          verifier: 'pdf-heading-2',
          entries: verified,
          plan,
          scan: plan ? undefined : scan,
          run: { ...run, canResume, checkpointAdvanced },
        });
        if (!checks.success) {
          run.canResume = false;
          run.checkpointValidationFailed = true;
          return;
        }
        try {
          if (signature !== lastSaved) {
            await options.checkpoint.write({ key: checksKey, checks: checks.data });
            lastSaved = signature;
          }
          run.canResume = canResume;
          run.checkpointAdvanced = checkpointAdvanced;
        } catch {
          run.canResume = false;
          run.checkpointSaveFailed = true;
        }
        return;
      }
      // Terminal status must survive our own timeout/cancellation. No book text
      // or raw native exception is stored; this cache has fixed eviction limits.
      const status = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          checksStore.save(
            checksKey,
            { verifier: 'pdf-heading-2', entries: verified, plan, run },
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
    const recognizeNative = (
      sourcePath: string,
      cacheId: string,
      indices: number[],
      taskSignal: AbortSignal,
      onStatus: Parameters<typeof recognizePDFPages>[4] = () => {},
      detect = false,
      contents = false,
      heading = false,
      region?: PDFOCRRegion,
      regions?: readonly PDFOCRRegion[],
    ) =>
      recognizePDFPages(
        sourcePath,
        cacheId,
        indices,
        taskSignal,
        onStatus,
        detect,
        contents,
        heading,
        cache.session ?? undefined,
        region,
        regions,
      );
    const matchers = new Map<string, ReturnType<typeof headingMatcher>>();
    const matchesHeading = (text: string, title: string, ocr = false) => {
      let matcher = matchers.get(text);
      if (!matcher) {
        matcher = headingMatcher(text);
        matchers.set(text, matcher);
        if (matchers.size > 64) matchers.delete(matchers.keys().next().value!);
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
      if (!page || page.native || (page.recognizer && page.recognizer !== 'vision-contents-2')) {
        if (++ocrCount > MAX_OCR_PAGES) throw new Error('pdf_contents_ocr_limit');
        const previousStage = stage;
        await phase('ocr');
        const done = await perform('fine_ocr', index, () =>
          recognizeNative(source, cache.id, [index], controller.signal, undefined, false, true),
        );
        check();
        if (done.state !== 'completed') throw new Error(done.error ?? 'pdf_recognition_failed');
        await phase(previousStage);
        page = await perform('cache_read', index, () => readOCRPage(cache.id, index, false, true));
        if (!page) throw new Error('pdf_recognition_failed');
      }
      characters += [page.lines, ...(page.alternatives ?? [])]
        .flat()
        .reduce((n, line) => n + line.text.length, 0);
      if (characters > 2_000_000) throw new Error('pdf_contents_text_limit');
      evidencePages.set(index, page);
      return page;
    };
    const fromOCR = (ocr: OCRPage) => ({
      text: headingEvidenceText(ocr),
      layout: ocr,
      ocr: !ocr.native,
      lines: OCRContentsLines(ocr),
      allLines: OCRContentsLines(ocr, true),
      prominent: prominentTitles(ocr),
    });
    const prominentMatch = (
      page: { text: string; prominent: string[]; layout: OCRPage | null },
      title: string,
    ) =>
      page.prominent.some((heading) => matchesHeading(heading, title)) ||
      // Sparse title leaves may be vertical. Their native text order can be
      // correct even when horizontal row reconstruction merges the columns.
      // Require the full exact title and independent large-type geometry.
      (normalize(page.text).length <= normalize(title).length * 3 + 16 &&
        !!page.layout?.lines.some((line) => line.height >= 0.06) &&
        matchesHeading(page.text, title));
    // Local crops are a separate versioned sidecar. Each scale is independent
    // evidence; never concatenate contradictory passes or replace reading CFIs.
    const headingPages = new Map<string, OCRPage>();
    const croppedEvidenceBatch = async (
      index: number,
      regions: readonly (PDFOCRRegion | undefined)[],
    ) => {
      const batch =
        regions.length > 1 ? regions.filter((region) => region !== undefined) : undefined;
      const key = (region?: PDFOCRRegion) =>
        `${index}:${region?.join(',') ?? ''}:${batch?.join(';') ?? ''}`;
      const readCrop = (region?: PDFOCRRegion) =>
        perform('cache_read', index, () =>
          readOCRPage(cache.id, index, false, false, true, region, batch),
        );
      const scans: OCRPage[] = [];
      const load = async (allowNative = false) => {
        scans.length = 0;
        for (const region of regions) {
          const page = headingPages.get(key(region)) ?? (await readCrop(region));
          if (page && (allowNative || !page.native)) scans.push(page);
        }
      };
      await load();
      if (scans.length < regions.length) {
        ocrCount += regions.length - scans.length;
        if (ocrCount > MAX_OCR_PAGES) throw new Error('pdf_contents_ocr_limit');
        const previousStage = stage;
        await phase('ocr');
        const done = await perform('heading_ocr', index, () =>
          recognizeNative(
            source,
            cache.id,
            [index],
            controller.signal,
            undefined,
            false,
            false,
            true,
            batch ? undefined : regions[0],
            batch,
          ),
        );
        check();
        if (done.state !== 'completed') throw new Error(done.error ?? 'pdf_recognition_failed');
        await phase(previousStage);
        await load(true);
        if (scans.length !== regions.length) throw new Error('pdf_recognition_failed');
      }
      for (const [i, page] of scans.entries()) {
        const id = key(regions[i]);
        if (headingPages.has(id)) continue;
        characters += [page.lines, ...(page.alternatives ?? [])]
          .flat()
          .reduce((n, word) => n + word.text.length, 0);
        if (characters > 2_000_000) throw new Error('pdf_contents_text_limit');
        headingPages.set(id, page);
      }
      return scans;
    };
    const croppedEvidence = async (index: number, region?: PDFOCRRegion) =>
      (await croppedEvidenceBatch(index, [region]))[0]!;
    const read = async (index: number) => {
      check();
      if (pages.has(index)) return pages.get(index)!;
      const ocr = available.has(index)
        ? await perform('cache_read', index, () => readOCRPage(cache.id, index))
        : null;
      check();
      const text =
        ocr && !ocr.native
          ? headingEvidenceText(ocr)
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
      const nativeLayout =
        !ocr && book.getPDFContentsLayout
          ? await perform('native_layout', index, () => book.getPDFContentsLayout!(index))
          : [];
      const layout =
        ocr ??
        (nativeLayout.length
          ? {
              index,
              native: true,
              lines: nativeLayout.map((line) => ({ ...line, endLine: true })),
            }
          : null);
      const page = {
        text: layout?.native ? `${headingEvidenceText(layout)}\n${text}` : text,
        layout,
        ocr: !!ocr && !ocr.native,
        lines,
        allLines:
          ocr && !ocr.native
            ? OCRContentsLines(ocr, true)
            : book.getPDFContentsLines
              ? await perform('native_layout', index, () => book.getPDFContentsLines!(index, true))
              : contentsLines(text),
        prominent: prominentTitles(layout),
      };
      pages.set(index, page);
      if (pages.size > 64) pages.delete(pages.keys().next().value!);
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
        recognizeNative(source, cache.id, missing, controller.signal),
      );
      check();
      if (done.state !== 'completed') throw new Error(done.error ?? 'pdf_recognition_failed');
      await phase(previousStage);
      for (const index of missing) {
        available.add(index);
        pages.delete(index);
      }
    };
    // Nonempty replacement glyphs from a damaged PDF text layer must not
    // prevent visual discovery. The ordinary reading layer stays intact.
    const canDetectFromText = (page: Awaited<ReturnType<typeof read>>) => {
      if (page.ocr || !page.text.trim())
        return page.text.trim().length > 0 || !!(page.layout && !needsOCRRecovery(page.layout));
      const text = page.text.replace(/\s/g, '');
      const damaged = text.match(/[\uFFFD\p{Co}]/gu)?.length ?? 0;
      return damaged < 4 || damaged * 4 < text.length;
    };
    // Detection text is never passed to verify(). It can only nominate pages.
    const previews = new Map<number, { text: string; lines: string[] }>();
    const rememberPreview = (index: number, page: import('./pdfEnhancement').OCRPage) => {
      const text = OCRPageText(page);
      characters += text.length;
      if (characters > 2_000_000) throw new Error('pdf_contents_text_limit');
      previews.set(index, { text, lines: OCRContentsLines(page) });
    };
    const detect = async (index: number, end = count) => {
      const page = await read(index);
      if (canDetectFromText(page)) return page.text;
      if (previews.has(index)) return previews.get(index)!.text;
      // Small batches amortize worker startup/polling while keeping discovery
      // progressive. Accurate OCR remains strictly page-demanded.
      const batch: number[] = [];
      for (let i = index; i < Math.min(end, index + 16); i++) {
        const known = await read(i);
        if (canDetectFromText(known) || previews.has(i)) continue;
        const cached = await perform('detection_read', i, () => readOCRPage(cache.id, i, true));
        if (cached) rememberPreview(i, cached);
        else batch.push(i);
      }
      if (batch.length) {
        const previousStage = stage;
        await phase('ocr');
        const done = await perform('detection_ocr', batch[0]!, () =>
          recognizeNative(source, cache.id, batch, controller.signal, undefined, true),
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
      // A chapter list is text evidence for the table, never for its target.
      // Some digital PDFs have a linked index with no "Contents" heading.
      if (isChapterIndex(page.allLines) || isMatterList(page.allLines)) return false;
      if (!matchesHeading(page.text, title, page.ocr) && page.text.trim()) {
        const alternate = await accurateEvidence(index);
        if (alternate && !alternate.native) {
          for (const lines of [alternate.lines, ...(alternate.alternatives ?? [])]) {
            const candidate = fromOCR({ ...alternate, lines, alternatives: undefined });
            if (matchesHeading(candidate.text, title, true)) {
              page = candidate;
              pages.set(index, page);
              break;
            }
          }
        }
        if (!matchesHeading(page.text, title, page.ocr) && nearHeading(page.text, title)) {
          const anchor = printedLines(page.layout).find(
            (line) => line.y < 0.6 && line.y >= 0.06 && nearHeading(line.text, title),
          );
          const top = anchor ? Math.max(0, Math.floor((anchor.y - 0.04) * 1000)) : 0;
          const region: PDFOCRRegion | undefined = anchor
            ? [0, top, 1000, Math.min(1000 - top, 450)]
            : undefined;
          const cropped = await croppedEvidence(index, region);
          for (const lines of [cropped.lines, ...(cropped.alternatives ?? [])]) {
            const candidate = fromOCR({ ...cropped, lines, alternatives: undefined });
            if (matchesHeading(candidate.text, title, true) && prominentMatch(candidate, title)) {
              page = candidate;
              pages.set(index, page);
              break;
            }
          }
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
              plan,
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
      // A failed regeneration cannot erase a previously published outline.
      if (regenerate && cache.outline?.length) return;
      // Persist rejection of a bad embedded outline too. Reopening must not
      // bring its wrong links back; a later explicit import can retry discovery.
      if (embedded.length && !pageNavigation) {
        const saved = await savePDFOutline(source, cache, null, count, 'glossa-pages-1');
        if (plan) plan.revision = saved.revision;
      }
    };
    await phase('embedded');
    // A complete previous result needs only the stable verifier, not discovery.
    if (!regenerate && cache.generator === 'glossa-contents-2' && cache.outline?.length) {
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
      !regenerate &&
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

    const labels = book.getPDFPageLabels?.() ?? [];
    const labelsHash = await bounded(hashData(labels)).catch(() => null);
    const contentsPages = new Set<number>();
    const rows: Row[] = [];
    const layouts = new Map<Row, RowLayout>();
    const nativeLayouts = new Map<number, PDFContentsLine[]>();
    const contentsLayout = async (index: number) => {
      if (!book.getPDFContentsLayout) return [];
      if (!nativeLayouts.has(index))
        nativeLayouts.set(
          index,
          await perform('native_layout', index, () => book.getPDFContentsLayout!(index)),
        );
      return nativeLayouts.get(index)!;
    };
    const sources = new Map<number, string>();
    const sourceEvidence = async (index: number) =>
      hashData({
        page: await read(index),
        alternate: await perform('cache_read', index, () =>
          readOCRPage(cache.id, index, false, true),
        ),
        crop: await perform('cache_read', index, () =>
          readOCRPage(cache.id, index, false, false, true),
        ),
        layout: await contentsLayout(index),
      });
    // Candidates are reusable only for the same PDF, revision, routing and page
    // labels. Re-read every source page; the plan is never title evidence.
    const savedPlan = checks?.plan;
    if (
      savedPlan &&
      !(
        checks?.run?.state === 'unavailable' &&
        !checks.run.canResume &&
        ['verification', 'extraction', 'mapping'].includes(checks.run.failureCategory ?? '')
      ) &&
      savedPlan.extractor === EXTRACTOR &&
      savedPlan.revision === cache.revision &&
      savedPlan.regenerate === regenerate &&
      savedPlan.labels === labelsHash &&
      savedPlan.completed.length <= savedPlan.rows.length &&
      savedPlan.sources.length > 0 &&
      savedPlan.sources.every((source) => source.index < count)
    ) {
      let current = true;
      for (const source of savedPlan.sources) {
        if ((await sourceEvidence(source.index)) !== source.evidence) {
          current = false;
          break;
        }
      }
      if (current) {
        plan = structuredClone(savedPlan);
        rows.push(...plan.rows);
        plan.contentsPages.forEach((index) => contentsPages.add(index));
        progress.resumed = true;
      }
    }
    if (!plan) {
      // Discover actual contents pages, rather than parsing every numbered paragraph.
      // Even a broken outline can point to the real contents after a long preface.
      // Treat its destination as an untrusted hint, never as verified contents.
      const savedScan = checks?.scan;
      const compatibleScan =
        savedScan?.extractor === EXTRACTOR &&
        savedScan.revision === cache.revision &&
        savedScan.regenerate === regenerate &&
        savedScan.labels === labelsHash &&
        savedScan.discovery.next <= count &&
        (savedScan.discovery.found ?? -1) < count &&
        (savedScan.discovery.fallback ?? -1) < count;
      if (labelsHash && options.checkpoint) {
        scan = compatibleScan
          ? structuredClone(savedScan)
          : {
              extractor: EXTRACTOR,
              revision: cache.revision,
              regenerate,
              labels: labelsHash,
              discovery: {
                next: 0,
                probes: 0,
                nativeNext: 0,
                tables: [],
                indexed: [],
                images: [],
                general: [],
              },
            };
      }
      const discovery = scan?.discovery ?? {
        next: 0,
        probes: 0,
        nativeNext: 0,
        tables: [] as number[],
        indexed: [] as number[],
        images: [] as number[],
        general: [] as number[],
        found: undefined,
        fallback: undefined,
      };
      progress.resumed = discovery.next > 0 || discovery.found !== undefined;
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
      let discovered = discovery.found;
      if (discovered === undefined) {
        for (const index of hints) {
          if (isContents(await detect(index))) {
            discovered = index;
            break;
          }
        }
      }
      // Native text and existing accurate OCR are cheap: inspect the whole book,
      // including a late TOC, before spending any OCR on discovery.
      for (let i = discovery.nativeNext; i < count; i++) {
        const page = await read(i);
        if (isContents(page.text) && !isGeneralContents(page.text)) discovery.tables.push(i);
        if (isGeneralContents(page.text)) discovery.general.push(i);
        else if (isChapterIndex(page.allLines)) discovery.indexed.push(i);
        if (!canDetectFromText(page)) discovery.images.push(i);
        const lines = page.lines.filter((line) => line.trim());
        const found = contentsRows(lines, [], count).rows.length;
        if (!isGeneralContents(page.text) && (found >= 4 || (found >= 2 && found === lines.length)))
          discovery.fallback ??= i;
        discovery.nativeNext = i + 1;
        if (scan && discovery.nativeNext % 16 === 0) await report('running');
      }
      discovered ??= [...discovery.tables, ...discovery.indexed].sort((a, b) => a - b)[0];
      const tableLike = async (index: number) => {
        const lines = (previews.get(index)?.lines ?? (await read(index)).lines).filter((line) =>
          line.trim(),
        );
        const found = contentsRows(lines, [], count).rows.length;
        return found >= 4 || (found >= 2 && found === lines.length);
      };
      // Coarse recognition inventories every image-only page, including later
      // local tables in a bound volume. It does not count as title evidence.
      const images = new Set(discovery.images);
      for (let i = discovery.next; i < count; i++) {
        if (images.has(i)) {
          const detected = await detect(i);
          if (isGeneralContents(detected)) discovery.general.push(i);
          else if (isContents(detected)) {
            if (!discovery.tables.includes(i)) discovery.tables.push(i);
            discovered ??= i;
          } else if (await tableLike(i)) {
            discovery.fallback ??= i;
            if (previews.has(i) && discovery.probes < 4) {
              await recognize([i]);
              discovery.probes++;
              if (isContents((await read(i)).text)) {
                if (!discovery.tables.includes(i)) discovery.tables.push(i);
                discovered ??= i;
              }
            }
          }
        }
        discovery.next = i + 1;
        if (scan && i % 16 === 15) await report('running');
      }
      discovered ??= discovery.fallback;
      const usesGeneral = discovered === undefined && discovery.general.length > 0;
      if (usesGeneral) discovered = discovery.general[0];
      // A named running header may be the middle of a table. Walk back over
      // independently table-shaped pages, including an unread image boundary.
      // A resumed discovery cursor alone cannot certify the start of a table.
      if (discovered !== undefined && !scan?.extraction) {
        for (let index = discovered - 1; index >= 0; index--) {
          let prior = await read(index);
          if (!prior.text.trim()) {
            const preview = await detect(index, index + 1);
            if (
              !isContents(preview) &&
              contentsRows(contentsLines(preview), [], count, true).rows.length < 2
            )
              break;
            await recognize([index]);
            prior = await read(index);
          }
          const candidates = contentsRows(prior.allLines, [], count, true).rows;
          const marked = prior.allLines.some((line) => /[/.·…_。•⋯∙●‧﹒]{1,}\s*\d+\s*$/.test(line));
          const structural = prior.allLines.filter((line) =>
            /^(?:第.+[章节编部卷篇]|chapter\s+\d+|part\s+)/i.test(line.trim()),
          );
          if (isGeneralContents(prior.text)) break;
          if (
            !isContents(prior.text) &&
            !(candidates.length >= 2 && marked && structural.length >= 2)
          )
            break;
          discovered = index;
        }
      }
      discovery.found = discovered;
      let extraction = scan?.extraction;
      if (extraction) {
        const start = discovered ?? count;
        const ordered = extraction.contentsPages.every(
          (index, i) =>
            index >= start &&
            index < extraction!.next &&
            (i === 0 || index > extraction!.contentsPages[i - 1]!) &&
            extraction!.sources.some(([page]) => page === index),
        );
        if (
          !ordered ||
          extraction.next <= start ||
          extraction.next > count ||
          extraction.sources.some(([index]) => index < start || index >= extraction!.next)
        ) {
          extraction = undefined;
        } else {
          for (const [index, evidence] of extraction.sources) {
            if ((await sourceEvidence(index)) !== evidence) {
              extraction = undefined;
              break;
            }
          }
        }
        scan!.extraction = extraction;
      }
      if (discovered !== undefined && !extraction && !canDetectFromText(await read(discovered)))
        await detect(discovered);
      await phase('extraction');
      const runningHeaders: PDFContentsLine[] = extraction?.headers ?? [];
      const synopsisStyles = extraction?.synopsisStyles ?? [];
      const margins: { index: number; line: PDFContentsLine }[] = extraction?.margins ?? [];
      const marginalRows = new Map<Row, { index: number; line: PDFContentsLine }>();
      let linkedTable = extraction?.linkedTable ?? false;
      let visualTable = extraction?.visualTable ?? false;
      if (extraction) {
        for (const [index, evidence] of extraction.sources) sources.set(index, evidence);
        for (const index of extraction.contentsPages) contentsPages.add(index);
        for (const { row, layout, marginal } of extraction.rows) {
          rows.push(row);
          if (layout) layouts.set(row, layout);
          if (marginal) marginalRows.set(row, marginal);
        }
      }
      const saveExtraction = async (next: number) => {
        if (!scan) return;
        scan.extraction = structuredClone({
          next,
          linkedTable,
          visualTable,
          sources: [...sources],
          contentsPages: [...contentsPages],
          rows: rows.map((row) => ({
            row,
            layout: layouts.get(row),
            marginal: marginalRows.get(row),
          })),
          synopsisStyles,
          headers: runningHeaders,
          margins,
        });
        await report('running');
      };
      const tableStarts = [
        ...new Set([...(discovered === undefined ? [] : [discovered]), ...discovery.tables]),
      ].sort((a, b) => a - b);
      for (const scope of tableStarts) {
        if (
          (contentsPages.has(scope) && scope !== extraction?.rows.at(-1)?.row.scope) ||
          (extraction && scope < (extraction.rows.at(-1)?.row.scope ?? discovered ?? count))
        )
          continue;
        const scopeStart = rows.length;
        if (extraction && scope === (extraction.rows.at(-1)?.row.scope ?? discovered)) {
          // Continue the already proven source range.
        } else {
          linkedTable = false;
          visualTable = false;
        }
        for (let index = Math.max(scope, extraction?.next ?? scope); index < count; index++) {
          await read(index);
          await recognize([index]);
          let page = await read(index);
          if (
            linkedTable ||
            (isChapterIndex(page.allLines) &&
              !isContents(page.text) &&
              contentsRows(page.lines, labels, count, true).rows.length < 2)
          ) {
            const links =
              book.getPDFContentsLinks &&
              (await perform('native_layout', index, () => book.getPDFContentsLinks!(index)));
            if (linkedTable && links === null) break;
            const parsed = z
              .array(outlineEntrySchema)
              .min(linkedTable ? 1 : 3)
              .max(MAX_ENTRIES)
              .safeParse(links);
            if (
              !parsed.success ||
              parsed.data.some((entry) => entry.pageIndex === index || entry.pageIndex >= count)
            )
              return unavailable('pdf_contents_extraction_failed');
            contentsPages.add(index);
            sources.set(index, await sourceEvidence(index));
            rows.push(
              ...parsed.data.map((entry) => ({
                title: entry.title,
                targetPage: entry.pageIndex,
                sourcePage: index,
                scope,
                level: entry.level,
                direct: true,
              })),
            );
            linkedTable = true;
            if (rows.length > MAX_ENTRIES) return unavailable('pdf_contents_entry_limit');
            await saveExtraction(index + 1);
            continue;
          }
          // Independent evidence is for contents extraction only. The durable
          // reading layer, selection offsets and annotations are never replaced.
          if (!isContents(page.text) && isOtherIndex(page.text) && rows.length) break;
          const nativeRows = contentsRows(page.lines, labels, count, true);
          const unparsedNativeRow = page.allLines.some(
            (line) =>
              normalize(line) &&
              !isContentsLine(line) &&
              partRank(line) === undefined &&
              !/^[\d\sivxlcdm.·…_。•⋯∙●‧﹒:：-]+$/i.test(line.trim()) &&
              !contentsRows([line], labels, count, true).rows.length,
          );
          if (
            !page.ocr &&
            (index === scope ||
              isContents(page.text) ||
              isContents(previews.get(index)?.text ?? '') ||
              (contentsPages.has(index - 1) && nativeRows.rows.length >= 2)) &&
            (visualTable ||
              nativeRows.rejected > 0 ||
              unparsedNativeRow ||
              nativeRows.rows.some(
                (row, i, rows) =>
                  i > 0 &&
                  row.system === rows[i - 1]!.system &&
                  row.printed! < rows[i - 1]!.printed!,
              ))
          ) {
            const alternate = await accurateEvidence(index);
            if (alternate && !alternate.native) {
              let table: OCRPage = { ...alternate, alternatives: undefined };
              for (const lines of alternate.alternatives ?? [])
                table = contentsEvidence({ ...alternate, lines, alternatives: undefined }, table);
              page = fromOCR(table);
              visualTable = true;
            }
          }
          if (
            page.ocr &&
            page.layout &&
            (isContents(page.text) || contentsPages.has(index - 1) || (await tableLike(index)))
          ) {
            const alternate = await accurateEvidence(index);
            if (alternate && !alternate.native)
              page = fromOCR(contentsEvidence(page.layout, alternate));
          }
          sources.set(index, await sourceEvidence(index));
          const namedContents =
            isContents(page.text) ||
            (usesGeneral && isGeneralContents(page.text)) ||
            (index === scope &&
              contentsRows(page.allLines, labels, count, true).rows.length >= 2 &&
              page.allLines.filter((line) =>
                /^(?:第.+[章节编部卷篇]|chapter\s+\d+|part\s+)/i.test(line.trim()),
              ).length >= 2);
          const continuation = contentsPages.has(index - 1);
          const geometricRows = printedLines(page.layout);
          const structureLines =
            page.ocr && page.layout ? OCRContentsLayout(page.layout) : await contentsLayout(index);
          const label = geometricRows.find(
            (row) =>
              isContentsLine(row.text) ||
              (row.y < 0.1 && /^目录.{0,3}\d+$/.test(normalize(row.text))),
          );
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
          // On a recognized table, type size cannot decide whether a title
          // exists. Read raw rows before filtering; preserve the table interior
          // and structural parents, while excluding unsupported small footers.
          const rawLines = page.layout
            ? OCRContentsLines(tableLayout ?? page.layout, 'unfiltered')
            : structureLines.map((line) => line.text);
          const filtered = tableLayout ? OCRContentsLines(tableLayout, true) : page.allLines;
          let tableLines = contentsWithoutSynopses(
            contentsLines(withLayoutRows(filtered, rawLines, structureLines, index).join('\n')),
            structureLines,
            count,
            synopsisStyles,
          );
          // Text above an explicit label is front matter, never a contents entry.
          const labelIndex = tableLines.findIndex(
            (line) =>
              isContentsLine(line) ||
              (usesGeneral && isGeneralContents(line)) ||
              (!!label && normalize(line) === normalize(label.text)),
          );
          if (labelIndex >= 0) tableLines = tableLines.slice(labelIndex + 1);
          const { rows: found, rejected } = contentsRows(
            namedContents || continuation ? tableLines : page.lines,
            labels,
            count,
            namedContents || continuation,
          );
          if (
            continuation &&
            !namedContents &&
            !page.lines.length &&
            !printedLines(page.layout).some((line) => line.contents) &&
            !tableLines.some((line) => /[/.·…_。•⋯∙●‧﹒]\s*\d+\s*$/.test(line))
          )
            break;
          // Lists of illustrations/tables are a separate index, not continuation
          // of the chapter contents. Do not turn figure captions into chapters.
          if (!namedContents && isOtherIndex(page.text)) {
            if (rows.length) break;
            else continue;
          }
          const geometricEntries = geometricRows.filter((line) => line.contents).length;
          // A single citation or a paragraph ending with a number does not
          // establish continuation. A real single-row continuation is admissible
          // when the number column or printed leaders are visible.
          if (
            continuation &&
            !namedContents &&
            found.length < 2 &&
            !geometricEntries &&
            !tableLines.some((line) =>
              /(?:[.·…_。•⋯∙●‧﹒]{2,}|\/)\s*(?:\d{1,9}|[ivxlcdm]+)$/i.test(line),
            ) &&
            (geometricRows.filter((line) => line.width >= 0.45).length >= 5 ||
              (!page.layout && page.allLines.filter((line) => line.trim()).length >= 5))
          )
            break;
          const completeRows =
            found.length >= 2 && page.lines.filter((line) => line.trim()).length === found.length;
          // A bad page number cannot silently disappear from a recognized TOC.
          if (rejected && (namedContents || continuation || found.length + rejected >= 4))
            return unavailable('pdf_contents_extraction_failed');
          if (namedContents) contentsPages.add(index);
          if (
            namedContents ||
            (found.length && (continuation || completeRows || found.length >= 4))
          ) {
            contentsPages.add(index);
            for (const line of geometricRows.filter((row) => row.y < 0.1))
              margins.push({ index, line });
            // A named contents page may contain a title whose short page number
            // OCR missed. Keep that title and require an independent destination;
            // silently dropping it would falsely publish a complete chapter list.
            const candidateRows = (input: string[], structureLines: PDFContentsLine[]) => {
              // Some wrapped entries put only their folio on the second baseline.
              // Join it only with geometric evidence in the separate number column.
              const inputLines: string[] = [];
              let orphanedFolio = false;
              // A plate-placement notice is not a destination. Only remove the
              // complete explicit sentence with a page list, not an unresolved
              // heading such as "Illustrations".
              const notice =
                /^(?:illustrations|plates|figures|maps)\s+(?:follow|following|facing|between)\s+pages?\s+[\divxlcdm,\s–—-]+(?:and\s+\d+)?[.]?$/i;
              const sourceLines = input.filter(
                (line, n) =>
                  !notice.test(line.trim()) &&
                  !notice.test(`${line.trim()} ${input[n + 1]?.trim() ?? ''}`) &&
                  !notice.test(`${input[n - 1]?.trim() ?? ''} ${line.trim()}`),
              );
              for (const line of sourceLines) {
                const last = inputLines.at(-1);
                const above = last && rowLayout(last, structureLines, index);
                const folio =
                  /^\d{1,4}$/.test(line.trim()) && rowLayout(line, structureLines, index);
                if (
                  last &&
                  above &&
                  folio &&
                  !contentsRows([last], labels, count, true).rows.length &&
                  (folio.x > above.x + above.width * 0.7 ||
                    (Math.abs(folio.x + folio.width / 2 - above.x - above.width / 2) <=
                      above.height &&
                      Math.abs(folio.x + folio.width / 2 - 0.5) <= 0.08)) &&
                  folio.y >= above.y &&
                  folio.y - above.y - above.height <= above.height * 1.5
                ) {
                  inputLines[inputLines.length - 1] = `${last} .... ${line.trim()}`;
                } else {
                  if (folio && folio.x >= 0.65) orphanedFolio = true;
                  inputLines.push(line);
                }
              }
              if (orphanedFolio) return undefined;
              const candidates =
                namedContents || continuation
                  ? inputLines.flatMap((line) => {
                      const title = normalize(line);
                      if (
                        !title ||
                        isContentsLine(line) ||
                        /^[\d ivxlcdm.·…_。•⋯∙●‧﹒:：]+$/i.test(line.trim()) ||
                        !/\p{L}/u.test(line)
                      )
                        return [];
                      const known = contentsRows([line], labels, count, true).rows[0];
                      const layout = rowLayout(line, structureLines, index);
                      const last =
                        layout &&
                        geometricRows
                          .find((candidate) => candidate.text === layout.text)
                          ?.words.at(-1);
                      const folioColumn =
                        last &&
                        geometricRows.some((candidate) => {
                          const folio = candidate.words.at(-1);
                          return (
                            candidate.contents &&
                            folio &&
                            Math.abs(folio.x + folio.width - last.x - last.width) <= last.height * 2
                          );
                        });
                      const missingFolio =
                        folioColumn &&
                        last &&
                        /^[a-z]$/i.test(last.text.trim()) &&
                        /[.·…_。•⋯∙●‧﹒,，]\s+[a-z]$/i.test(line);
                      const withoutFolio = missingFolio ? line.replace(/\s+[a-z]$/i, '') : line;
                      const titleWithoutLeader = withoutFolio.replace(/[.·…_。•⋯∙●‧﹒,，\s]+$/, '');
                      return [
                        known ?? {
                          title: titleWithoutLeader || line.trim(),
                          targetPage: null,
                          level: 0,
                        },
                      ];
                    })
                  : contentsRows(inputLines, labels, count, true).rows;
              const joined: Row[] = [];
              for (const row of candidates) {
                const previous = joined.at(-1);
                const previousLayout =
                  previous && rowLayout(previous.title, structureLines, index, previous.printed);
                const currentLayout = rowLayout(row.title, structureLines, index, row.printed);
                const wrapped =
                  previousLayout &&
                  currentLayout &&
                  currentLayout.y >= previousLayout.y + previousLayout.height * 0.65 &&
                  currentLayout.y - previousLayout.y - previousLayout.height <=
                    previousLayout.height * 0.8;
                const group = previous && partRank(previous.title) !== undefined;
                const ordinalOnly =
                  previous &&
                  /^(?:part\s+[ivxlcdm\d]+|第[\d一二三四五六七八九十百零〇]+(?:部分|[部卷辑篇编])|[部卷辑篇编][\d一二三四五六七八九十百零〇]+)$/i.test(
                    previous.title.trim(),
                  );
                const wrappedTitle =
                  wrapped &&
                  previous &&
                  !standaloneMatter(previous.title) &&
                  !/^(?:第[\d一二三四五六七八九十百零〇]+[章节部篇]|[一二三四五六七八九十百]+[、,\s]|\d+[.、\s])/.test(
                    row.title,
                  ) &&
                  partRank(row.title) === undefined &&
                  !standaloneMatter(row.title);
                if (
                  previous &&
                  coordinate(previous) === null &&
                  (!group ||
                    (ordinalOnly &&
                      wrapped &&
                      partRank(row.title) === undefined &&
                      !/^(?:第.+[章节]|chapter\s)/i.test(row.title))) &&
                  (/^(?:part|chapter)\s+[ivxlcdm\d]+$/i.test(previous.title) ||
                    (/^第[\d一二三四五六七八九十百零〇]+[章节部篇]/.test(previous.title) &&
                      !/^(?:第[\d一二三四五六七八九十百零〇]+[章节部篇]|[一二三四五六七八九十百]+[、\s]|\d+[.、\s])/.test(
                        row.title,
                      )) ||
                    /^\p{Ll}/u.test(row.title) ||
                    wrappedTitle)
                ) {
                  joined.pop();
                  joined.push({ ...row, title: `${previous.title} ${row.title}` });
                } else joined.push(row);
              }
              return joined;
            };
            const joined = candidateRows(tableLines, structureLines);
            if (!joined) return unavailable('pdf_contents_extraction_failed');
            const alternate = evidencePages.get(index);
            if (alternate && !alternate.native) {
              const passes = [alternate.lines, ...(alternate.alternatives ?? [])].map((lines) => ({
                ...alternate,
                lines,
                alternatives: undefined,
              }));
              // A separate crop supplies independent readings of long wrapped
              // titles; its boxes still map to the same source row and folio.
              if (
                joined.some((row) => {
                  const box = rowLayout(row.title, structureLines, index, row.printed);
                  return (
                    box &&
                    normalize(row.title).length >= 24 &&
                    !normalize(box.text).startsWith(normalize(row.title))
                  );
                })
              ) {
                const crop = await croppedEvidence(index);
                if (!crop.native)
                  for (const lines of [crop.lines, ...(crop.alternatives ?? [])])
                    passes.push({ ...crop, lines, alternatives: undefined });
              }
              for (const scan of passes) {
                const layout = OCRContentsLayout(scan);
                const alternatives =
                  candidateRows(
                    contentsWithoutSynopses(
                      OCRContentsLines(scan, true),
                      layout,
                      count,
                      synopsisStyles,
                    ),
                    layout,
                  ) ?? [];
                for (const row of joined) {
                  const primary = rowLayout(row.title, structureLines, index, row.printed);
                  if (!primary) continue;
                  for (const other of alternatives) {
                    if (
                      coordinate(other) !== coordinate(row) ||
                      normalize(other.title) === normalize(row.title)
                    )
                      continue;
                    const box = rowLayout(other.title, layout, index, other.printed);
                    if (
                      !box ||
                      Math.abs(primary.y - box.y) > Math.max(primary.height, box.height) * 0.5
                    )
                      continue;
                    row.alternatives = [
                      ...new Set([...(row.alternatives ?? []), other.title]),
                    ].slice(0, 2);
                  }
                }
              }
            }
            sources.set(index, await sourceEvidence(index));
            for (const row of joined) {
              row.sourcePage = index;
              row.scope = scope;
              const structure = rowLayout(row.title, structureLines, index, row.printed);
              if (structure) layouts.set(row, structure);
              const existing = rows.find(
                (existing) =>
                  existing.scope === row.scope &&
                  coordinate(existing) === coordinate(row) &&
                  normalize(existing.title) === normalize(row.title),
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
          await saveExtraction(index + 1);
        }
        if (rows.length === scopeStart && !extraction)
          return unavailable('pdf_contents_scope_unresolved');
      }
      // Continuation pages can have no Contents label. Repeated marginal titles
      // with changing folios provide independent header evidence; interior titles
      // and unmatched marginal rows remain subject to destination verification.
      for (const [index, page] of pages) {
        if (!contentsPages.has(index))
          for (const line of printedLines(page.layout).filter((row) => row.y < 0.1))
            margins.push({ index, line });
      }
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!;
        const origin = marginalRows.get(row);
        if (
          origin &&
          margins.some(
            (other) =>
              other.index !== origin.index &&
              [row.title, ...(row.alternatives ?? [])].some((text) =>
                sameFolioHeader({ ...origin.line, text }, other.line),
              ),
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
      for (const index of discovery.general) {
        contentsPages.add(index);
        sources.set(index, await sourceEvidence(index));
      }
      let scopeReceipt: z.infer<typeof planSchema>['scopeReceipt'] = {
        kind: 'local-tables',
        excluded: [],
      };
      if (usesGeneral) {
        // Only an explicit volume identity on a cover/title leaf can authorize
        // excluding another volume. Missing target headings never classify scope.
        const identities: { volume: number; page: number }[] = [];
        for (let index = 0; index < Math.min(discovered ?? 0, 8); index++) {
          let page = await read(index);
          const preview = page.text || (await detect(index, index + 1));
          if (
            !contentsLines(preview).some((line) =>
              /^第[\d一二三四五六七八九十百零〇]+卷$/.test(normalize(line)),
            )
          )
            continue;
          await recognize([index]);
          page = await read(index);
          for (const line of page.allLines) {
            if (!/^第[\d一二三四五六七八九十百零〇]+卷$/.test(normalize(line))) continue;
            const number = partNumber(line);
            if (number?.kind === '卷') identities.push({ volume: number.ordinal, page: index });
          }
        }
        const volume = identities[0];
        if (!volume || identities.some((identity) => identity.volume !== volume.volume))
          return unavailable('pdf_contents_scope_unresolved');
        let current: number | undefined;
        const selected: Row[] = [];
        const excluded: NonNullable<typeof scopeReceipt>['excluded'] = [];
        let matched = 0;
        for (const row of rows) {
          const part = partNumber(row.title);
          if (part?.kind === '卷') {
            current = part.ordinal;
            if (current === volume.volume) matched++;
            excluded.push({ title: row.title, sourcePage: row.sourcePage, reason: 'volume-label' });
          } else if (current === undefined) return unavailable('pdf_contents_scope_unresolved');
          else if (current === volume.volume) selected.push(row);
          else
            excluded.push({ title: row.title, sourcePage: row.sourcePage, reason: 'other-volume' });
        }
        if (matched !== 1 || selected.length < 2)
          return unavailable('pdf_contents_scope_unresolved');
        rows.splice(0, rows.length, ...selected);
        sources.set(volume.page, await sourceEvidence(volume.page));
        scopeReceipt = {
          kind: 'explicit-volume',
          volume: volume.volume,
          evidencePage: volume.page,
          excluded,
        };
      }
      restoreHierarchy(rows, layouts);
      const structure = structureInventory(rows);
      if (!completeStructure(rows, structure))
        return unavailable('pdf_contents_structure_incomplete');
      if (rows.length >= 2 && labelsHash) {
        scan = undefined;
        plan = {
          extractor: EXTRACTOR,
          revision: cache.revision,
          regenerate,
          labels: labelsHash,
          rows,
          contentsPages: [...contentsPages],
          sources: [...sources].map(([index, evidence]) => ({ index, evidence })),
          completed: [],
          structure,
          scopeReceipt,
          offsets: [],
        };
      }
    }
    if (rows.length >= 2) {
      progress.totalCount = rows.length;
      await phase('verification');
      // Numbering systems and restarts have independent offsets. A physical
      // page-label match is only a proposal; every destination uses verify().
      let group = 0;
      let previousNumbered: Row | undefined;
      const groups = rows.map((row, index) => {
        if (index > 0 && row.scope !== rows[index - 1]!.scope) {
          group++;
          previousNumbered = undefined;
        }
        if (!row.direct && row.printed !== undefined) {
          if (
            previousNumbered &&
            (row.system !== previousNumbered.system ||
              (partRank(row.title) !== undefined && row.printed === previousNumbered.printed) ||
              /^(?:致谢|序|前言|preface|foreword|acknowledg)/i.test(normalize(row.title)) ||
              /^(?:致谢|序|前言|preface|foreword|acknowledg)/i.test(
                normalize(previousNumbered.title),
              ) ||
              row.printed < previousNumbered.printed!)
          )
            group++;
          previousNumbered = row;
        }
        return group;
      });
      const foliation = rows.map((row, index) =>
        !row.direct && row.printed !== undefined
          ? { printed: row.printed, group: groups[index]!, scope: row.scope }
          : undefined,
      );
      const offsets = new Map<number, number>(plan?.offsets ?? []);
      const titles = (row: Row) => [row.title, ...(row.alternatives ?? [])];
      const verifyRow = async (index: number, row: Row) => {
        if (index < 0 || index >= count) return undefined;
        if (row.alternatives?.length) {
          // Prefer a complete single-pass source reading to a composite row.
          // A disagreement must use independent target pixels: the embedded
          // OCR can repeat exactly the same error as the printed table.
          const target = await accurateEvidence(index);
          if (!target || target.native) return undefined;
          for (const title of [...row.alternatives, row.title]) {
            for (const lines of [target.lines, ...(target.alternatives ?? [])]) {
              const page = fromOCR({ ...target, lines, alternatives: undefined });
              if (!isChapterIndex(page.allLines) && matchesHeading(page.text, title, true)) {
                pages.set(index, page);
                if (await verify(index, title))
                  return verifiedDisplayTitle(title, pages.get(index)?.allLines ?? []);
              }
            }
          }
          return undefined;
        }
        for (const title of titles(row))
          if (await verify(index, title))
            return verifiedDisplayTitle(title, pages.get(index)?.allLines ?? []);
        return undefined;
      };
      // Each page is read once per search phase. Persist only nominations,
      // never the full book text. Every nominated destination is reverified.
      const search = plan?.search ?? {
        nativeNext: 0,
        coarseNext: 0,
        candidates: rows.map(() => [] as { index: number; exact: boolean; prominent: boolean }[]),
      };
      if (search.candidates.length !== rows.length)
        return unavailable('pdf_contents_structure_incomplete');
      if (plan) plan.search = search;
      const nominate = (
        index: number,
        text: string,
        page: Awaited<ReturnType<typeof read>>,
        coarse: boolean,
      ) => {
        rows.forEach((row, r) => {
          if (row.direct) return;
          const exact = titles(row).some((title) =>
            matchesHeading(text, title, page.ocr || coarse),
          );
          const prominent = page.prominent.some((heading) =>
            titles(row).some((title) => matchesHeading(heading, title)),
          );
          if (!exact && !titles(row).some((title) => nearHeading(text, title))) return;
          const values = search.candidates[r]!;
          const existing = values.find((value) => value.index === index);
          if (existing) {
            existing.exact ||= exact;
            existing.prominent ||= prominent;
          } else values.push({ index, exact, prominent });
          if (values.length > 128) throw new Error('pdf_contents_candidate_limit');
        });
      };
      for (let index = search.nativeNext; index < count; index++) {
        if (!contentsPages.has(index)) {
          const page = await read(index);
          if (canDetectFromText(page)) nominate(index, page.text, page, false);
        }
        search.nativeNext = index + 1;
        if (index % 16 === 15) await report('running');
      }
      const searchCoarse = async () => {
        for (let index = search.coarseNext; index < count; index++) {
          if (!contentsPages.has(index)) {
            const page = await read(index);
            nominate(index, canDetectFromText(page) ? page.text : await detect(index), page, true);
          }
          search.coarseNext = index + 1;
          if (index % 16 === 15) await report('running');
        }
      };
      for (const g of new Set(groups)) {
        const votes = new Map<number, Set<number>>();
        rows.forEach((row, r) => {
          if (groups[r] !== g || coordinate(row) === null) return;
          for (const { index, exact } of search.candidates[r]!) {
            if (!exact) continue;
            const offset = index - coordinate(row)!;
            if (!votes.has(offset)) votes.set(offset, new Set());
            votes.get(offset)!.add(index);
          }
        });
        const ranked = [...votes].sort((a, b) => b[1].size - a[1].size);
        if (
          !offsets.has(g) &&
          ranked[0] &&
          ranked[0][1].size >= 2 &&
          ranked[0][1].size !== ranked[1]?.[1].size
        )
          offsets.set(g, ranked[0][0]);
      }
      const entries: PDFOutlineEntry[] = [];
      const previousTargets = plan?.targets ?? plan?.completed.map((entry) => [entry]) ?? [];
      const targets: PDFOutlineEntry[][] = [];
      const targetIssues: NonNullable<z.infer<typeof planSchema>['targetIssues']> = [];
      const folios = (page: OCRPage | null) =>
        printedLines(page).flatMap((line) => {
          if (line.y >= 0.1 && line.y < 0.9) return [];
          const value = printedFolio(line.text);
          return value && value > 0 ? [value] : [];
        });
      const proveFolios = async (target: number, printedPage: number) => {
        let anchors = 0;
        const missing: [number, number][] = [];
        for (const delta of [0, 1, 2, -1, -2]) {
          const index = target + delta;
          const printed = printedPage + delta;
          if (index < 0 || index >= count || printed <= 0 || contentsPages.has(index)) continue;
          // Physical neighbours already bound this search to five pages. A
          // coarse folio typo must not veto their independent precise reading.
          await recognize([index]);
          if (folios((await read(index)).layout).includes(printed)) anchors++;
          else missing.push([index, printed]);
          if (anchors === 2) return true;
        }
        if (anchors === 1 && missing.length) {
          const [index, printed] = missing[0]!;
          const strips: readonly PDFOCRRegion[] = [
            [0, 0, 1000, 115],
            [0, 885, 1000, 115],
          ];
          const crops = await croppedEvidenceBatch(index, strips);
          return crops.some((crop) =>
            [crop.lines, ...(crop.alternatives ?? [])].some((lines) =>
              folios({ ...crop, lines }).includes(printed),
            ),
          );
        }
        return false;
      };
      const localTarget = async (row: Row, r: number) => {
        if (!contentsPages.size) return [];
        const first = Math.max(0, Math.min(...contentsPages) - 12);
        const last = Math.min(count - 1, Math.max(...contentsPages) + 12);
        const nearby = new Set(Array.from({ length: last - first + 1 }, (_, n) => first + n));
        const nextRow = rows[r + 1];
        const nextGroup = groups[r + 1];
        if (
          coordinate(nextRow) !== null &&
          coordinate(nextRow) !== undefined &&
          nextGroup !== undefined &&
          coordinate(row) === null &&
          partRank(row.title) !== undefined
        ) {
          // The table boundary can nominate a body offset before a numbered
          // heading is verified. The part and the following folios still have
          // to prove the mapping independently.
          const nomination =
            coordinate(nextRow)! + (offsets.get(nextGroup) ?? Math.max(...contentsPages) + 1);
          const radius = offsets.has(nextGroup) ? 8 : 12;
          for (
            let i = Math.max(0, nomination - radius);
            i <= Math.min(count - 1, nomination + 2);
            i++
          )
            nearby.add(i);
        }
        const confirmed: { index: number; title: string; mapping?: [number, number] }[] = [];
        for (const i of [...nearby].sort((a, b) => a - b)) {
          if (contentsPages.has(i)) continue;
          let end = i + 1;
          while (nearby.has(end)) end++;
          const preview = await detect(i, end);
          if (
            !titles(row).some(
              (title) => matchesHeading(preview, title, true) || nearHeading(preview, title),
            )
          )
            continue;
          const title = await verifyRow(i, row);
          if (!title) continue;
          const page = await read(i);
          if (!prominentMatch(page, title)) continue;
          // Two nearby precise marginal folios establish an independent physical
          // mapping even when a title page omits its own printed number. Coarse
          // text only nominates these pages; it never supplies final evidence.
          if (coordinate(row) === null && standaloneMatter(row.title))
            confirmed.push({ index: i, title });
          else if (row.printed && (await proveFolios(i, row.printed)))
            confirmed.push({ index: i, title });
          else if (!row.printed) {
            // An unnumbered part page can borrow mapping evidence from the next
            // printed entry, provided its own title is independently verified.
            const next = rows[r + 1];
            if (!next?.printed || coordinate(next) === null) continue;
            const following: number[] = [];
            for (let j = i + 1; j <= Math.min(count - 1, i + 8); j++) {
              if (contentsPages.has(j)) continue;
              const preview = await detect(j, Math.min(count, i + 9));
              if (
                !titles(next).some(
                  (title) => matchesHeading(preview, title, true) || nearHeading(preview, title),
                )
              )
                continue;
              const nextTitle = await verifyRow(j, next);
              if (!nextTitle) continue;
              if (!(await read(j)).prominent.some((title) => matchesHeading(title, nextTitle)))
                continue;
              if (await proveFolios(j, next.printed)) following.push(j);
            }
            if (following.length === 1)
              confirmed.push({
                index: i,
                title,
                mapping: [groups[r + 1]!, following[0]! - coordinate(next)!],
              });
          }
        }
        return confirmed;
      };
      for (const [r, row] of rows.entries()) {
        const g = groups[r]!;
        // Once calibrated, batch only destinations already nominated by coarse
        // headings at that offset. This amortizes native worker startup without
        // treating previews as evidence or spending OCR on untested guesses.
        if (offsets.has(g)) {
          const offset = offsets.get(g)!;
          const nominated = rows.slice(r, r + 8).flatMap((candidate, j) => {
            if (groups[r + j] !== g || coordinate(candidate) === null) return [];
            const index = coordinate(candidate)! + offset;
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
        const candidates = new Map<number, PDFOutlineEntry>();
        const accept = (index: number, title: string) =>
          candidates.set(index, { title, pageIndex: index, level: row.level });
        for (const previous of previousTargets[r] ?? []) {
          if (titles(row).includes(previous.title) && !contentsPages.has(previous.pageIndex)) {
            const title = await verifyRow(previous.pageIndex, row);
            if (title) accept(previous.pageIndex, title);
          }
        }
        if (row.targetPage !== null && !contentsPages.has(row.targetPage)) {
          const title = await verifyRow(row.targetPage, row);
          if (title) accept(row.targetPage, title);
        }
        if (coordinate(row) !== null) {
          // A structural boundary (for example an appendix) can start a new
          // alignment segment without restarting its printed pagination.
          // Try the previous segment's offset as a nomination in that case.
          const preceding = rows.slice(0, r).findLast((entry) => entry.printed !== undefined);
          const inherited =
            preceding?.system === row.system &&
            preceding?.printed !== undefined &&
            row.printed !== undefined &&
            preceding.printed <= row.printed
              ? offsets.get(g - 1)
              : undefined;
          const mapped = coordinate(row)! + (row.direct ? 0 : (offsets.get(g) ?? inherited ?? 0));
          const mappedTitle = !contentsPages.has(mapped) && (await verifyRow(mapped, row));
          if (mappedTitle) accept(mapped, mappedTitle);
          else if (
            !candidates.size &&
            !offsets.has(g) &&
            mapped !== coordinate(row) &&
            !contentsPages.has(coordinate(row)!)
          ) {
            const labelTitle = await verifyRow(coordinate(row)!, row);
            if (labelTitle) accept(coordinate(row)!, labelTitle);
          }
        }
        if (!candidates.size && (!offsets.has(g) || coordinate(row) === null)) {
          const local = await localTarget(row, r);
          if (local.length === 1 && local[0]!.mapping) offsets.set(...local[0]!.mapping);
          for (const target of local) accept(target.index, target.title);
        }
        if (!candidates.size && !row.direct) {
          const tryNominations = async () => {
            for (const { index } of search.candidates[r]!) {
              if (contentsPages.has(index) || candidates.has(index)) continue;
              const title = await verifyRow(index, row);
              if (!title) continue;
              const page = await read(index);
              if ((!page.ocr && !page.layout) || prominentMatch(page, title)) accept(index, title);
            }
          };
          await tryNominations();
          if (!candidates.size && search.coarseNext < count) {
            await searchCoarse();
            await tryNominations();
          }
        }
        for (const { index, prominent } of search.candidates[r]!) {
          if (!prominent || contentsPages.has(index) || candidates.has(index)) continue;
          const title = await verifyRow(index, row);
          if (title) accept(index, title);
        }
        if (candidates.size > 16) return unavailable('pdf_contents_heading_ambiguous');
        targets.push([...candidates.values()]);
        if (candidates.size !== 1)
          targetIssues.push({
            row: r,
            reason: candidates.size === 0 ? 'heading_unverified' : 'multiple_targets',
          });
        if (candidates.size === 1 && coordinate(row) !== null && !row.direct) {
          offsets.set(g, candidates.keys().next().value! - coordinate(row)!);
        }
        progress.verifiedCount = targets.filter((values) => values.length === 1).length;
        if (plan) {
          plan.targets = [...targets, ...previousTargets.slice(targets.length)];
          plan.targetIssues = [
            ...targetIssues,
            ...(plan.targetIssues ?? []).filter((issue) => issue.row > r),
          ];
          const firstUnresolved = targets.findIndex((values) => values.length !== 1);
          plan.completed = (firstUnresolved < 0 ? targets : targets.slice(0, firstUnresolved)).map(
            (values) => values[0]!,
          );
          plan.offsets = [...offsets];
        }
        verificationCursor++;
        await report('running');
        check();
      }
      // A later verified heading may reveal a second offset after inserted
      // pages. Propagate every supported offset back to all numbered rows in
      // that run. A coarse match only nominates another independent check.
      const segmentOffsets = new Map<number, Set<number>>();
      const rememberOffsets = (index: number) => {
        const folio = foliation[index];
        if (!folio) return;
        const supported = segmentOffsets.get(folio.group) ?? new Set<number>();
        for (const entry of targets[index]!) supported.add(entry.pageIndex - folio.printed);
        segmentOffsets.set(folio.group, supported);
      };
      targets.forEach((_, index) => rememberOffsets(index));
      for (const [index, row] of rows.entries()) {
        const folio = foliation[index];
        if (!folio) continue;
        const supported = segmentOffsets.get(folio.group);
        if (!supported || supported.size < 2) continue;
        const choices = targets[index]!;
        for (const offset of supported) {
          const pageIndex = folio.printed + offset;
          if (
            pageIndex < 0 ||
            pageIndex >= count ||
            contentsPages.has(pageIndex) ||
            choices.some((entry) => entry.pageIndex === pageIndex)
          )
            continue;
          const preview = await detect(pageIndex, pageIndex + 1);
          if (
            !titles(row).some(
              (title) => matchesHeading(preview, title, true) || nearHeading(preview, title),
            )
          )
            continue;
          const title = await verifyRow(pageIndex, row);
          if (!title) continue;
          choices.push({ title, pageIndex, level: row.level });
          if (choices.length > 16) return unavailable('pdf_contents_heading_ambiguous');
          verificationCursor++;
          await report('running');
          check();
        }
      }
      if (targets.some((choices) => choices.length === 0))
        return unavailable('pdf_contents_heading_unverified');
      const alignment = alignContentsTargets(targets, foliation);
      if (alignment === 'none') return unavailable('pdf_contents_order');
      if (alignment === 'ambiguous') return unavailable('pdf_contents_heading_ambiguous');
      entries.push(...alignment);
      progress.verifiedCount = entries.length;
      if (!completeStructure(entries, plan?.structure))
        return unavailable('pdf_contents_structure_incomplete');
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
      if (isChapterIndex(text.split('\n'))) continue;
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
    if (headings.length < 2 || headings.length > MAX_ENTRIES)
      return unavailable('pdf_contents_not_found');
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
    controller.signal.removeEventListener('abort', invalidateSession);
    await releasePDFSourceSession(openedCache).catch(() => {});
  }
}
