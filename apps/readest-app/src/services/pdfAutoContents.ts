import { z } from 'zod';
import type { BookDoc, TOCItem, PDFContentsLine } from '@/libs/document';
import { createDerivedStore, hashData } from '@/glossa/harness/derivedStore';
import {
  OCRContentsLines,
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
} from './pdfEnhancement';
import { recognizePDFPages } from './pdfOCR';
import { classifyFailure } from './pdfContentsDiagnostics';
import { initSimpleCC, runSimpleCC } from '@/utils/simplecc';

const MAX_OCR_PAGES = 96;
const MAX_ENTRIES = 128;
const GENERATOR = 'glossa-contents-3';
const EXTRACTOR = 'pdf-contents-12';
const rowSchema = z.object({
  title: z.string().min(1).max(500),
  base: z.number().int().min(0).max(999).nullable(),
  level: z.number().int().min(0).max(5),
  system: z.enum(['roman', 'arabic']).optional(),
  printed: z.number().int().positive().max(10000).optional(),
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
  ]),
  revision: z.number().int().nonnegative(),
  regenerate: z.boolean(),
  labels: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(rowSchema).min(2).max(MAX_ENTRIES),
  contentsPages: z.array(z.number().int().min(0).max(999)).max(1000),
  sources: z
    .array(
      z.object({
        index: z.number().int().min(0).max(999),
        evidence: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(1000),
  completed: z.array(outlineEntrySchema).max(MAX_ENTRIES),
  // Full source inventory before target verification. Resuming must not allow
  // a missing parent or altered ownership to pass as a smaller complete TOC.
  structure: z
    .array(
      z.object({
        title: z.string().min(1).max(500),
        level: z.number().int().min(0).max(5),
        parent: z.number().int().min(0).max(MAX_ENTRIES).nullable(),
      }),
    )
    .max(MAX_ENTRIES)
    .optional(),
  offsets: z
    .array(z.tuple([z.number().int().min(0).max(MAX_ENTRIES), z.number().int().min(-999).max(999)]))
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
  failureCategory: z.string().max(40).optional(),
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
  plan: planSchema.optional(),
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
  entryBytes: 320000,
  entries: 16,
  totalBytes: 2000000,
});
let variantsReady = false;
const normalize = (text: string) =>
  (variantsReady ? runSimpleCC(text.replace(/衞/g, '衛'), 't2s') : text.replace(/衞/g, '衛'))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}\p{Cc}]/gu, '');
const isContentsLine = (text: string) =>
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
  /^(?:(?:\d+|[ivxlcdm]+)\s+)?(?:插[图圖]目[录錄]|[图圖表]目[录錄]|(?:list\s+of\s+)?(?:illustrations|figures|tables|maps|plates))(?:\s+(?:\d+|[ivxlcdm]+))?$/i.test(
    text
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? '',
  );
// Group headings remain destinations even when the printed table omits a folio.
const partRank = (text: string): number | undefined => {
  const chinese = normalize(text).match(
    /^(?:第[一二三四五六七八九十百零〇\d]+(部分|部|卷|辑|篇)|(辑|部|卷|篇)[一二三四五六七八九十百零〇\d]+)/,
  );
  const unit = chinese?.[1] ?? chinese?.[2];
  if (unit) return unit === '篇' ? 2 : unit === '辑' ? 1 : 0;
  if (/^part\s+(?:[ivxlcdm]+|\d+)(?:\s|$|[:：.])/i.test(text.trim())) return 0;
  return undefined;
};
const standaloneMatter = (text: string) =>
  /^(?:序(?:言|章)?|前言|引言|绪论|后记|後記|跋|附[录錄]\s*[\d一二三四五六七八九十]*|参考文献|參考文獻|致谢|致謝|索引|preface|foreword|introduction|afterword|epilogue|appendix|references|acknowledgements?)(?:$|[\s:：·・、—-])/i.test(
    text.trim(),
  );
