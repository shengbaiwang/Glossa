import type { Book } from '@/types/book';
export type ReadingSpace = 'leisure' | 'academic';
export type ReadingSpaceScope = ReadingSpace | 'all';
export const READING_SPACES = ['leisure', 'academic'] as const;
export const SPACE_LABELS = {
  leisure: 'Leisure',
  academic: 'Academic',
  all: 'All spaces',
} as const;
/** Re-enter a view without replaying one-shot import or deep-link actions. */
export function readingSpaceView(query: string): string {
  const allowed = new Set([
    'groupBy',
    'group',
    'section',
    'q',
    'search',
    'mode',
    'nearby',
    'matchCase',
    'matchDiacritics',
    'sort',
    'thenSort',
    'order',
    'thenOrder',
    'view',
    'cover',
  ]);
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) if (!allowed.has(key)) params.delete(key);
  return params.toString();
}
export function readingSpaces(book: Pick<Book, 'readingSpaces'>): ReadingSpace[] {
  const values = Array.isArray(book.readingSpaces) ? book.readingSpaces : [];
  const spaces = READING_SPACES.filter((space) => values.includes(space));
  return spaces.length ? spaces : ['leisure'];
}
export const bookInReadingSpace = (book: Book, space: ReadingSpaceScope) =>
  space === 'all' || readingSpaces(book).includes(space);
const KEY = 'glossa:reading-space';
export function readReadingSpace(): ReadingSpaceScope {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'academic' || value === 'all') return value;
  } catch {
    /* A blocked preference store must not block reading. */
  }
  return 'leisure';
}
export function saveReadingSpace(space: ReadingSpaceScope) {
  try {
    localStorage.setItem(KEY, space);
  } catch {
    /* Session choice remains usable. */
  }
}

/** Keep shared group identities while hiding branches used only by the other space.
 * Truly empty groups stay reachable, including immediately after creation. */
export function readingSpaceFolders(
  books: Book[],
  paths: string[],
  space: ReadingSpaceScope,
): string[] {
  if (space === 'all') return paths;
  const occupied = new Set<string>();
  const visible = new Set<string>();
  for (const book of books) {
    if (book.deletedAt || !book.groupName) continue;
    const parts = book.groupName.split('/');
    const belongs = bookInReadingSpace(book, space);
    for (let depth = 1; depth <= parts.length; depth++) {
      const path = parts.slice(0, depth).join('/');
      occupied.add(path);
      if (belongs) visible.add(path);
    }
  }
  return paths.filter((path) => !occupied.has(path) || visible.has(path));
}
