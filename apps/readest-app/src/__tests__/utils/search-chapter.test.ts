import { describe, expect, it } from 'vitest';
import { getChapterSearchRange as getSearchChapter, isMatchInChapter } from '@/utils/chapterSearch';
import type { TOCItem } from '@/libs/document';
const item = (label: string, cfi: string, subitems?: TOCItem[]): TOCItem => ({
  id: 0,
  index: 0,
  label,
  href: label,
  cfi,
  subitems,
});
const toc = [
  item('One', 'epubcfi(/6/2!/4/2)'),
  item('Two', 'epubcfi(/6/8!/4/6)'),
  item('Three', 'epubcfi(/6/8!/4/12)'),
];
describe('search chapter boundaries', () => {
  it('includes all spine files in a chapter and excludes the next heading', () => {
    const chapter = getSearchChapter(toc, 'epubcfi(/6/4!/4/2)');
    expect(chapter?.label).toBe('One');
    expect(isMatchInChapter('epubcfi(/6/6!/4/2,/1:0,/1:3)', chapter!)).toBe(true);
    expect(isMatchInChapter('epubcfi(/6/8!/4/6,/1:0,/1:3)', chapter!)).toBe(false);
  });
  it('excludes neighboring chapters within the same file and crossing matches', () => {
    const chapter = getSearchChapter(toc, 'epubcfi(/6/8!/4/8)')!;
    expect(isMatchInChapter('epubcfi(/6/8!/4/2)', chapter)).toBe(false);
    expect(isMatchInChapter('epubcfi(/6/8!/4/8)', chapter)).toBe(true);
    expect(isMatchInChapter('epubcfi(/6/8!/4,/8/1:0,/12/1:3)', chapter)).toBe(false);
  });
  it('uses the deepest current entry and includes its descendants before the next sibling', () => {
    const nested = [
      item('One', 'epubcfi(/6/2!/4/2)', [
        item('A', 'epubcfi(/6/2!/4/4)'),
        item('B', 'epubcfi(/6/2!/4/8)'),
      ]),
      toc[1]!,
    ];
    expect(getSearchChapter(nested, 'epubcfi(/6/2!/4/2/1:0)')?.end).toBe(toc[1]!.cfi);
    expect(getSearchChapter(nested, 'epubcfi(/6/2!/4/6)')?.end).toBe('epubcfi(/6/2!/4/8)');
  });
  it('returns no chapter when position or usable TOC is missing', () => {
    expect(getSearchChapter(toc, undefined)).toBeNull();
    expect(getSearchChapter([], 'epubcfi(/6/2!/4)')).toBeNull();
    expect(getSearchChapter(toc, 'invalid')).toBeNull();
  });
});