const validTitle = (text: string) => text.length >= 2 || /^\p{Script=Han}$/u.test(text);
// Cost nomination only: acceptance still needs a complete precise heading.
const nearHeading = (text: string, title: string) => {
  const expected = bareTitle(title);
  if (expected.length < 6 || expected.length > 96) return false;
  return text
    .split('\n')
    .slice(0, 10)
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
  const match = text.trim().match(/^(\d{1,4}|[ivxlcdm]+)(?:\s|$)|(?:^|\s)(\d{1,4}|[ivxlcdm]+)$/i);
  const token = match?.[1] ?? match?.[2];
  return token ? (/^\d+$/.test(token) ? Number(token) : romanNumber(token)) : undefined;
};
type Row = z.infer<typeof rowSchema>;
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
    if (!normalize(line.text).startsWith(key)) return false;
    if (!printed) return true;
    const folio = line.text.trim().match(/(\d{1,4}|[ivxlcdm]+)$/i)?.[1];
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
  const parents: { rank: number; level: number; layout?: RowLayout }[] = [];
  rows.forEach((row, index) => {
    if (row.direct) return;
    const layout = layouts.get(row);
    const next = layouts.get(rows[index + 1]!);
    const matter = standaloneMatter(row.title);
    let rank = partRank(row.title);
    if (rank === undefined && !matter && layout && groupLayout(layout, next)) {
      const owner = parents.at(-1);
      const sibling =
        owner?.layout &&
        isPDFSizeAtLeast(layout.height * 0.8, Math.abs(owner.layout.x - layout.x)) &&
        isPDFSizeAtLeast(layout.height * 0.2, Math.abs(owner.layout.height - layout.height));
      rank = sibling ? owner!.rank : owner ? owner.rank + 1 : 0;
    }
    if (rank !== undefined) {
      while (parents.length && parents.at(-1)!.rank >= rank) parents.pop();
      row.level = parents.length ? parents.at(-1)!.level + 1 : 0;
      parents.push({ rank, level: row.level, layout });
      return;
    }
    const owner = parents.at(-1);
    const visiblyInside =
      layout &&
      owner?.layout &&
      (isPDFSizeAtLeast(layout.x - owner.layout.x, layout.height * 0.8) ||
        !isPDFSizeAtLeast(layout.height, owner.layout.height * 0.9));
    if (matter && !visiblyInside) parents.length = 0;
    row.level += parents.length ? parents.at(-1)!.level + 1 : 0;
  });
}

function structureInventory(rows: { title: string; level: number }[]) {
  const ancestors: number[] = [];
  return rows.map((row, index) => {
    while (ancestors.length && rows[ancestors.at(-1)!]!.level >= row.level) ancestors.pop();
    const parent = ancestors.at(-1) ?? null;
    ancestors.push(index);
    return { title: row.title, level: row.level, parent };
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
    /^(?:第([一二三四五六七八九十百零〇\d]+)(部分|部|卷|辑|篇)|([辑部卷篇])([一二三四五六七八九十百零〇\d]+))/,
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
      normalize(row.title) !== normalize(source.title) ||
      row.level !== source.level ||
      row.parent !== source.parent ||
      row.level !== (row.parent === null ? 0 : actual[row.parent]!.level + 1)
    )
      return false;
    const part = partNumber(row.title);
    if (part) {
      const key = `${row.parent}:${part.kind}`;
      const previous = sequence.get(key);
      if (part.ordinal !== (previous ?? 0) + 1) return false;
      sequence.set(key, part.ordinal);
    }
    return true;
  });
}

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
  const retained = printedLines(primary).filter((row) => {
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
    // Compare the complete alternate row's envelope, including the number
    // column. Fragment-to-fragment width ratios retain overlapping readings
    // when one pass splits a title and folio differently, creating fake text.
    const left = Math.min(...aligned.map((other) => other.x));
    const right = Math.max(...aligned.map((other) => other.x + other.width));
    const covered = Math.min(row.x + row.width, right) - Math.max(row.x, left);
    return covered < row.width * 0.8;
  });
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
    .filter((row) => {
      const below = rows.filter((other) => other.top > row.bottom);
      const height = row.bottom - row.top;
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
        (row.top >= 0.1 || largeNumbered) &&
        row.top <= 0.5 &&
        below.every((other) => other.top - row.bottom >= height * 2)
      );
    })
    .map((row) => row.text);
}

