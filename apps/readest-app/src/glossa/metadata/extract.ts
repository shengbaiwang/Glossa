import type { BookMetadata } from '@/libs/document';
import { validateISBN } from '@/utils/validation';
import type { MetadataCandidate, MetadataField } from './types';

const PLACEHOLDER =
  /^(?:unknown|n\/?a|none|untitled document|untitled presentation|document\d+|powerpoint presentation|ss[\s_-]*reader(?:\s*v?\d+(?:\.\d+)*)?|adobe acrobat|acrobat pdfmaker|microsoft word|microsoft powerpoint)$/i;
const DATE = /\b([12]\d{3})(?:\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2})\s*日?)?\s*月?)?/;
const NON_PUBLICATION_DATE = /印刷|印次|重印|reprint|printing|copyright|©/i;
const ORIGINAL_EDITION = /\boriginal(?:ly)?\b|原版|原著/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const LABELS: Array<[MetadataField, string]> = [
  ['title', '书名|書名|正题名|正題名|title'],
  ['author', '作者|著者|著作人|主编|主編|编者|編者|author(?:s)?|written by|edited by|by'],
  ['translator', '译者|譯者|翻译|翻譯|translator(?:s)?|translated by|translation by'],
  ['publisher', '出版发行|出版發行|出版社|出版者|出版单位|出版單位|出版|publisher|published by'],
  ['published', '出版日期|出版时间|出版時間|出版年月|publication date|date published'],
  ['language', '语种|語種|语言|語言|language'],
  ['series', '丛书|叢書|系列|series'],
];
const spacedLabels = (labels: string) =>
  labels.replace(/([\p{Script=Han}])(?=[\p{Script=Han}])/gu, '$1[ \\t]*');
const LABEL_BOUNDARY = new RegExp(
  `(?:^|[;；\\s]+)(?:${spacedLabels(LABELS.map(([, labels]) => labels).join('|'))})\\s*[:：/／]`,
  'gi',
);
const CIP = /图书在版编目|圖書在版編目|catalog(?:u)?ing[\s.-]+in[\s.-]+publication|\bCIP\b/i;
// Compact only the CIP marker comparison, preserving English word boundaries
// in all extracted values and other page signals.
const hasCIP = (text: string) => CIP.test(text) || CIP.test(text.replace(/[ \t]/g, ''));
const LANGUAGE_NAMES: Record<string, string> = {
  中文: 'zh',
  简体中文: 'zh-Hans',
  簡體中文: 'zh-Hans',
  繁体中文: 'zh-Hant',
  繁體中文: 'zh-Hant',
  英文: 'en',
  英语: 'en',
  英語: 'en',
  english: 'en',
  chinese: 'zh',
  日本語: 'ja',
  日语: 'ja',
  日語: 'ja',
  japanese: 'ja',
};

/** Repair typographic spacing, never substitute uncertain OCR letters or digits. */
function layoutText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‐‑‒–—−﹘﹣]/g, '-')
    .replace(/\b(?:[a-zA-Z][ \t]){2,}[a-zA-Z]\b/g, (word) => word.replace(/[ \t]/g, ''));
}

const RESPONSIBILITY =
  /(?:编著|編著|主编|主編|编译|編譯|组译|組譯|翻译|翻譯|笺疏|箋疏|整理|校注|校订|校訂|校对|校對|著|撰|编|編|译|譯|注|校)(?!者)/g;
type Responsibility = 'author' | 'translator' | 'editor' | 'other';

function roleOf(role: string): Responsibility {
  if (/^(?:aut|author|著|撰|编著|編著)$/i.test(role)) return 'author';
  if (/^(?:trl|translator|译|譯|翻译|翻譯|编译|編譯|组译|組譯)$/i.test(role)) return 'translator';
  if (/^(?:edt|editor|主编|主編|编|編)$/i.test(role)) return 'editor';
  return 'other';
}

const contributorText = (text: string) =>
  layoutText(text).replace(/([\p{Script=Han}])[ \t]+(?=[\p{Script=Han}])/gu, '$1');

function responsibilities(raw: string, fallback: Responsibility) {
  const result: Array<{ name: string; role: Responsibility }> = [];
  for (const part of contributorText(raw).split(/[;；、]/)) {
    const matches = [...part.matchAll(RESPONSIBILITY)];
    let offset = 0;
    for (const match of matches) {
      const name = part.slice(offset, match.index).replace(/^[\s,，]+|[\s,，.。]+$/g, '');
      if (name.replace(/[^\p{L}]/gu, '').length < 2) continue;
      result.push({ name, role: roleOf(match[0]) });
      offset = match.index! + match[0].length;
    }
    const rest = part
      .slice(offset)
      .trim()
      .replace(/[,，]+$/, '');
    if (rest) result.push({ name: rest, role: offset ? 'other' : fallback });
  }
  return result;
}

