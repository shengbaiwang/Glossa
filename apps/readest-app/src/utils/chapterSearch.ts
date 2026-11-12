import * as CFI from 'foliate-js/epubcfi.js';
import type { BookDoc, TOCItem } from '@/libs/document';
import {
  getChapterIndex,
  getStandaloneChapterIndex,
  locatorForCFI,
} from 'foliate-js/chapter-index.js';

export interface ChapterSearchRange {
  start: string;
  end?: string;
  startIndex?: number;
  endIndex?: number;
  label: string;
}

// Follow the deepest directory entry at the reading position. Its range includes
// descendants and ends at the next peer/ancestor, even across spine files.
export function getChapterSearchRange(
  source: BookDoc | TOCItem[],
  location: string | undefined,
  chapterId?: string,
): ChapterSearchRange | null {
  if (!location?.startsWith('epubcfi(')) return null;
  const book = Array.isArray(source) ? undefined : source;
  const index = Array.isArray(source) ? getStandaloneChapterIndex(source) : getChapterIndex(source);
  const node =
    (chapterId && index.node(chapterId)) || index.locate(locatorForCFI(book, location)).node;
  if (!node) return null;
  const bounds = index.range(node.id);
  if (!bounds || bounds.quality !== 'exact' || !bounds.start.cfi || (bounds.end && !bounds.end.cfi))
    return null;
  return {
    start: bounds.start.cfi,
    end: bounds.end?.cfi,
    label: node.item.label,
    ...(book
      ? { startIndex: bounds.start.resourceIndex, endIndex: bounds.end?.resourceIndex }
      : {}),
  };
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
