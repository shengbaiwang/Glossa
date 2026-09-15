import { describe, expect, it } from 'vitest';
import type { TOCItem } from '@/libs/document';
import { getChapterSearchRange, findCfiTextOffset } from '@/utils/chapterSearch';

const item = (label: string, cfi: string, subitems?: TOCItem[]): TOCItem =>
  ({ id: 0, label, cfi, href: label, subitems }) as TOCItem;
describe('chapter search bounds', () => {
  it('spans files up to the next peer and includes descendants of the selected entry', () => {
    const toc = [
      item('One', 'epubcfi(/6/2!/4)', [item('Sub', 'epubcfi(/6/4!/4)')]),
      item('Two', 'epubcfi(/6/8!/4)'),
    ];
    expect(getChapterSearchRange(toc, 'epubcfi(/6/2!/4/2)')).toMatchObject({
      start: 'epubcfi(/6/2!/4)',
      end: 'epubcfi(/6/8!/4)',
      label: 'One',
    });
    expect(getChapterSearchRange(toc, 'epubcfi(/6/6!/4)')).toMatchObject({
      start: 'epubcfi(/6/4!/4)',
      end: 'epubcfi(/6/8!/4)',
      label: 'Sub',
    });
    expect(getChapterSearchRange(toc, 'epubcfi(/6/8!/4/2)')?.end).toBeUndefined();
  });
  it('does not invent a chapter when navigation is absent or invalid', () => {
    expect(getChapterSearchRange([], '')).toBeNull();
    expect(getChapterSearchRange([item('bad', '')], 'garbage')).toBeNull();
  });
  it('locates the first text offset at a CFI boundary, including text length', () => {
    const cfiAt = (n: number) => `epubcfi(/6/2!/4/1:${n})`;
    expect(findCfiTextOffset(100, cfiAt(47), cfiAt)).toBe(47);
    expect(findCfiTextOffset(100, 'epubcfi(/6/4!/4)', cfiAt)).toBe(100);
    expect(findCfiTextOffset(100, 'epubcfi(/6/2!/2)', cfiAt)).toBe(0);
  });
});