function contributorFields(data: Record<string, unknown>) {
  const groups: Record<Responsibility, string[]> = {
    author: [],
    translator: [],
    editor: [],
    other: [],
  };
  const visit = (value: unknown, fallback: Responsibility) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, fallback));
      return;
    }
    const record =
      value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
    const role = record?.['role'] ? roleOf(textValue(record['role'])) : fallback;
    for (const entry of responsibilities(textValue(value), role)) {
      for (const part of entry.name.split(/[,，](?=[\p{Script=Han}(〔【])/u)) {
        const name = clean(part)
          .replace(/[◎●]\s*$/, '')
          .trim();
        if (
          name &&
          !PLACEHOLDER.test(name) &&
          !/https?:\/\/|www\.|@/i.test(name) &&
          !groups[entry.role].includes(name)
        )
          groups[entry.role].push(name);
      }
    }
  };
  visit(data['author'], 'author');
  visit(data['translator'], 'translator');
  visit(data['editor'], 'editor');
  visit(data['contributor'], 'other');
  return {
    author: (groups.author.length ? groups.author : groups.editor).join('; '),
    translator: groups.translator.join('; '),
  };
}

function clean(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join('; ');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (record['name']) return textValue(record['name']);
  if (record['value']) return textValue(record['value']);
  return Object.values(record).find((entry): entry is string => typeof entry === 'string') ?? '';
}

function normalizeISBN(raw: string) {
  const value = raw
    .normalize('NFKC')
    .replace(/^urn:isbn:/i, '')
    .replace(/[-‐‑‒–—−\s]/g, '')
    .toUpperCase();
  if (!/^(?:\d{9}[\dX]|97[89]\d{10})$/.test(value)) return '';
  return validateISBN(value).isValid ? value : '';
}

function normalizeDate(raw: string): string {
  const english = /\b([a-z]{3,9})\s+(?:(\d{1,2}),?\s+)?([12]\d{3})\b/i.exec(raw);
  const monthName = english ? MONTHS.indexOf(english[1]!.slice(0, 3).toLowerCase()) + 1 : 0;
  const match =
    english && monthName
      ? [english[0], english[3]!, String(monthName), english[2] ?? '']
      : DATE.exec(raw);
  if (!match) return '';
  const year = Number(match[1]);
  if (!match[2]) return String(year);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  if (!match[3]) return prefix;
  const day = Number(match[3]);
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return '';
  return `${prefix}-${String(day).padStart(2, '0')}`;
}

function normalize(field: MetadataField, raw: string): string {
  const value = clean(raw).replace(/^[：:\s]+|[；;\s]+$/g, '');
  if (!value || value.length > 1000 || PLACEHOLDER.test(value)) return '';
  if (field === 'isbn') return normalizeISBN(value);
  if (field === 'published') return normalizeDate(value);
  if (field === 'language') {
    const language = LANGUAGE_NAMES[value.toLowerCase()] ?? value;
    return /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language) ? language : '';
  }
  return value;
}

function candidate(
  field: MetadataField,
  raw: string,
  source: MetadataCandidate['source'],
  reviewReason?: string,
): MetadataCandidate | undefined {
  const value = normalize(field, raw);
  if (!value) return;
  const key = `${field}|${value}|${source.kind}|${source.pageIndex ?? source.href ?? ''}|${source.excerpt}`;
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return {
    id: `${field}-${(hash >>> 0).toString(36)}`,
    field,
    value,
    source: { ...source, excerpt: source.excerpt.slice(0, 1200) },
    confidence: reviewReason ? 'review' : 'supported',
    ...(reviewReason ? { reason: reviewReason } : {}),
  };
}

