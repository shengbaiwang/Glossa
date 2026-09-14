import { CFI, TOCItem } from '@/libs/document';
import { collectAllTocItems } from './grouping';

export const findParentPath = (toc: TOCItem[], href: string): TOCItem[] => {
  for (const item of toc) {
    if (item.href === href) {
      return [item];
    }
    if (item.subitems) {
      const path = findParentPath(item.subitems, href);
      if (path.length) {
        return [item, ...path];
      }
    }
  }
  return [];
};

const findInSubitems = (item: TOCItem, cfi: string): TOCItem | null => {
  if (!item.subitems?.length) return null;
  return findTocItemBS(item.subitems, cfi);
};

export const findTocItemBS = (toc: TOCItem[], cfi: string): TOCItem | null => {
  if (!cfi) return null;
  let left = 0;
  let right = toc.length - 1;
  let result: TOCItem | null = null;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const item = toc[mid]!;
    const currentCfi = toc[mid]!.cfi || '';
    const comparison = CFI.compare(currentCfi, cfi);
    if (comparison === 0) {
      return findInSubitems(item, cfi) ?? item;
    } else if (comparison < 0) {
      result = findInSubitems(item, cfi) ?? item;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
};

// Chapter jumps follow the TOC rather than raw spine order: a chapter may span
// several spine sections, so renderer.prevSection/nextSection can land
// mid-chapter. Returns null when the current position can't be located or the
// jump runs past either end of the book.
export const findAdjacentTocItem = (toc: TOCItem[], cfi: string, dir: 1 | -1): TOCItem | null => {
  if (!cfi || !toc.length) return null;
  const current = findTocItemBS(toc, cfi);
  if (!current) return null;
  const flat = collectAllTocItems(toc);
  const index = flat.indexOf(current);
  if (index === -1) return null;
  return flat[index + dir] ?? null;
};
