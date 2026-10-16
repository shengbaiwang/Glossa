import { SelectedFile } from '@/hooks/useFileSelector';
import { SUPPORTED_BOOK_EXTS } from '@/services/constants';
import { createFolderPath } from './libraryFolders';

export const LIBRARY_ITEMS_MIME = 'application/x-glossa-library-items';

export function readLibraryItems(transfer: Pick<DataTransfer, 'getData'>): string[] {
  try {
    const ids: unknown = JSON.parse(transfer.getData(LIBRARY_ITEMS_MIME));
    return Array.isArray(ids) &&
      ids.length <= 10000 &&
      ids.every((id) => typeof id === 'string' && id.length > 0 && id.length < 256)
      ? [...new Set(ids)]
      : [];
  } catch {
    return [];
  }
}

/** Validate the whole imported path before any book or folder is saved. */
export function droppedFolderPath(relative: string, destination: string): string {
  let path = destination;
  for (const name of relative.replace(/\\/g, '/').split('/')) {
    path = createFolderPath(path ? [path] : [], path, name);
  }
  return path;
}

export const isSupportedDrop = (name: string) =>
  SUPPORTED_BOOK_EXTS.includes(name.split('.').pop()?.toLowerCase() ?? '');

export async function readDroppedWebFiles(transfer: DataTransfer, destination: string) {
  // Capture entries synchronously: the browser clears the drag data store after drop returns.
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => ({
      entry: item.webkitGetAsEntry?.() ?? null,
      file: item.getAsFile?.() ?? null,
    }));
  const fallback = Array.from(transfer.files);
  const files: SelectedFile[] = [];
  const folders: string[] = [];
  const read = async (entry: FileSystemEntry, parent: string): Promise<void> => {
    if (entry.isFile) {
      if (!isSupportedDrop(entry.name)) return;
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      files.push({ file, groupName: parent });
    } else if (entry.isDirectory) {
      const path = droppedFolderPath(entry.name, parent);
      folders.push(path);
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await read(child, path);
      }
    }
  };
  if (entries.some(({ entry, file }) => entry || file)) {
    for (const { entry, file } of entries) {
      if (entry?.isDirectory) await read(entry, destination);
      else if (file) {
        if (isSupportedDrop(file.name)) files.push({ file, groupName: destination });
      } else if (entry) await read(entry, destination);
    }
  } else {
    for (const file of fallback)
      if (isSupportedDrop(file.name)) files.push({ file, groupName: destination });
  }
  return { files, folders };
}
