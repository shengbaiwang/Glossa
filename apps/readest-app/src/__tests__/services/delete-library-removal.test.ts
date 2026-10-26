import { expect, test, vi } from 'vitest';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { deleteAllBooks } from '@/services/deleteLibraryService';

vi.mock('@/libs/user', () => ({ deleteCloudLibrary: vi.fn(async () => {}) }));

test('whole-library deletion uses the recoverable service and keeps every durable row', async () => {
  const rows: Book[] = [
    {
      hash: 'one',
      title: 'One',
      format: 'EPUB',
      author: 'A',
      createdAt: 1,
      updatedAt: 1,
      progress: [2, 10],
      downloadedAt: 1,
    },
  ];
  const files = new Map([['library.json', JSON.stringify(rows)]]);
  const deleteBook = vi.fn();
  const app = {
    deleteBook,
    resolveFilePath: async () => '',
    readFile: async (path: string) => {
      if (!files.has(path)) throw new Error('Missing');
      return files.get(path)!;
    },
    writeFile: async (path: string, _base: string, data: string) => {
      files.set(path, data);
    },
    loadLibraryBooks: async () => rows,
    saveLibraryBooks: vi.fn(),
  } as unknown as AppService;
  await deleteAllBooks(app);
  const persisted = JSON.parse(files.get('library.json')!) as Book[];
  expect(persisted).toHaveLength(1);
  expect(persisted[0]).toMatchObject({
    progress: [2, 10],
    downloadedAt: 1,
    removal: { mode: 'trash', local: 'complete' },
  });
  expect(deleteBook).not.toHaveBeenCalled();
});
