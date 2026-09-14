import * as CFI from 'foliate-js/epubcfi.js';

import { BookNote } from '@/types/book';
import { uniqueId } from '@/utils/misc';

// `CFI.parse` silently yields an empty path for non-CFI strings, which then
// compares "equal" to everything — reject anything that isn't an epubcfi
// before parsing so garbage input can never match a location.
export const isCanonicalCfi = (cfi: string): boolean => {
  const match = cfi.match(CFI.isCFI);
  return !!match && match[1]!.length > 0;
};

/**
 * Extract the excerpt a reader actually sees on the bookmarked page.
 *
 * The legacy bookmark code read `range.startContainer.textContent`, which
 * ignores both range offsets and returns the whole text of the boundary node —
 * when a page starts at an element boundary that text came from the beginning
 * of the chapter, producing summaries that never matched the bookmarked page.
 *
 * `Range.toString()` respects both offsets and spans across nodes, so it is
 * exactly the visible page text. Whitespace runs are collapsed so excerpts
 * render as compact prose regardless of the document's source formatting.
 */
export const extractBookmarkExcerpt = (
  range: Range | null | undefined,
  maxLength = 128,
): string => {
  const raw = typeof range?.toString === 'function' ? range.toString() : '';
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
};

/**
 * Whether `cfi` points into the page described by the visible-range `location`.
 *
 * Both CFIs are parsed and compared as canonical CFI points — the bookmark is
 * identified by where it starts. The legacy implementation additionally
 * accepted any CFI whose *string* extended the location's, which matched
 * unrelated positions that merely shared a prefix (e.g. offset 5 vs 55).
 */
export const isCfiAtLocation = (
  cfi: string | null | undefined,
  location: string | null | undefined,
): boolean => {
  if (!cfi || !location || !isCanonicalCfi(cfi) || !isCanonicalCfi(location)) return false;
  if (cfi === location) return true;
  try {
    const point = CFI.collapse(cfi);
    const start = CFI.collapse(location);
    const end = CFI.collapse(location, true);
    return CFI.compare(point, start) >= 0 && CFI.compare(point, end) <= 0;
  } catch {
    return false;
  }
};

/**
 * Batched variant of {@link isCfiAtLocation}: the visible-range bounds are
 * collapsed once for the whole list instead of twice per entry, matching the
 * pattern of `createCfiLocationMatcher` in utils/cfi for hot loops over many
 * notes. Input may contain entries without a usable cfi; they are skipped.
 */
export const findBookmarksAtLocation = (
  bookmarks: BookNote[],
  location: string | null | undefined,
): BookNote[] => {
  if (!location || !isCanonicalCfi(location) || bookmarks.length === 0) return [];
  let start: string;
  let end: string;
  try {
    start = CFI.collapse(location);
    end = CFI.collapse(location, true);
  } catch {
    return [];
  }
  return bookmarks.filter((bookmark) => {
    if (!bookmark?.cfi || !isCanonicalCfi(bookmark.cfi)) return false;
    try {
      const point = CFI.collapse(bookmark.cfi);
      return CFI.compare(point, start) >= 0 && CFI.compare(point, end) <= 0;
    } catch {
      return false;
    }
  });
};

export interface CreateBookmarkParams {
  cfi: string;
  text: string;
  page?: number;
  now: number;
}

/**
 * Build a bookmark record. The shape and storage location (the book config's
 * `booknotes` list) are the stable sync protocol — old bookmarks and synced
 * records stay readable without migration.
 */
export const createBookmark = ({ cfi, text, page, now }: CreateBookmarkParams): BookNote => ({
  id: uniqueId(),
  type: 'bookmark',
  cfi,
  text,
  note: '',
  page,
  createdAt: now,
  updatedAt: now,
});
