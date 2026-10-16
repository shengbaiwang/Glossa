import { Book } from '@/types/book';
import { md5Fingerprint } from '@/utils/md5';

export const folderParent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
export const folderLabel = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const contains = (parent: string, path: string) => path === parent || path.startsWith(`${parent}/`);

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
    [...name].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error('Invalid folder name');
  return name;
}

export function createFolderPath(paths: string[], parent: string, label: string): string {
  const name = validLabel(label);
  if (parent && !paths.includes(parent)) throw new Error('Folder not found');
  if (parent.includes('/')) throw new Error('Folders support two levels');
  const path = parent ? `${parent}/${name}` : name;
  if (paths.includes(path)) throw new Error('A folder with this name already exists');
  return path;
}

export interface FolderChange {
  paths: string[];
  books: Book[];
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
  const name = validLabel(label);
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
    const next = destination ? `${destination}/${folderLabel(root)}` : folderLabel(root);
    for (const path of paths.filter((p) => contains(root, p))) {
      const target = next + path.slice(root.length);
      if (target !== path && target.split('/').length > 2)
        throw new Error('Folders support two levels');
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
  return result;
}
