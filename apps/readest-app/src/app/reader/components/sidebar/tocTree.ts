import { TOCItem } from '@/libs/document';
import { getStandaloneChapterIndex, type ChapterIndex } from 'foliate-js/chapter-index.js';

export const getItemIdentifier = (item: TOCItem) => {
  const href = item.href || '';
  return `toc-item-${item.id}-${href}`;
};

// Decide which TOC nodes to auto-expand. Only the ancestors of the current
// reading location are "necessary" — expanding just that path reveals where
// the reader is while leaving the rest of a deep, multi-volume hierarchy
// collapsed and easy to scan (issue #4059). When there's no resolvable reading
// position yet, keep everything collapsed, except a lone wrapping root
// container — otherwise the sidebar would show a single uninformative row.
export const computeExpandedSet = (
  toc: TOCItem[],
  href: string | undefined,
  chapterId?: string,
  keyOf = getItemIdentifier,
  index: ChapterIndex<TOCItem> = getStandaloneChapterIndex(toc),
): Set<string> => {
  const active = (chapterId && index.node(chapterId)) || (href && index.byHref(href));
  const parents = active ? index.path(active.id).map(({ item }) => keyOf(item)) : [];
  if (parents.length) return new Set(parents);
  if (toc.length === 1 && toc[0]?.subitems?.length) {
    return new Set([keyOf(toc[0])]);
  }
  return new Set();
};
