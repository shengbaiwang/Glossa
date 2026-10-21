import { join } from '@tauri-apps/api/path';
import { isContentURI, isFileURI, isValidURL } from './misc';

export const getFilename = (fileOrUri: string) => {
  const uri = isValidURL(fileOrUri) || isContentURI(fileOrUri) || isFileURI(fileOrUri);
  if (uri) {
    fileOrUri = fileOrUri.split('?')[0]!;
    fileOrUri = decodeURI(fileOrUri);
  }
  const normalizedPath = fileOrUri.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  const lastPart = parts.pop()!;
  return lastPart;
};

export const getBaseFilename = (filename: string) => {
  const normalizedPath = filename.replace(/\\/g, '/');
  const name = normalizedPath.split('/').pop() || '';

  const parts = name.split('.');
  if (parts.length <= 1) {
    return name;
  }

  return parts.slice(0, -1).join('.');
};

export const getDirPath = (filePath: string) => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  parts.pop();
  return parts.join('/');
};

/**
 * Group name a book imported from a folder belongs to: its directory made
 * relative to the *parent* of `basePath`, so the imported folder itself
 * becomes the top-level group ("Books") and every subfolder nests under it
 * ("Books/SciFi"). Books sitting loose in `basePath` get the folder's own
 * group. Backslashes are normalized, so Windows paths derive the same names.
 */
export const getFolderImportGroupName = (filePath: string, basePath: string) => {
  const root = basePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const directory = getDirPath(filePath);
  if (directory !== root && !directory.startsWith(`${root}/`)) return '';
  const name = getFilename(root);
  return name + directory.slice(root.length);
};

export const joinPaths = async (...paths: string[]) => {
  return await join(...paths);
};

/**
 * Join a folder root with a relative path returned by a directory scan, using
 * the root's own separator style. Equivalent to {@link joinPaths} for these
 * inputs (native-form root from the folder picker, host-separator relative
 * path from the scan) but pure string work — no IPC round-trip. That matters
 * when the watched-folder scan joins hundreds of paths on every window focus
 * (issue #5494).
 */
export const joinScannedPath = (root: string, relativePath: string) => {
  const sep = root.includes('\\') ? '\\' : '/';
  return root.replace(/[\\/]+$/, '') + sep + relativePath;
};
