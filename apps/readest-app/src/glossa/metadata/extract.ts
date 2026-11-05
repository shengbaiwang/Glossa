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
  ['author', '作者|著者|著作人|author(?:s)?|written by|by'],
  ['translator', '译者|譯者|翻译|翻譯|translator(?:s)?|translated by|translation by'],
  ['publisher', '出版社|出版者|出版单位|出版單位|publisher|published by'],
  ['published', '出版日期|出版时间|出版時間|出版年月|publication date|date published'],
  ['language', '语种|語種|语言|語言|language'],
  ['series', '丛书|叢書|系列|series'],
];
const LABEL_BOUNDARY = new RegExp(
  `(?:^|[;；\\s]+)(?:${LABELS.map(([, labels]) => labels).join('|')})\\s*[:：]`,
  'gi',
);
const CIP = /图书在版编目|圖書在版編目|catalog(?:u)?ing.in.publication|\bCIP\b/i;
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
    .replace(/[-\s]/g, '')
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
  const result: MetadataCandidate[] = [];
  const add = (field: MetadataField, value: unknown) => {
    const text = textValue(value);
    // Foliate falls back to the first dc:date even when it is a modification
    // event. Equal normalized dates cannot establish publication on their own.
    const ambiguousDate =
      field === 'published' &&
      normalizeDate(text) &&
      normalizeDate(text) === normalizeDate(textValue(data['modified']));
    const found = candidate(
      field,
      text,
      { kind: 'file', label: 'File metadata', excerpt: text.slice(0, 1200) },
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
    const value =
      (field === 'author' || field === 'translator') && Array.isArray(data[field])
        ? (data[field] as unknown[]).filter(
            (contributor) => !PLACEHOLDER.test(clean(textValue(contributor))),
          )
        : data[field];
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
  const sample = text.slice(0, 30000);
  let score = semantic ? 8 : 0;
  if (CIP.test(sample)) score += 4;
  if (/\bISBN(?:-1[03])?\s*[:：]?\s*[\dXx][\dXx\s-]{8,}/i.test(sample)) score += 3;
  if (/copyright|版权所有|版權所有|著作权|著作權|©/i.test(sample)) score += 1;
  if (/出版社|出版者|publisher\s*:|published by/i.test(sample)) score += 1;
  if (/第\s*[一二三四五六七八九十\d]+\s*版|first published|\bedition\b/i.test(sample)) score += 1;
  if (/译者|譯者|translated by/i.test(sample)) score += 1;
  return score;
}

/** Extract only attributable labels and edition statements, retaining the original evidence. */
export function extractCopyrightMetadata(
  text: string,
  source: MetadataCandidate['source'],
): MetadataCandidate[] {
  const lines = text.slice(0, 100000).split(/\r\n?|\n/);
  const cipPage = CIP.test(text.slice(0, 30000));
  const result: MetadataCandidate[] = [];
  const add = (field: MetadataField, raw: string, excerpt: string, reason?: string) => {
    if (field === 'published' && NON_PUBLICATION_DATE.test(raw)) return;
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
    const original = lines[index]!;
    const line = original.trim();
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
        const match = new RegExp(`^(?:${labels})(?:\\s*[:：]\\s*|\\s+|$)(.*)$`, 'i').exec(segment);
        if (!match) continue;
        let raw = match[1]?.trim() ?? '';
        let excerpt = original;
        if (!raw && lines[index + 1]) {
          const next = lines[index + 1]!.trim();
          if (
            !LABELS.some(([, nextLabels]) =>
              new RegExp(`^(?:${nextLabels})(?:[:：\\s]|$)`, 'i').test(next),
            )
          ) {
            raw = next;
            excerpt += `\n${lines[index + 1]}`;
          }
        }
        add(field, raw, excerpt);
        break;
      }
    }
    // CIP bibliographic statements explicitly separate title and responsibility
    // with a slash. Outside a CIP page that punctuation is not title evidence.
    if (cipPage) {
      const statement = /^(.{1,160}?)\s*[/／]\s*(.{1,100}?)\s*[著编編](?:[；;，,。.]|$)/.exec(line);
      if (statement) {
        add('title', statement[1]!, original);
        add('author', statement[2]!, original);
        const translation = /[；;]\s*(.{1,100}?)\s*[译譯](?:[。.]|$)/.exec(line);
        if (translation) add('translator', translation[1]!, original);
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
    if (!NON_PUBLICATION_DATE.test(line)) {
      const chineseEdition =
        /[12]\d{3}\s*年\s*(?:\d{1,2}\s*月\s*)?(?:\d{1,2}\s*日\s*)?第\s*[一二三四五六七八九十\d]+\s*版/.exec(
          line,
        );
      const englishEdition =
        /(?:first published|originally published|this (?:edition|translation)(?: first)? published|published in this (?:edition|translation))(?:.*?)([12]\d{3})/i.exec(
          line,
        );
      if (chineseEdition) add('published', chineseEdition[0], original);
      if (englishEdition)
        add(
          'published',
          englishEdition[1]!,
          original,
          ORIGINAL_EDITION.test(line) ? 'Original edition date' : undefined,
        );
    }
    if (line.length < 150) {
      const translated = /^(.+?)\s+[译譯]$/.exec(line);
      const written = /^(.+?)\s+[著撰]$/.exec(line);
      if (translated) add('translator', translated[1]!, original);
      if (written) add('author', written[1]!, original);
    }
    if (result.length >= 128) break;
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
