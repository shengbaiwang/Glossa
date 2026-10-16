import { describe, expect, it } from 'vitest';
import {
  LIBRARY_ITEMS_MIME,
  readLibraryItems,
  droppedFolderPath,
  readDroppedWebFiles,
} from '@/app/library/utils/libraryDragDrop';

describe('library drag and drop', () => {
  it('accepts only explicit bounded item ids, never text or malformed payloads', () => {
    const transfer = (value: string) => ({
      getData: (type: string) => (type === LIBRARY_ITEMS_MIME ? value : 'text'),
    });
    expect(readLibraryItems(transfer('["book","folder"]'))).toEqual(['book', 'folder']);
    for (const value of ['text', '{}', '[1]', '[]'])
      expect(readLibraryItems(transfer(value))).toEqual([]);
  });

  it('retains the dropped directory name and enforces two levels before importing', () => {
    expect(droppedFolderPath('文学', '')).toBe('文学');
    expect(droppedFolderPath('文学/小说', '')).toBe('文学/小说');
    expect(droppedFolderPath('小说', '文学')).toBe('文学/小说');
    expect(() => droppedFolderPath('文学/小说/短篇', '')).toThrow('Folders support two levels');
    expect(() => droppedFolderPath('小说', '文学/外国')).toThrow('Folders support two levels');
    expect(() => droppedFolderPath('../小说', '')).toThrow('Invalid folder name');
  });

  it('reads every directory-reader batch and keeps empty folders and supported books', async () => {
    const book = new File(['原创内容'], '散步.epub');
    const leaf = {
      isFile: true,
      isDirectory: false,
      name: book.name,
      file: (ok: (file: File) => void) => ok(book),
    };
    const empty = {
      isFile: false,
      isDirectory: true,
      name: '空目录',
      createReader: () => ({ readEntries: (ok: (entries: unknown[]) => void) => ok([]) }),
    };
    const root = {
      isFile: false,
      isDirectory: true,
      name: '文学',
      createReader: () => {
        const batches = [[leaf], [empty], []];
        return { readEntries: (ok: (entries: unknown[]) => void) => ok(batches.shift() ?? []) };
      },
    };
    const transfer = {
      items: [{ kind: 'file', webkitGetAsEntry: () => root }],
      files: [],
    } as unknown as DataTransfer;
    const result = await readDroppedWebFiles(transfer, '');
    expect(result.folders).toEqual(['文学', '文学/空目录']);
    expect(result.files).toEqual([{ file: book, groupName: '文学' }]);
  });

  it('routes plain dropped files to the explicit destination and ignores unsupported files', async () => {
    const book = new File(['原创'], 'notes.epub');
    const transfer = {
      items: [],
      files: [book, new File(['x'], 'notes.exe')],
    } as unknown as DataTransfer;
    expect(await readDroppedWebFiles(transfer, '文学/小说')).toEqual({
      files: [{ file: book, groupName: '文学/小说' }],
      folders: [],
    });
  });
});