function contentsRows(lines: string[], labels: string[], count: number, confirmed = false) {
  const rows: Row[] = [];
  let rejected = 0;
  for (const line of lines) {
    if (isContentsLine(line) || /^(?:part|chapter)\s+[ivxlcdm\d]+$/i.test(line.trim())) continue;
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
  options: { regenerate?: boolean; owner?: import('./pdfEnhancement').PDFCacheOwner } = {},
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
  options: { regenerate?: boolean; owner?: import('./pdfEnhancement').PDFCacheOwner } = {},
): Promise<'preserved' | 'generated' | 'unavailable'> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let expired = false;
  const startedAt = performance.now();
  const progress = { verifiedCount: 0, totalCount: 0, resumed: false };
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
      elapsedMs: Math.round(performance.now() - startedAt),
      ...progress,
      ...(state !== 'running' && state !== 'completed'
        ? { failureCategory: classifyFailure({ code, stage }) }
        : {}),
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
  let openedCache: Awaited<ReturnType<typeof openPDFCache>> = null;
  try {
    await report('running');
    check();
    const cache = await bounded(openPDFCache(source, true, options.owner, true));
    openedCache = cache;
    check();
    if (!cache || !book.getPDFText) return unavailable('pdf_contents_unavailable');
    // A user's saved outline always wins, including a deliberately empty one.
    if (!cache.generator && (cache.outline !== null || cache.revision > 0))
      return complete('preserved');
    const regenerate = !!options.regenerate && !!cache.generator;
    if (!regenerate && cache.generator === GENERATOR && cache.outline?.length)
      return complete('preserved');
    const count = book.sections.length;
    if (count < 2 || count > 1000) return unavailable('pdf_contents_page_limit');
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
    const checks = checksKey ? await bounded(checksStore.load(checksKey)).catch(() => null) : null;
    check();
    const verified = checks?.entries ?? [];
    let plan: z.infer<typeof planSchema> | undefined;
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
      );
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
          recognizeNative(source, cache.id, [index], controller.signal, undefined, false, true),
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
    // Local crops are a separate versioned sidecar. Each scale is independent
    // evidence; never concatenate contradictory passes or replace reading CFIs.
    const headingPages = new Map<number, OCRPage>();
    const croppedEvidence = async (index: number) => {
      if (headingPages.has(index)) return headingPages.get(index)!;
      let page = await perform('cache_read', index, () =>
        readOCRPage(cache.id, index, false, false, true),
      );
      if (!page) {
        if (++ocrCount > MAX_OCR_PAGES) throw new Error('pdf_contents_ocr_limit');
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
          ),
        );
        check();
        if (done.state !== 'completed') throw new Error(done.error ?? 'pdf_recognition_failed');
        await phase(previousStage);
        page = await perform('cache_read', index, () =>
          readOCRPage(cache.id, index, false, false, true),
        );
        if (!page) throw new Error('pdf_recognition_failed');
      }
      characters += [page.lines, ...(page.alternatives ?? [])]
        .flat()
        .reduce((n, word) => n + word.text.length, 0);
      if (characters > 2_000_000) throw new Error('pdf_contents_text_limit');
      headingPages.set(index, page);
      return page;
    };
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
      if (isChapterIndex(page.allLines)) return false;
      if (!matchesHeading(page.text, title, page.ocr) && page.ocr && page.text.trim()) {
        const alternate = await accurateEvidence(index);
        if (alternate && matchesHeading(OCRPageText(alternate), title, true)) {
          page = fromOCR(alternate);
          pages.set(index, page);
        }
        if (!matchesHeading(page.text, title, page.ocr) && nearHeading(page.text, title)) {
          const cropped = await croppedEvidence(index);
          for (const lines of [cropped.lines, ...(cropped.alternatives ?? [])]) {
            const candidate = fromOCR({ ...cropped, lines, alternatives: undefined });
            if (
              matchesHeading(candidate.text, title, true) &&
              candidate.prominent.some((heading) => matchesHeading(heading, title))
            ) {
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

    const labels = book.pageList?.map((item) => item.label) ?? [];
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
        layout: await contentsLayout(index),
      });
    // Candidates are reusable only for the same PDF, revision, routing and page
    // labels. Re-read every source page; the plan is never title evidence.
    const savedPlan = checks?.plan;
    if (
      savedPlan &&
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
        discovered = [...pages].find(
          ([, page]) => isContents(page.text) || isChapterIndex(page.allLines),
        )?.[0];
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
      const runningHeaders: PrintedLine[] = [];
      const margins: { index: number; line: PrintedLine }[] = [];
      const marginalRows = new Map<Row, { index: number; line: PrintedLine }>();
      let linkedTable = false;
      for (let index = discovered ?? count; index < count; index++) {
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
              base: entry.pageIndex,
              level: entry.level,
              direct: true,
            })),
          );
          linkedTable = true;
          continue;
        }
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
        sources.set(index, await sourceEvidence(index));
        const namedContents = isContents(page.text);
        const continuation = contentsPages.has(index - 1);
        const geometricRows = printedLines(page.layout);
        const structureLines = page.ocr ? geometricRows : await contentsLayout(index);
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
        // On a recognized table, type size cannot decide whether a title
        // exists. Read raw rows before filtering; preserve the table interior
        // and structural parents, while excluding unsupported small footers.
        const rawLines = page.layout
          ? OCRContentsLines(tableLayout ?? page.layout, 'unfiltered')
          : structureLines.map((line) => line.text);
        const filtered = tableLayout ? OCRContentsLines(tableLayout, true) : page.allLines;
        let tableLines = contentsLines(
          withLayoutRows(filtered, rawLines, structureLines, index).join('\n'),
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
          const candidates =
            namedContents || continuation
              ? tableLines.flatMap((line) => {
                  const title = normalize(line);
                  if (
                    !title ||
                    isContentsLine(line) ||
                    /^[\d ivxlcdm.·…_。•⋯∙●‧﹒:：]+$/i.test(line.trim())
                  )
                    return [];
                  const known = contentsRows([line], labels, count, true).rows[0];
                  return [known ?? { title: line.trim(), base: null, level: 0 }];
                })
              : found;
          const joined: Row[] = [];
          for (const row of candidates) {
            const previous = joined.at(-1);
            const previousLayout =
              previous && rowLayout(previous.title, structureLines, index, previous.printed);
            const currentLayout = rowLayout(row.title, structureLines, index, row.printed);
            const wrapped =
              previousLayout &&
              currentLayout &&
              currentLayout.y - previousLayout.y - previousLayout.height <=
                previousLayout.height * 0.8;
            const group = previous && partRank(previous.title) !== undefined;
            const ordinalOnly =
              previous &&
              /^(?:part\s+[ivxlcdm\d]+|第[\d一二三四五六七八九十百零〇]+(?:部分|[部卷辑篇])|[部卷辑篇][\d一二三四五六七八九十百零〇]+)$/i.test(
                previous.title.trim(),
              );
            if (
              previous?.base === null &&
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
                /^\p{Ll}/u.test(row.title))
            ) {
              joined.pop();
              joined.push({ ...row, title: `${previous.title} ${row.title}` });
            } else joined.push(row);
          }
          for (const row of joined) {
            const structure = rowLayout(row.title, structureLines, index, row.printed);
            if (structure) layouts.set(row, structure);
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
      restoreHierarchy(rows, layouts);
      const structure = structureInventory(rows);
      if (!completeStructure(rows, structure))
        return unavailable('pdf_contents_structure_incomplete');
      if (rows.length >= 2 && labelsHash) {
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
      const offsets = new Map<number, number>(plan?.offsets ?? []);
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
        if (
          !offsets.has(g) &&
          ranked[0] &&
          ranked[0][1].size >= 2 &&
          ranked[0][1].size !== ranked[1]?.[1].size
        )
          offsets.set(g, ranked[0][0]);
      }
      const entries: PDFOutlineEntry[] = [];
      const previousCompleted = [...(plan?.completed ?? [])];
      const folios = (page: OCRPage | null) =>
        printedLines(page).flatMap((line) => {
          if (line.y >= 0.1 && line.y < 0.9) return [];
          const value = printedFolio(line.text);
          return value && value > 0 ? [value] : [];
        });
      const proveFolios = async (target: number, printedPage: number) => {
        let anchors = 0;
        for (const delta of [0, 1, 2, -1, -2]) {
          const index = target + delta;
          const printed = printedPage + delta;
          if (index < 0 || index >= count || printed <= 0 || contentsPages.has(index)) continue;
          // Physical neighbours already bound this search to five pages. A
          // coarse folio typo must not veto their independent precise reading.
          await recognize([index]);
          if (folios((await read(index)).layout).includes(printed)) anchors++;
          if (anchors === 2) return true;
        }
        return false;
      };
      const localTarget = async (row: Row, r: number) => {
        if (!contentsPages.size) return undefined;
        const first = Math.max(0, Math.min(...contentsPages) - 12);
        const last = Math.min(count - 1, Math.max(...contentsPages) + 12);
        const nearby = new Set(Array.from({ length: last - first + 1 }, (_, n) => first + n));
        const nextRow = rows[r + 1];
        const nextGroup = groups[r + 1];
        if (
          nextRow?.base !== null &&
          nextRow?.base !== undefined &&
          nextGroup !== undefined &&
          offsets.has(nextGroup)
        ) {
          const nominated = nextRow.base + offsets.get(nextGroup)!;
          for (let i = Math.max(0, nominated - 8); i <= Math.min(count - 1, nominated + 2); i++)
            nearby.add(i);
        }
        const confirmed: { index: number; mapping?: [number, number] }[] = [];
        for (const i of [...nearby].sort((a, b) => a - b)) {
          if (contentsPages.has(i)) continue;
          const preview = await detect(i);
          if (!matchesHeading(preview, row.title, true) && !nearHeading(preview, row.title))
            continue;
          if (!(await verify(i, row.title))) continue;
          const page = await read(i);
          if (!page.ocr || !page.prominent.some((title) => matchesHeading(title, row.title)))
            continue;
          // Two nearby precise marginal folios establish an independent physical
          // mapping even when a title page omits its own printed number. Coarse
          // text only nominates these pages; it never supplies final evidence.
          if (row.printed && (await proveFolios(i, row.printed))) confirmed.push({ index: i });
          else if (!row.printed) {
            // An unnumbered part page can borrow mapping evidence from the next
            // printed entry, provided its own title is independently verified.
            const next = rows[r + 1];
            if (!next?.printed || next.base === null) continue;
            const following: number[] = [];
            for (let j = i + 1; j <= Math.min(count - 1, i + 8); j++) {
              if (contentsPages.has(j)) continue;
              const preview = await detect(j);
              if (!matchesHeading(preview, next.title, true) && !nearHeading(preview, next.title))
                continue;
              if (!(await verify(j, next.title))) continue;
              if (!(await read(j)).prominent.some((title) => matchesHeading(title, next.title)))
                continue;
              if (await proveFolios(j, next.printed)) following.push(j);
            }
            if (following.length === 1)
              confirmed.push({ index: i, mapping: [groups[r + 1]!, following[0]! - next.base] });
          }
        }
        return confirmed.length === 1 ? confirmed[0] : undefined;
      };
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
        const previous = previousCompleted[r];
        let target =
          previous?.title === row.title
            ? previous.pageIndex
            : row.base === null
              ? -1
              : row.base + (row.direct ? 0 : (offsets.get(g) ?? 0));
        let valid = !contentsPages.has(target) && (await verify(target, row.title));
        if (!valid && (!offsets.has(g) || row.base === null)) {
          const local = await localTarget(row, r);
          if (local !== undefined) {
            target = local.index;
            if (local.mapping) offsets.set(...local.mapping);
            valid = true;
          }
        }
        if (!valid) {
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
        if (row.base !== null && !row.direct) offsets.set(g, target - row.base);
        progress.verifiedCount = entries.length;
        if (plan) {
          plan.completed = [...entries];
          plan.offsets = [...offsets];
        }
        await report('running');
        check();
      }
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
    await releasePDFSourceSession(openedCache).catch(() => {});
  }
}
