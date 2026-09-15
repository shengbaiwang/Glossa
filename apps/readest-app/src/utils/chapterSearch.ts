import * as CFI from 'foliate-js/epubcfi.js';
import type { TOCItem } from '@/libs/document';

export interface ChapterSearchRange {
  start: string;
  end?: string;
  label: string;
}

// Follow the deepest directory entry at the reading position. Its range includes
// descendants and ends at the next peer/ancestor, even across spine files.
export function getChapterSearchRange(
  toc: TOCItem[],
  location: string | undefined,
): ChapterSearchRange | null {
  if (!location?.startsWith('epubcfi(')) return null;
  const entries: { item: TOCItem; depth: number }[] = [];
  const walk = (items: TOCItem[], depth: number) => {
    for (const item of items) {
      if (item.cfi?.startsWith('epubcfi(')) entries.push({ item, depth });
      if (item.subitems) walk(item.subitems, depth + 1);
    }
  };
  walk(toc, 0);
  try {
    let current = -1;
    const point = CFI.collapse(location);
    for (let i = 0; i < entries.length; i++) {
      if (CFI.compare(entries[i]!.item.cfi!, point) <= 0) current = i;
    }
    const entry = entries[current];
    if (!entry) return null;
    const next = entries.slice(current + 1).find((candidate) => candidate.depth <= entry.depth);
    return { start: entry.item.cfi!, end: next?.item.cfi, label: entry.item.label };
  } catch {
    return null;
  }
}

// Binary search in the same text walker used by matching and CFI recovery.
export function findCfiTextOffset(
  length: number,
  boundary: string,
  cfiAt: (offset: number) => string,
): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (CFI.compare(cfiAt(mid), CFI.collapse(boundary)) < 0) low = mid + 1;
    else high = mid;
  }
  return low;
}

// Check both ends: a multiword match must not cross into the next chapter.
export function isMatchInChapter(cfi: string, chapter: ChapterSearchRange): boolean {
  if (!cfi.startsWith('epubcfi(')) return false;
  try {
    const start = CFI.collapse(cfi);
    const end = CFI.collapse(cfi, true);
    return (
      CFI.compare(start, chapter.start) >= 0 &&
      (!chapter.end || (CFI.compare(start, chapter.end) < 0 && CFI.compare(end, chapter.end) <= 0))
    );
  } catch {
    return false;
  }
}