/** Raw embedded fields remain evidence; the caller never receives a mutated book. */
export function extractFileMetadata(metadata: BookMetadata): MetadataCandidate[] {
  const data: Record<string, unknown> = { ...metadata };
  const contributors = contributorFields(data);
  const result: MetadataCandidate[] = [];
  const add = (field: MetadataField, value: unknown) => {
    const text = textValue(value);
    const evidence =
      field === 'author' || field === 'translator'
        ? textValue([data['author'], data['translator'], data['editor'], data['contributor']])
        : text;
    // Foliate falls back to the first dc:date even when it is a modification
    // event. Equal normalized dates cannot establish publication on their own.
    const ambiguousDate =
      field === 'published' &&
      normalizeDate(text) &&
      normalizeDate(text) === normalizeDate(textValue(data['modified']));
    const found = candidate(
      field,
      text,
      { kind: 'file', label: 'File metadata', excerpt: evidence.slice(0, 1200) },
      ambiguousDate ? 'Uncertain publication date' : undefined,
    );
    if (found) result.push(found);
  };
  for (const field of [
    'title',
    'author',
    'translator',
    'publisher',
    'published',
    'language',
    'series',
  ] as const) {
    const value = field === 'author' || field === 'translator' ? contributors[field] : data[field];
    if (field === 'language' && Array.isArray(value)) {
      for (const language of value) add(field, language);
    } else add(field, value);
  }
  if (!data['series']) {
    const series = metadata.belongsTo?.series;
    const entries = Array.isArray(series) ? series : series ? [series] : [];
    for (const entry of entries) add('series', entry.name);
  }
  for (const key of ['isbn', 'identifier', 'altIdentifier']) {
    const values = Array.isArray(data[key]) ? (data[key] as unknown[]) : [data[key]];
    for (const value of values) add('isbn', value);
  }
  return deduplicateCandidates(result);
}

/** Independent structural and lexical signals; this is a ranking score, not a probability. */
export function scoreCopyrightPage(text: string, semantic = false): number {
  const sample = layoutText(text.slice(0, 30000));
  const compact = contributorText(sample);
  let score = semantic ? 8 : 0;
  if (hasCIP(compact)) score += 4;
  if (/\bISBN(?:-1[03])?\s*[:：]?\s*[\dXx][\dXx\s-]{8,}/i.test(sample)) score += 3;
  if (/copyright|版权信息|版權資訊|版权所有|版權所有|所有权利保留|著作权|著作權|©/i.test(compact))
    score += 1;
  if (/出版社|出版者|出版发行|出版發行|publisher\s*:|published by/i.test(compact)) score += 1;
  if (/第\s*[一二三四五六七八九十\d]+\s*版|first published|\bedition\b/i.test(sample)) score += 1;
  if (/译者|譯者|translated by/i.test(sample)) score += 1;
  // Short electronic copyright pages often have no ISBN. Require the heading
  // plus both title and responsibility labels; a references list is insufficient.
  if (/版权信息|版權資訊/.test(compact) && /书名|書名/.test(compact) && /作者|著者/.test(compact))
    score += 4;
  return score;
}

