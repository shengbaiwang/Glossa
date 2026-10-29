import { create } from 'zustand';
import type { Book } from '@/types/book';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { md5Fingerprint } from '@/utils/md5';
import { collectFolderPaths } from './libraryFolders';

export type LibraryTransfer = {
  selection: string[];
  roots: string[];
  paths: string[];
  books: { hash: string; group: string }[];
};
const contains = (root: string, path: string) => path === root || path.startsWith(`${root}/`);

/** Capture identities and membership only, never personal metadata or file bytes. */
export function captureLibraryTransfer(
  books: Book[],
  paths: string[],
  ids: string[],
): LibraryTransfer | undefined {
  const selection = [...new Set(ids)];
  const selected = new Set(selection);
  const live = books.filter((book) => !book.deletedAt);
  const known = new Set([...live.map((book) => book.hash), ...paths.map(md5Fingerprint)]);
  if (!selection.length || selection.some((id) => !known.has(id))) return;
  const groups = paths.filter((path) => selected.has(md5Fingerprint(path)));
  const roots = groups.filter(
    (path) => !groups.some((other) => other !== path && contains(other, path)),
  );
  return {
    selection,
    roots,
    paths: paths.filter((path) => roots.some((root) => contains(root, path))).sort(),
    books: live
      .filter(
        (book) =>
          selected.has(book.hash) || roots.some((root) => contains(root, book.groupName ?? '')),
      )
      .map((book) => ({ hash: book.hash, group: book.groupName ?? '' }))
      .sort((a, b) => a.hash.localeCompare(b.hash)),
  };
}

export function isLibraryTransferCurrent(
  snapshot: LibraryTransfer | undefined,
  books: Book[],
  paths: string[],
): snapshot is LibraryTransfer {
  if (!snapshot) return false;
  const current = captureLibraryTransfer(books, paths, snapshot.selection);
  return (
    !!current &&
    JSON.stringify(current.paths) === JSON.stringify(snapshot.paths) &&
    JSON.stringify(current.books) === JSON.stringify(snapshot.books)
  );
}

/** The move clipboard is local to this library session; it never duplicates book records. */
export const useLibraryTransfer = create<{
  clipboard?: LibraryTransfer;
  drag?: LibraryTransfer;
  dragAccepted: boolean;
  restores: Map<string, () => void>;
}>(() => ({ dragAccepted: false, restores: new Map() }));

export function captureCurrentLibraryTransfer(ids: string[]) {
  const books = useLibraryStore.getState().library;
  return captureLibraryTransfer(
    books,
    collectFolderPaths(books, useSettingsStore.getState().settings.libraryFolders),
    ids,
  );
}

export function cutLibraryItems(ids: string[]) {
  const clipboard = captureCurrentLibraryTransfer(ids);
  if (clipboard) useLibraryTransfer.setState({ clipboard });
}

export function startLibraryDrag(ids: string[]) {
  useLibraryTransfer.setState({
    drag: captureCurrentLibraryTransfer(ids),
    dragAccepted: false,
    restores: new Map(),
  });
}

export function finishLibraryDrag(saved = false) {
  const state = useLibraryTransfer.getState();
  if (!saved) for (const restore of state.restores.values()) restore();
  useLibraryTransfer.setState({ drag: undefined, dragAccepted: false, restores: new Map() });
}
