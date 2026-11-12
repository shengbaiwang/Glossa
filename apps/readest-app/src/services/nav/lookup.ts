import type { BookDoc, TOCItem } from '@/libs/document';
import {
  getChapterIndex,
  getStandaloneChapterIndex,
  locatorForCFI,
} from 'foliate-js/chapter-index.js';

export { getChapterIndex, locatorForCFI };
export type { ReaderLocator } from 'foliate-js/chapter-index.js';

export const findParentPath = (toc: TOCItem[], href: string, chapterId?: string): TOCItem[] => {
  const index = getStandaloneChapterIndex(toc);
  const node = chapterId ? index.node(chapterId) : index.byHref(href);
  return node ? index.path(node.id).map(({ item }) => item) : [];
};

export const chapterAt = (book: BookDoc, cfi: string) =>
  getChapterIndex(book).locate(locatorForCFI(book, cfi)).node;

export const findTocItemBS = (toc: TOCItem[], cfi: string, book?: BookDoc | null): TOCItem | null =>
  (book
    ? chapterAt(book, cfi)
    : getStandaloneChapterIndex(toc).locate(locatorForCFI(undefined, cfi)).node
  )?.item ?? null;

export const findAdjacentTocItem = (toc: TOCItem[], cfi: string, dir: 1 | -1): TOCItem | null => {
  const index = getStandaloneChapterIndex(toc);
  const { node } = index.locate(locatorForCFI(undefined, cfi));
  return node ? (index.adjacent(node.id, dir)?.item ?? null) : null;
};