/** Extract only attributable labels and edition statements, retaining the original evidence. */
export function extractCopyrightMetadata(
  text: string,
  source: MetadataCandidate['source'],
): MetadataCandidate[] {
  const originals = text.slice(0, 100000).split(/\r\n?|\n/);
  const lines = originals.map(layoutText);
  const cipPage = hasCIP(contributorText(text.slice(0, 30000)));
  const cipHeading = lines.findIndex((line) => hasCIP(contributorText(line)));
  const cipStatement = lines.findIndex(
    (line, index) =>
      index > cipHeading &&
      index <= cipHeading + 5 &&
      /[/／]/.test(line) &&
      !/^(?:https?:|ISBN|书名原文|書名原文|[\dⅠⅡⅢⅣ]|[（(])/.test(line.trim()) &&
      !LABELS.some(([, labels]) =>
        new RegExp(`^(?:${spacedLabels(labels)})\\s*[:：/／]`, 'i').test(line.trim()),
      ),
  );
  const result: MetadataCandidate[] = [];
  const editors = new Set<MetadataCandidate>();
  const add = (
    field: MetadataField,
    raw: string,
    excerpt: string,
    reason?: string,
    editor = false,
  ) => {
    if (field === 'published' && NON_PUBLICATION_DATE.test(raw)) return;
    if (field === 'author' || field === 'translator') {
      const fields = contributorFields({ [field]: raw });
      for (const key of ['author', 'translator'] as const) {
        if (!fields[key]) continue;
        const found = candidate(key, fields[key], { ...source, excerpt }, reason);
        if (found) {
          result.push(found);
          if (editor && key === 'author') editors.add(found);
        }
      }
      return;
    }
    const found = candidate(
      field,
      raw,
      { ...source, excerpt },
      reason ??
        (field === 'published' && ORIGINAL_EDITION.test(excerpt)
          ? 'Original edition date'
          : undefined),
    );
    if (found) result.push(found);
  };
  for (let index = 0; index < lines.length; index++) {
    const original = originals[index]!;
    const line = lines[index]!.trim();
    if (!line) continue;
    const boundaries = [...line.matchAll(LABEL_BOUNDARY)];
    const segments =
      boundaries.length > 1
        ? boundaries.map((boundary, segmentIndex) =>
            line
              .slice(boundary.index, boundaries[segmentIndex + 1]?.index)
              .replace(/^[;；\s]+/, ''),
          )
        : [line];
    for (const segment of segments) {
      for (const [field, labels] of LABELS) {
        const match = new RegExp(
          `^(?:${spacedLabels(labels)})(?:\\s*[:：/／]\\s*|\\s+|$)(.*)$`,
          'i',
        ).exec(segment);
        if (!match) continue;
        let raw = match[1]?.trim() ?? '';
        let excerpt = original;
        if (!raw && lines[index + 1]) {
          const next = lines[index + 1]!.trim();
          if (
            !LABELS.some(([, nextLabels]) =>
              new RegExp(`^(?:${spacedLabels(nextLabels)})(?:[:：/／\\s]|$)`, 'i').test(next),
            )
          ) {
            raw = next;
            excerpt += `\n${originals[index + 1]}`;
          }
        }
        add(
          field,
          raw,
          excerpt,
          undefined,
          field === 'author' &&
            /^(?:主\s*[编編]|[编編]\s*者|edited by)(?:\s|[:：/／]|$)/i.test(segment),
        );
        break;
      }
    }
    // CIP bibliographic statements explicitly separate title and responsibility
    // with a slash. Outside a CIP page that punctuation is not title evidence.
    if (cipPage) {
      if (index === cipStatement) {
        const block = [line];
        let end = index;
        while (
          end < Math.min(index + 3, lines.length - 1) &&
          !/[著编編译譯]/.test(block.join(' ').split(/[/／]/)[1] ?? '') &&
          /[\p{Script=Han}]/u.test(line)
        ) {
          const next = lines[end + 1]!.trim();
          if (!next || /^(?:ISBN|[ⅠⅡⅢⅣ]|\d+\.)/i.test(next)) break;
          block.push(next);
          end++;
        }
        const joined = block.join(' ').replace(/([\p{Script=Han}]) (?=[\p{Script=Han}])/gu, '$1');
        const statement = /^(.{1,200}?)\s*[/／]\s*(.{1,300}?)(?:\s*[.。]?\s*[-—]{1,2}\s*|$)/.exec(
          joined,
        );
        if (statement) {
          const responsibility = statement[2]!.replace(/[.。]+$/, '');
          // Chinese CIP uses explicit responsibility suffixes; English CIP uses
          // the cataloguing slash. No arbitrary slash in chapter prose qualifies.
          if (
            /[著编編译譯]/.test(responsibility) ||
            (/[a-zA-Z]/.test(responsibility) && !/[\p{Script=Han}]/u.test(responsibility))
          ) {
            const excerpt = originals.slice(index, end + 1).join('\n');
            add('title', statement[1]!, excerpt);
            add(
              'author',
              responsibility,
              excerpt,
              undefined,
              !/[著撰]/.test(responsibility) && /[编編]/.test(responsibility),
            );
          }
        }
      }
    }
    // ISBN must be explicitly labelled, exact digits only. Separate print/e-book
    // numbers remain candidates with the full edition qualifier in the excerpt.
    for (const isbn of line.matchAll(/\bISBN(?:-1[03])?\s*[:：]?\s*([\dXx][\dXx -]{8,24})/gi)) {
      add(
        'isbn',
        isbn[1]!,
        original,
        /hardback|paperback|cloth|print|ebook|e-book|epub|pdf|精装|精裝|平装|平裝|电子|電子|套装|套裝/i.test(
          line,
        )
          ? 'Edition-specific ISBN'
          : undefined,
      );
    }
    {
      const chineseEdition =
        /[12]\d{3}\s*年\s*(?:\d{1,2}\s*月\s*)?(?:\d{1,2}\s*日\s*)?(?:北京|上海)?\s*第\s*[一二三四五六七八九十\d]+\s*版/.exec(
          line,
        );
      const englishEdition =
        /(?:first published|originally published|this (?:edition|translation)(?: first)? published|published in this (?:edition|translation))(?:.*?)([12]\d{3})/i.exec(
          line,
        );
      if (chineseEdition) add('published', chineseEdition[0], original);
      if (englishEdition && !NON_PUBLICATION_DATE.test(line))
        add(
          'published',
          englishEdition[1]!,
          original,
          ORIGINAL_EDITION.test(line) ? 'Original edition date' : undefined,
        );
    }
    if (
      line.length < 100 &&
      !/[/／:：\d]|出版|版权|版權|印刷|地址|邮编|郵編|责任编辑|責任編輯/.test(line) &&
      !/^[（(].*[）)]$/.test(line)
    ) {
      const credit = contributorText(line);
      const translated = /^(.+?)\s*(?:组译|組譯|译|譯)$/.exec(credit);
      const written = /^(.+?)\s*(著|撰|主编|主編|编|編)$/.exec(credit);
      if (translated) add('translator', translated[1]!, original);
      if (written) add('author', written[1]!, original, undefined, /[编編]/.test(written[2]!));
    }
    if (result.length >= 128) break;
  }
  const hasWriter = result.some((item) => item.field === 'author' && !editors.has(item));
  return deduplicateCandidates(hasWriter ? result.filter((item) => !editors.has(item)) : result);
}

type MetadataPage = {
  text: string;
  source: MetadataCandidate['source'];
  index?: number;
  uncertain?: boolean;
};

/** A bare name on a title page needs independent evidence, not a name guess. */
export function extractFrontMatterAuthors(pages: MetadataPage[]): MetadataCandidate[] {
  const holders = new Set<string>();
  const nameKey = (name: string) =>
    layoutText(name)
      .replace(/[^\p{L}\p{N}]/gu, '')
      .toLowerCase();
  for (const page of pages) {
    for (const line of layoutText(page.text).split(/\r?\n/)) {
      const credit =
        /^(?:copyright\s*(?:©\s*)?|©\s*)(?:\d{4}[, ]*)?(.+?)(?:[, ]+\d{4}[.]?)?$/i.exec(
          line.trim(),
        );
      const name = credit?.[1]?.trim();
      if (
        name &&
        name.length < 100 &&
        !/press|publish|university|inc\b|ltd\b|公司|出版|书店/i.test(name)
      )
        holders.add(nameKey(name));
    }
  }
  const result: MetadataCandidate[] = [];
  for (const page of pages) {
    const start = result.length;
    const index = page.index ?? page.source.pageIndex ?? 0;
    if (index >= 8 || page.text.length > 1800) continue;
    const lines = page.text.split(/\r?\n/).filter((line) => line.trim());
    if (
      lines.length > 20 ||
      /目录|目錄|参考文献|參考文獻|contents|references|bibliography/i.test(page.text)
    )
      continue;
    for (const line of lines) {
      if (holders.has(nameKey(line))) {
        const found = candidate('author', layoutText(line).trim(), {
          ...page.source,
          excerpt: line,
        });
        if (found) result.push(found);
      }
    }
    // Explicit cover credits are also evidence; a chapter byline in a table of
    // contents or running prose must not become the author of the whole book.
    if (index < 2 && /出版社|出版者|\bpress\b|\bpublishing\b/i.test(layoutText(page.text))) {
      const credits = lines.filter(
        (line) =>
          /^.{2,100}?(?:著|撰|主编|主編|编|編|译|譯)\s*$/.test(line) &&
          !/[:：/／]|出版|丛书|叢書|译丛|譯叢/.test(line),
      );
      const fields = contributorFields({ author: credits.join('; ') });
      for (const field of ['author', 'translator'] as const) {
        const found = candidate(field, fields[field], { ...page.source, excerpt: page.text });
        if (found) result.push(found);
      }
    }
    if (page.uncertain)
      for (const item of result.slice(start)) {
        item.confidence = 'review';
        item.reason = 'Uncertain text recognition';
      }
  }
  return deduplicateCandidates(result);
}

export function deduplicateCandidates(candidates: MetadataCandidate[]): MetadataCandidate[] {
  const unique = new Map<string, MetadataCandidate>();
  for (const item of candidates) {
    const key = `${item.field}:${item.value.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()}`;
    const previous = unique.get(key);
    if (!previous || (previous.source.kind === 'file' && item.source.kind !== 'file'))
      unique.set(key, item);
  }
  const result = [...unique.values()].slice(0, 128);
  const values = new Map<MetadataField, Set<string>>();
  for (const item of result) {
    if (item.reason === 'Original edition date') continue;
    const fieldValues = values.get(item.field) ?? new Set<string>();
    fieldValues.add(item.value);
    values.set(item.field, fieldValues);
  }
  return result.map((item) =>
    item.reason !== 'Original edition date' && (values.get(item.field)?.size ?? 0) > 1
      ? { ...item, confidence: 'review', reason: item.reason ?? 'Conflicting values' }
      : item,
  );
}
