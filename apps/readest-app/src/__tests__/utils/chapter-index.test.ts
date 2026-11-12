import { describe, expect, it } from 'vitest';
import {
  compareReaderLocators,
  getChapterIndex,
  locatorForCFI,
  retainChapterIndex,
} from 'foliate-js/chapter-index.js';

const cfi = (i: number, offset = 0) => `epubcfi(/6/${2 * (i + 1)}!/4/${2 * (offset + 1)})`;
const node = (id: number, index: number, offset = 0, subitems?: ReturnType<typeof entry>[]) => ({
  ...entry(id, index, offset),
  subitems,
});
const entry = (id: number, index: number, offset: number) => ({
  id,
  href: `s${index}#h${offset}`,
  label: String(id),
  cfi: cfi(index, offset),
});
const bookWith = (toc: ReturnType<typeof node>[]) => ({
  toc,
  sections: Array.from({ length: 5 }, (_, i) => ({
    id: `s${i}`,
    cfi: `epubcfi(/6/${2 * (i + 1)}!)`,
  })),
  splitTOCHref: (href: string) => href.split('#'),
});

describe('shared chapter index', () => {
  it('releases the shared index only after the last view closes, even if the book stays cached', () => {
    const book = bookWith([node(1, 0), node(2, 1)]);
    const releaseFirst = retainChapterIndex(book);
    const releaseLast = retainChapterIndex(book);
    const index = getChapterIndex(book);
    releaseFirst();
    releaseFirst();
    expect(getChapterIndex(book)).toBe(index);
    releaseLast();
    expect(getChapterIndex(book)).not.toBe(index);
  });

  it('uses body order and half-open ranges without reordering the sidebar tree', () => {
    const first = node(1, 1, 0, [entry(2, 1, 2)]);
    const later = node(3, 3);
    const book = bookWith([later, first]);
    const index = getChapterIndex(book);
    expect(index.locate(locatorForCFI(book, cfi(0))).node).toBeNull();
    expect(index.locate(locatorForCFI(book, cfi(1, 1))).node?.item).toBe(first);
    const child = index.locate(locatorForCFI(book, cfi(2))).node!;
    expect(index.path(child.id).map((n) => n.item.id)).toEqual([1, 2]);
    expect(index.range(child.id)?.end?.cfi).toBe(later.cfi);
    expect(index.adjacent(child.id, 1)?.item).toBe(later);
    expect(index.locate(locatorForCFI(book, cfi(3))).node?.item).toBe(later);
    expect(book.toc[0]).toBe(later);
  });

  it('does not assign an ambiguous equal landing to a sibling', () => {
    const a = node(1, 1);
    const b = node(2, 1);
    const book = bookWith([a, b, node(3, 2)]);
    const index = getChapterIndex(book);
    expect(index.byItem(a)?.id).not.toBe(index.byItem(b)?.id);
    expect(index.locate(locatorForCFI(book, cfi(1))).quality).toBe('unknown');
    expect(index.adjacent(index.byItem(a)!.id, 1)?.item.id).toBe(3);
  });

  it('does not carry a chapter over an unlisted nonlinear resource', () => {
    const book = bookWith([node(1, 0), node(2, 3)]);
    Object.assign(book.sections[1]!, { linear: 'no' });
    expect(getChapterIndex(book).locate(locatorForCFI(book, cfi(1))).node).toBeNull();
  });

  it('refines same-page PDF targets only when the loaded page supplies ordered text anchors', () => {
    const a = { id: 1, href: 'a', label: 'A', index: 0 };
    const b = { id: 2, href: 'b', label: 'B', index: 0 };
    const book = {
      toc: [a, b],
      sections: [{ id: 0 }],
      getPDFAnnotationRects: () => {},
      splitTOCHref: () => [0],
      getChapterAnchor: (doc: Document, href: string) => doc.getElementById(href),
    };
    const index = getChapterIndex(book);
    const doc = new DOMParser().parseFromString(
      '<div class="textLayer"><span id="a">First</span><span id="b">Second</span></div>',
      'text/html',
    );
    const aId = index.byItem(a)!.id;
    const bId = index.byItem(b)!.id;
    expect(index.locate(locatorForCFI(book, undefined, 0)).quality).toBe('unknown');
    expect(index.prepareResource(0, doc)).toBe(true);
    const first = index.range(aId)!;
    const second = index.range(bId)!;
    expect(first.end).toBe(second.start);
    expect(index.locate(second.start)).toEqual({ node: index.byItem(b), quality: 'exact' });
    expect(index.adjacent(aId, 1)?.id).toBe(bId);
    expect(
      compareReaderLocators(second.start, locatorForCFI({ ...book }, undefined, 0)!),
    ).toBeNull();
  });
});
