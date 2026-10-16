import { describe, expect, it } from 'vitest';
import {
  buildOutlineCandidates,
  outlineToTOC,
  parseOCRPage,
  moveOutlineBranch,
  changeOutlineLevel,
  removeOutlineEntry,
} from '@/services/pdfEnhancement';

describe('local PDF enhancements', () => {
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
