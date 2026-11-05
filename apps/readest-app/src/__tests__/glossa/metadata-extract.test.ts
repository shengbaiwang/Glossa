import { describe, expect, it } from 'vitest';
import type { BookMetadata } from '@/libs/document';
import {
  deduplicateCandidates,
  extractCopyrightMetadata,
  extractFileMetadata,
  scoreCopyrightPage,
} from '@/glossa/metadata/extract';
import { metadataRecognitionSchema, metadataSourceSchema } from '@/glossa/metadata/types';

const source = { kind: 'text' as const, label: 'Copyright page', excerpt: '', pageIndex: 3 };

it('accepts archive-relative evidence paths and rejects external or malformed links', () => {
  expect(
    metadataSourceSchema.safeParse({ ...source, href: 'OPS/copyright.xhtml#page' }).success,
  ).toBe(true);
  for (const href of [
    'https://example.com/page',
    '//example.com/page',
    'file:///book',
    'javascript:alert(1)',
    'OPS\\page',
    'OPS/\npage',
  ])
    expect(metadataSourceSchema.safeParse({ ...source, href }).success).toBe(false);
});

describe('local bibliographic candidate extraction', () => {
  it('reads structured contributors, language maps and identifiers without mutating metadata', () => {
    const raw = {
      title: { zh: '空间研究', en: 'Spatial Studies' },
      author: [{ name: { zh: '张三' } }, { name: { en: 'A. Writer' } }],
      translator: [{ name: { zh: '李四' } }],
      publisher: { name: { zh: '学术出版社' } },
      language: ['zh'],
      published: '2022',
      altIdentifier: ['urn:uuid:random', 'urn:isbn:9780306406157'],
      modified: '2025-06-07',
      subject: ['历史'],
    } as unknown as BookMetadata;
    const before = structuredClone(raw);
    const result = extractFileMetadata(raw);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title', value: '空间研究' }),
        expect.objectContaining({ field: 'author', value: '张三; A. Writer' }),
        expect.objectContaining({ field: 'translator', value: '李四' }),
        expect.objectContaining({ field: 'publisher', value: '学术出版社' }),
        expect.objectContaining({ field: 'published', value: '2022' }),
        expect.objectContaining({ field: 'isbn', value: '9780306406157' }),
      ]),
    );
    expect(result.map((candidate) => candidate.field)).not.toContain('subject');
    expect(raw).toEqual(before);
  });

  it('rejects software placeholders, malformed identifiers and impossible publication dates', () => {
    const result = extractFileMetadata({
      title: 'Untitled Document',
      author: 'Adobe Acrobat',
      language: 'unknown',
      published: '2023-02-30',
      isbn: '1234567890123',
      identifier: '9780306406158',
    });
    expect(result).toEqual([]);
    expect(
      extractFileMetadata({
        title: 'The Adobe Acrobat Handbook',
        author: 'Anonymous',
        language: 'en',
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title', value: 'The Adobe Acrobat Handbook' }),
      ]),
    );
  });

  it('extracts Chinese fields, separates translator and preserves literal source evidence', () => {
    const text =
      '图书在版编目（CIP）数据\n书名：空间研究\n作者：张三\n译者：李四\n出版社：学术出版社\n2022年5月第1版\n2024年8月第3次印刷\nISBN 978-0-306-40615-7';
    const result = extractCopyrightMetadata(text, source);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title', value: '空间研究' }),
        expect.objectContaining({ field: 'author', value: '张三' }),
        expect.objectContaining({ field: 'translator', value: '李四' }),
        expect.objectContaining({ field: 'publisher', value: '学术出版社' }),
        expect.objectContaining({ field: 'published', value: '2022-05' }),
        expect.objectContaining({ field: 'isbn', value: '9780306406157' }),
      ]),
    );
    expect(result.filter((candidate) => candidate.field === 'published')).toHaveLength(1);
    for (const candidate of result) {
      expect(text).toContain(candidate.source.excerpt);
      expect(candidate.source.pageIndex).toBe(3);
    }
  });

  it('retains edition qualifiers on several ISBNs and never repairs OCR digits by guessing', () => {
    const text =
      'ISBN 978-0-306-40615-7 (hardback)\nISBN 0-8044-2957-X (paperback)\nISBN 978-O-306-40615-7';
    const result = extractCopyrightMetadata(text, source).filter(
      (candidate) => candidate.field === 'isbn',
    );
    expect(result.map((candidate) => candidate.value)).toEqual(['9780306406157', '080442957X']);
    expect(result.every((candidate) => candidate.confidence === 'review')).toBe(true);
    expect(result[0]?.source.excerpt).toContain('hardback');
    expect(result[1]?.source.excerpt).toContain('paperback');
  });

  it('does not treat copyright, original edition or printing years as the current edition date', () => {
    const text =
      'Copyright © 1998 A. Writer\nOriginally published in 1998\nFirst published in this translation in 2016\nReprinted 2023\nTranslated by B. Reader\nPublisher: Example Press';
    const result = extractCopyrightMetadata(text, source);
    expect(result.filter((candidate) => candidate.field === 'published')).toEqual([
      expect.objectContaining({
        value: '1998',
        confidence: 'review',
        reason: 'Original edition date',
      }),
      expect.objectContaining({ value: '2016', confidence: 'supported' }),
    ]);
    expect(result).toContainEqual(
      expect.objectContaining({ field: 'translator', value: 'B. Reader' }),
    );
  });

  it('keeps original-language edition dates under review and rejects mixed print-date rows', () => {
    const result = extractCopyrightMetadata(
      'Original English edition first published in 1998\nThis translation first published in 2016\n出版日期：2023年8月第3次印刷\nPublication date: Reprinted 2024',
      source,
    );
    expect(result.filter((item) => item.field === 'published')).toEqual([
      expect.objectContaining({
        value: '1998',
        confidence: 'review',
        reason: 'Original edition date',
      }),
      expect.objectContaining({ value: '2016', confidence: 'supported' }),
    ]);
  });

  it('does not present a parser fallback to the modification date as a supported publication date', () => {
    const result = extractFileMetadata({
      title: 'Original fixture',
      author: '',
      language: '',
      published: '2025-10-10',
      modified: '2025-10-10',
    } as unknown as BookMetadata);
    expect(result).toContainEqual(
      expect.objectContaining({
        field: 'published',
        value: '2025-10-10',
        confidence: 'review',
        reason: 'Uncertain publication date',
      }),
    );
  });

  it('understands traditional labels and adjacent values, but does not promote arbitrary text to titles', () => {
    const result = extractCopyrightMetadata(
      '書名：山海\n譯者\n王小明\n出版日期：2020年6月\n印刷廠：某印刷公司\n責任編輯：趙某',
      source,
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title', value: '山海' }),
        expect.objectContaining({ field: 'translator', value: '王小明' }),
        expect.objectContaining({ field: 'published', value: '2020-06' }),
      ]),
    );
    expect(result.some((candidate) => candidate.field === 'publisher')).toBe(false);
    expect(
      extractCopyrightMetadata('The quick brown fox\nA chapter about ISBN systems\n© 2020', source),
    ).toEqual([]);
  });

  it('keeps a shared author and translator while filtering individual software contributors', () => {
    const candidates = extractFileMetadata({
      title: '山海',
      author: ['张三', 'Adobe Acrobat'],
      translator: [{ name: { zh: '张三' } }],
      language: 'zh',
    } as unknown as BookMetadata);
    expect(candidates).toContainEqual(expect.objectContaining({ field: 'author', value: '张三' }));
    expect(candidates).toContainEqual(
      expect.objectContaining({ field: 'translator', value: '张三' }),
    );
  });

  it('retains date precision and validates leap days in structured fields', () => {
    for (const [raw, expected] of [
      ['2020', '2020'],
      ['2020-05', '2020-05'],
      ['May 2020', '2020-05'],
      ['May 12, 2020', '2020-05-12'],
      ['2020-02-29', '2020-02-29'],
    ]) {
      expect(extractFileMetadata({ title: '', author: '', language: '', published: raw })).toEqual([
        expect.objectContaining({ field: 'published', value: expected }),
      ]);
    }
    expect(
      extractFileMetadata({ title: '', author: '', language: '', published: '2021-02-29' }),
    ).toEqual([]);
  });

  it('extracts compact label rows without swallowing the following field', () => {
    const result = extractCopyrightMetadata(
      '书名：山海 作者：张三 译者：李四\n出版社：学术社；出版日期：2020年5月',
      source,
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title', value: '山海' }),
        expect.objectContaining({ field: 'author', value: '张三' }),
        expect.objectContaining({ field: 'translator', value: '李四' }),
        expect.objectContaining({ field: 'publisher', value: '学术社' }),
        expect.objectContaining({ field: 'published', value: '2020-05' }),
      ]),
    );
  });

  it('reads an explicitly attributed CIP bibliographic statement without treating a slash in prose as a title', () => {
    const result = extractCopyrightMetadata(
      '图书在版编目（CIP）数据\n空间研究 / 张三著；李四译. — 北京：学术出版社，2020.5\nISBN 9780306406157',
      source,
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title', value: '空间研究' }),
        expect.objectContaining({ field: 'author', value: '张三' }),
        expect.objectContaining({ field: 'translator', value: '李四' }),
      ]),
    );
    expect(extractCopyrightMetadata('空间研究 / 张三著', source)).toEqual([]);
  });

  it('scores multiple independent page signals and gives an explicit semantic marker priority', () => {
    expect(scoreCopyrightPage('This chapter discusses copyright.')).toBeLessThan(3);
    expect(
      scoreCopyrightPage('图书在版编目（CIP）数据\nISBN 9780306406157\n出版社：某社\n2020年第1版'),
    ).toBeGreaterThan(5);
    expect(scoreCopyrightPage('', true)).toBeGreaterThan(5);
  });

  it('deduplicates equal values while flagging conflicts and keeping original excerpts', () => {
    const file = extractFileMetadata({ title: 'One', author: '', language: '' });
    const same = extractCopyrightMetadata('Title: One', source);
    expect(
      deduplicateCandidates([...file, ...same]).filter((candidate) => candidate.field === 'title'),
    ).toHaveLength(1);
    const conflict = deduplicateCandidates([
      ...file,
      ...extractCopyrightMetadata('Title: Two', source),
    ]);
    expect(
      conflict
        .filter((candidate) => candidate.field === 'title')
        .every((candidate) => candidate.confidence === 'review'),
    ).toBe(true);
  });

  it('validates bounded cached results and rejects unexpected fields or invalid evidence locations', () => {
    const candidates = extractCopyrightMetadata('Title: One', source);
    expect(
      metadataRecognitionSchema.safeParse({
        version: 1,
        fingerprint: 'a'.repeat(64),
        candidates,
        complete: true,
        dismissed: [candidates[0]!.id],
      }).success,
    ).toBe(true);
    expect(
      metadataRecognitionSchema.safeParse({
        version: 1,
        fingerprint: '',
        candidates,
        complete: true,
      }).success,
    ).toBe(false);
    expect(
      metadataRecognitionSchema.safeParse({
        version: 1,
        fingerprint: 'a'.repeat(64),
        candidates: [{ ...candidates[0], source: { ...source, pageIndex: -1 } }],
        complete: true,
      }).success,
    ).toBe(false);
  });
});
