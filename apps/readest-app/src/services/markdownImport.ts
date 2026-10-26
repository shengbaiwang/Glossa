import type { FileSystem } from '@/types/system';
import { resolveMarkdownResourcePath, snapshotMarkdownFile } from '@/utils/mdResources';

/** Follow no symlinks below the explicit folder grant. No network or implicit
 * parent-directory discovery: single-file imports retain missing-image feedback. */
export async function snapshotMarkdownImport(
  fs: FileSystem,
  file: File,
  filename: string,
  root: string,
  signal?: AbortSignal,
): Promise<File> {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!fs.lstat || base.split('/').includes('..')) return file;
  const inspect = fs.lstat.bind(fs);
  return snapshotMarkdownFile(
    file,
    async (src) => {
      const path = resolveMarkdownResourcePath(base, filename, src);
      if (!path) return null;
      let current = base;
      for (const part of ['', ...path.slice(base.length + 1).split('/')]) {
        signal?.throwIfAborted();
        if (part) current += '/' + part;
        const info = await inspect(current, 'None');
        if (info.isSymlink) return null;
      }
      return fs.openFile(path, 'None');
    },
    signal,
  );
}
