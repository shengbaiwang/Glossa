import { describe, expect, it } from 'vitest';
import type { TOCItem } from '@/libs/document';
import { findAdjacentTocItem } from '@/services/nav';

const item = (label: string, cfi: string, subitems?: TOCItem[]): TOCItem =>
  ({
    id: 0,
    label,
    href: `${label}.xhtml`,
    cfi,
    ...(subitems ? { subitems } : {}),
  }) as TOCItem;

// Flat chapter list: front matter, then three chapters in spine order.
const flatToc = () => [
  item('front', 'epubcfi(/6/2!/2)'),
  item('ch1', 'epubcfi(/6/4!/2)'),
  item('ch2', 'epubcfi(/6/6!/2)'),
  item('ch3', 'epubcfi(/6/8!/2)'),
];

// Nested: ch1 carries two section-level subitems.
const nestedToc = () => [
  item('ch1', 'epubcfi(/6/4!/2)', [item('s1', 'epubcfi(/6/4!/4)'), item('s2', 'epubcfi(/6/4!/6)')]),
  item('ch2', 'epubcfi(/6/6!/2)'),
];

describe('findAdjacentTocItem', () => {
  it('returns the next and previous chapter for a position inside a chapter', () => {
    const toc = flatToc();
    const insideCh2 = 'epubcfi(/6/6!/4/2)';
    expect(findAdjacentTocItem(toc, insideCh2, 1)?.label).toBe('ch3');
    expect(findAdjacentTocItem(toc, insideCh2, -1)?.label).toBe('ch1');
  });

  it('returns null past either end of the book', () => {
    const toc = flatToc();
    expect(findAdjacentTocItem(toc, 'epubcfi(/6/2!/2)', -1)).toBeNull();
    expect(findAdjacentTocItem(toc, 'epubcfi(/6/8!/4)', 1)).toBeNull();
  });

  it('returns null without a position or TOC', () => {
    expect(findAdjacentTocItem(flatToc(), '', 1)).toBeNull();
    expect(findAdjacentTocItem([], 'epubcfi(/6/4!/2)', 1)).toBeNull();
  });

  it('returns null for a position before the first TOC item', () => {
    expect(findAdjacentTocItem(flatToc(), 'epubcfi(/6/1)', 1)).toBeNull();
  });

  it('follows the flattened order through nested subitems', () => {
    const toc = nestedToc();
    // Inside s2: next is ch2, previous is s1.
    expect(findAdjacentTocItem(toc, 'epubcfi(/6/4!/6/2)', 1)?.label).toBe('ch2');
    expect(findAdjacentTocItem(toc, 'epubcfi(/6/4!/6/2)', -1)?.label).toBe('s1');
    // Inside ch1 before s1: next steps into the first subitem.
    expect(findAdjacentTocItem(toc, 'epubcfi(/6/4!/2/2)', 1)?.label).toBe('s1');
  });
});
