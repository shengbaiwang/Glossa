import { describe, expect, it } from 'vitest';
import {
  buildOutlineCandidates,
  outlineToTOC,
  parseOCRPage,
  moveOutlineBranch,
  changeOutlineLevel,
  removeOutlineEntry,
  OCRContentsLines,
  needsOCRRecovery,
  type OCRPage,
} from '@/services/pdfEnhancement';

describe('local PDF enhancements', () => {
  it.each([
    0.0197, 0.020000000000000018,
  ])('tolerates contents size boundary %s, without admitting genuinely tiny text', (height) => {
    const page: OCRPage = {
      index: 0,
      native: false,
      lines: [
        { text: '辑六 隋唐系列', x: 0.1, y: 0.15, width: 0.6, height, endLine: true },
        {
          text: '樱子 .... 223',
          x: 0.1,
          y: 0.3,
          width: 0.6,
          height: 0.025000000000000022,
          endLine: true,
        },
        {
          text: '南阳关前 .... 225',
          x: 0.1,
          y: 0.4,
          width: 0.6,
          height: 0.025000000000000022,
          endLine: true,
        },
        { text: 'Tiny footer', x: 0.1, y: 0.9, width: 0.6, height: 0.006, endLine: true },
      ],
    };
    expect(OCRContentsLines(page, true)).toEqual([
      '辑六 隋唐系列',
      '樱子 .... 223',
      '南阳关前 .... 225',
    ]);
  });
  it('keeps observed text without character boxes recoverable rather than recording a blank page', () => {
    const page = parseOCRPage(
      {
        index: 2,
        native: false,
        lines: [],
        recognizer: 'vision-multiscale-1',
        emptyReason: 'no_word_boxes',
      },
      2,
    );
    expect(needsOCRRecovery(page)).toBe(true);
  });
  it('retains a bounded recognizer version while accepting legacy OCR checkpoints', () => {
    const legacy = { index: 2, native: false, lines: [] };
    expect(parseOCRPage(legacy, 2)).toEqual(legacy);
    const current = { ...legacy, recognizer: 'vision-multiscale-1' };
    expect(parseOCRPage(current, 2)).toEqual(current);
    expect(parseOCRPage({ ...legacy, recognizer: 'x'.repeat(81) }, 2)).toBeNull();
  });
  it('pairs separately recognized titles and page numbers by geometry without changing OCR reading order', () => {
    const box = (text: string, x: number, y: number, width = 0.3, height = 0.02) => ({
      text,
      x,
      y,
      width,
      height,
      endLine: true,
    });
    const page: OCRPage = {
      index: 0,
      native: false,
      lines: [
        box('第一章 观察与记录', 0.1, 0.2),
        box('第一节', 0.15, 0.25, 0.08),
        box('核对材料的方法', 0.25, 0.25),
        box('第二章 证据与结论', 0.1, 0.32),
        box('３', 0.86, 0.203, 0.04, 0.015),
        box('• 4', 0.84, 0.253, 0.06, 0.015),
        box('。•。', 0.58, 0.21, 0.15, 0.006),
        box('⋯⋯ 5', 0.78, 0.323, 0.12, 0.015),
        box('只有标题没有页码', 0.1, 0.4),
        box('9', 0.86, 0.46, 0.04),
        box('正文里提到的数量为 3', 0.1, 0.5, 0.7),
        box('正文里的数字', 0.1, 0.55, 0.3),
        box('4', 0.405, 0.55, 0.03),
      ],
    };
    const before = structuredClone(page);
    const candidates = buildOutlineCandidates(
      OCRContentsLines(page),
      Array.from({ length: 12 }, (_, i) => String(i + 1)),
      new Map(),
    );
    expect(candidates.map(({ title, pageIndex, level }) => [title, pageIndex, level])).toEqual([
      ['第一章 观察与记录', 2, 0],
      ['第一节 核对材料的方法', 3, 1],
      ['第二章 证据与结论', 4, 0],
    ]);
    expect(page).toEqual(before);
  });

  it('does not use the contents page itself as evidence for a destination', () => {
    const entries = buildOutlineCandidates(
      ['Chapter One .... 1'],
      ['1', '2'],
      new Map([[0, 'Chapter One .... 1']]),
      0,
      new Set([0]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.verified).toBe(false);
  });

  it('normalizes full-width labels and scanned dot leaders, while rejecting number-only rows', () => {
    expect(
      buildOutlineCandidates(
        ['第一章 观察 ⋯•。 ３', ' •318', '正文没有目录页码', 'Section 1.2'],
        ['1', '2', '３'],
        new Map(),
      ).map((e) => [e.title, e.pageIndex]),
    ).toEqual([['第一章 观察', 2]]);
  });
  it('moves and indents complete branches and promotes children when deleting a heading', () => {
    const entries = [
      { title: 'A', pageIndex: 0, level: 0 },
      { title: 'A1', pageIndex: 1, level: 1 },
      { title: 'A11', pageIndex: 2, level: 2 },
      { title: 'B', pageIndex: 3, level: 0 },
      { title: 'B1', pageIndex: 4, level: 1 },
    ];
    const moved = moveOutlineBranch(entries, 0, 1);
    expect(moved.map((e) => e.title)).toEqual(['B', 'B1', 'A', 'A1', 'A11']);
    expect(moved.map((e) => e.level)).toEqual([0, 1, 0, 1, 2]);
    const outdented = changeOutlineLevel(entries, 1, -1);
    expect(outdented.map((e) => e.level)).toEqual([0, 0, 1, 0, 1]);
    expect(changeOutlineLevel(outdented, 1, 1)).toEqual(entries);
    const removed = removeOutlineEntry(entries, 0);
    expect(removed.map((e) => [e.title, e.level])).toEqual([
      ['A1', 0],
      ['A11', 1],
      ['B', 0],
      ['B1', 1],
    ]);
    expect(() => outlineToTOC(moved, 5)).not.toThrow();
    expect(() => outlineToTOC(outdented, 5)).not.toThrow();
  });
  it('rejects invalid OCR coordinates and oversized or mismatched pages', () => {
    const page = {
      index: 2,
      native: false,
      lines: [{ text: 'Readable', x: 0.1, y: 0.2, width: 0.4, height: 0.03 }],
    };
    expect(parseOCRPage(page, 2)).toEqual(page);
    expect(parseOCRPage(page, 1)).toBeNull();
    expect(parseOCRPage({ ...page, lines: [{ ...page.lines[0], x: NaN }] }, 2)).toBeNull();
    expect(parseOCRPage({ ...page, lines: [{ ...page.lines[0], width: 2 }] }, 2)).toBeNull();
    expect(
      parseOCRPage({ ...page, lines: [{ ...page.lines[0], text: 'x'.repeat(10001) }] }, 2),
    ).toBeNull();
  });

  it('maps printed page numbers through actual PDF page labels and verifies headings', () => {
    const labels = ['i', 'ii', '1', '2', '3', '4'];
    const result = buildOutlineCandidates(
      ['第一章 阅读方法 …… 1', '1.1 观察与记录 …… 3', '第二章 没有依据 …… 4'],
      labels,
      new Map([
        [2, '第一章 阅读方法\n正文'],
        [4, '1.1 观察与记录\n正文'],
        [5, '这是另一个标题'],
      ]),
    );
    expect(result.map((x) => [x.title, x.pageIndex, x.level, x.verified])).toEqual([
      ['第一章 阅读方法', 2, 0, true],
      ['1.1 观察与记录', 4, 1, true],
      ['第二章 没有依据', 5, 0, false],
    ]);
  });

  it('does not guess physical pages when printed labels cannot be resolved', () => {
    const result = buildOutlineCandidates(['Chapter One .... 45'], ['1', '2', '3'], new Map());
    expect(result).toEqual([]);
  });

  it('creates stable page destinations and nested unique IDs without changing page indices', () => {
    const toc = outlineToTOC(
      [
        { title: 'Chapter', pageIndex: 2, level: 0 },
        { title: 'Section', pageIndex: 4, level: 1 },
        { title: 'Next', pageIndex: 5, level: 0 },
      ],
      6,
    );
    expect(toc.map((x) => x.index)).toEqual([2, 5]);
    expect(toc[0]?.subitems?.[0]?.index).toBe(4);
    expect(JSON.parse(toc[0]!.href)[0]).toBe(2);
    expect(toc[0]?.id).not.toBe(toc[0]?.subitems?.[0]?.id);
    expect(() => outlineToTOC([{ title: 'Bad', pageIndex: 6, level: 0 }], 6)).toThrow();
  });
});

it('calibrates mixed printed labels without assuming physical numbering and refuses ambiguous labels', async () => {
  const { calibratePDFPageOffset } = await import('@/services/pdfEnhancement');
  expect(calibratePDFPageOffset(['i', 'ii', '1', '2'], '1', 4)).toBe(1);
  expect(calibratePDFPageOffset(['i', 'ii', '1', '2'], 'II', 2)).toBe(0);
  expect(calibratePDFPageOffset(['1', '1', '2'], '1', 2)).toBeNull();
  expect(calibratePDFPageOffset(['1', '2'], '1', 3)).toBeNull();
});
