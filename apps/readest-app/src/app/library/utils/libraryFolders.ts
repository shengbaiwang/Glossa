import { Book } from '@/types/book';
import { md5Fingerprint } from '@/utils/md5';

export const folderParent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
export const folderLabel = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const contains = (parent: string, path: string) => path === parent || path.startsWith(`${parent}/`);
export const MAX_FOLDER_DEPTH = 4;
export const folderDepth = (path: string) => (path ? path.split('/').length : 0);

export function orderedFolderPaths(paths: string[]): string[] {
  const visit = (parent: string): string[] =>
    paths.filter((p) => folderParent(p) === parent).flatMap((p) => [p, ...visit(p)]);
  return visit('');
}

/** Empty folders are explicit; book paths also supply implicit and legacy parents. */
export function collectFolderPaths(books: Book[], saved: readonly string[] = []): string[] {
  const paths = new Set<string>();
  const add = (path: string) => {
    const parts = path.split('/');
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
  };
  if (Array.isArray(saved)) {
    for (const path of saved) if (typeof path === 'string' && path.trim()) add(path);
  }
  for (const book of books) if (!book.deletedAt && book.groupName) add(book.groupName);
  return [...paths];
}

function validLabel(label: string): string {
  const name = label.trim();
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[/\\]/.test(name) ||
    name.length > 120 ||
    [...name].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error('Invalid folder name');
  return name;
}

function uniquePath(paths: string[], parent: string, label: string): string {
  const base = parent ? `${parent}/${label}` : label;
  let path = base;
  for (let suffix = 2; paths.includes(path); suffix++) path = `${base} ${suffix}`;
  return path;
}

export function createFolderPath(paths: string[], parent: string, label: string): string {
  const name = validLabel(label.trim() || 'Untitled');
  if (parent && !paths.includes(parent)) throw new Error('Folder not found');
  if (folderDepth(parent) >= MAX_FOLDER_DEPTH) throw new Error('Up to 4 levels');
  return uniquePath(paths, parent, name);
}

export interface FolderChange {
  paths: string[];
  books: Book[];
  replacements?: Map<string, string>;
}

function replaceFolders(
  books: Book[],
  paths: string[],
  replacements: Map<string, string>,
  now: number,
): FolderChange {
  const transformed = paths.map((path) => replacements.get(path) ?? path);
  if (new Set(transformed).size !== transformed.length)
    throw new Error('A folder with this name already exists');
  return {
    paths: transformed,
    replacements,
    books: books.map((book) => {
      const path = !book.deletedAt && book.groupName ? replacements.get(book.groupName) : undefined;
      return path !== undefined && path !== book.groupName
        ? { ...book, groupName: path, groupId: path ? md5Fingerprint(path) : '', updatedAt: now }
        : book;
    }),
  };
}

export function renameFolder(
  books: Book[],
  paths: string[],
  path: string,
  label: string,
  now = Date.now(),
): FolderChange {
  if (!paths.includes(path)) throw new Error('Folder not found');
  const parent = folderParent(path);
  const name = validLabel(label.trim() || folderLabel(path));
  const next = parent ? `${parent}/${name}` : name;
  const replacements = new Map(
    paths.filter((p) => contains(path, p)).map((p) => [p, next + p.slice(path.length)]),
  );
  return replaceFolders(books, paths, replacements, now);
}

/** Folder selections move the subtree; book selections move only the selected books. */
export function moveToFolder(
  books: Book[],
  paths: string[],
  selection: string[],
  destination: string,
  now = Date.now(),
): FolderChange {
  if (destination && !paths.includes(destination)) throw new Error('Folder not found');
  const selected = new Set(selection);
  const selectedPaths = paths.filter((p) => selected.has(md5Fingerprint(p)));
  const roots = selectedPaths.filter(
    (p) => !selectedPaths.some((other) => other !== p && contains(other, p)),
  );
  const replacements = new Map<string, string>();
  for (const root of roots) {
    if (destination && contains(root, destination))
      throw new Error('Cannot move a folder into itself');
    const next = uniquePath(
      [...paths.filter((p) => !roots.some((r) => contains(r, p))), ...replacements.values()],
      destination,
      folderLabel(root),
    );
    for (const path of paths.filter((p) => contains(root, p))) {
      const target = next + path.slice(root.length);
      if (target !== path && folderDepth(target) > MAX_FOLDER_DEPTH)
        throw new Error('Up to 4 levels');
      replacements.set(path, target);
    }
  }
  const result = replaceFolders(books, paths, replacements, now);
  result.books = result.books.map((book, index) =>
    selected.has(book.hash) &&
    !book.deletedAt &&
    !roots.some((root) => contains(root, books[index]?.groupName ?? ''))
      ? {
          ...book,
          groupName: destination,
          groupId: destination ? md5Fingerprint(destination) : '',
          updatedAt: now,
        }
      : book,
  );
  const moved = new Set(replacements.values());
  result.paths = orderedFolderPaths([
    ...result.paths.filter((p) => !moved.has(p)),
    ...result.paths.filter((p) => moved.has(p)),
  ]);
  return result;
}

/** Remove only the container. Promote each child branch without merging names. */
export function removeFolder(
  books: Book[],
  paths: string[],
  path: string,
  now = Date.now(),
): FolderChange {
  if (!paths.includes(path)) throw new Error('Folder not found');
  const parent = folderParent(path);
  const replacements = new Map<string, string>([[path, parent]]);
  const occupied = paths.filter((p) => !contains(path, p));
  for (const child of paths.filter((p) => folderParent(p) === path)) {
    const next = uniquePath(occupied, parent, folderLabel(child));
    for (const descendant of paths.filter((p) => contains(child, p))) {
      const target = next + descendant.slice(child.length);
      replacements.set(descendant, target);
      occupied.push(target);
    }
  }
  const result = replaceFolders(
    books,
    paths.filter((p) => p !== path),
    replacements,
    now,
  );
  return { ...result, paths: orderedFolderPaths(result.paths) };
}

/** Move a whole branch and place it before/after an existing sibling. */
export function placeFolder(
  books: Book[],
  paths: string[],
  path: string,
  anchor: string,
  edge: 'before' | 'after',
): FolderChange {
  if (path === anchor || contains(path, anchor))
    throw new Error('Cannot move a folder into itself');
  if (!paths.includes(anchor)) throw new Error('Folder not found');
  const result = moveToFolder(books, paths, [md5Fingerprint(path)], folderParent(anchor));
  const next = result.replacements?.get(path) ?? path;
  const ordered = orderedFolderPaths(result.paths);
  const branch = ordered.filter((p) => contains(next, p));
  const rest = ordered.filter((p) => !contains(next, p));
  const index =
    edge === 'before' ? rest.indexOf(anchor) : rest.findLastIndex((p) => contains(anchor, p)) + 1;
  rest.splice(index, 0, ...branch);
  return { ...result, paths: rest };
}

/** Resolve deepest containers first, composing one branch change for one safe undo. */
export function removeFolders(books: Book[], paths: string[], selection: string[]): FolderChange {
  let result: FolderChange = { books, paths, replacements: new Map() };
  for (const path of [...new Set(selection)].sort((a, b) => folderDepth(b) - folderDepth(a))) {
    const next = removeFolder(result.books, result.paths, path);
    const replacements = new Map(result.replacements);
    for (const [before, after] of replacements)
      replacements.set(before, next.replacements?.get(after) ?? after);
    for (const [before, after] of next.replacements ?? [])
      if (!replacements.has(before)) replacements.set(before, after);
    result = { ...next, replacements };
  }
  return result;
}
