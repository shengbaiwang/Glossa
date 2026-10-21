import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { getLocalBookFilename } from '@/utils/book';

const persistence = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/services/persistence', () => ({
  safeLoadJSON: persistence.load,
  safeSaveJSON: persistence.save,
}));

import { loadLibraryBooks } from '@/services/libraryService';

function legacy(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'legacy-hash',
    metaHash: 'legacy-metahash',
    format: 'PDF',
    title: 'ssreader',
    sourceTitle: 'ssreader',
    author: 'ssreader',
    metadata: { title: 'ssreader', author: 'ssreader', language: 'zh' },
    filePath: '/Library/马基雅维里主义.pdf',
    createdAt: 1000,
    updatedAt: 2000,
    groupId: 'personal',
    progress: [17, 200],
    ...overrides,
  };
}

const fs = { exists: vi.fn().mockResolvedValue(true), createDir: vi.fn() } as unknown as FileSystem;
const cover = vi.fn().mockResolvedValue('cover-url');

beforeEach(() => vi.clearAllMocks());

describe('legacy imported metadata repair when loading the library', () => {
  it('repairs the display fields without changing identity, raw metadata, timestamps or storage paths', async () => {
    const book = legacy();
    const original = structuredClone(book);
    const filename = getLocalBookFilename(book);
    persistence.load.mockResolvedValue([book]);
    const [loaded] = await loadLibraryBooks(fs, cover);
    expect(loaded?.title).toBe('马基雅维里主义');
    expect(loaded?.author).toBe('');
    expect(loaded).toEqual({
      ...original,
      title: '马基雅维里主义',
      author: '',
      coverImageUrl: 'cover-url',
    });
    expect(getLocalBookFilename(loaded!)).toBe(filename);
    expect(persistence.save).not.toHaveBeenCalled();
  });

  it('keeps the original storage name when an old row has no sourceTitle', async () => {
    const book = legacy({ sourceTitle: undefined });
    const filename = getLocalBookFilename(book);
    persistence.load.mockResolvedValue([book]);
    const [loaded] = await loadLibraryBooks(fs, cover);
    expect(loaded?.title).toBe('马基雅维里主义');
    expect(getLocalBookFilename(loaded!)).toBe(filename);
  });

  it.each([
    { title: '我的自定义书名', author: '我的作者' },
    { metadataUpdatedAt: 1500 },
    { deletedAt: 1500 },
    { metadata: undefined },
  ] satisfies Partial<Book>[])('protects edited, deleted or unverified records: %j', async (overrides) => {
    const book = legacy(overrides);
    const original = structuredClone(book);
    persistence.load.mockResolvedValue([book]);
    const [loaded] = await loadLibraryBooks(fs, cover);
    expect(loaded).toEqual({ ...original, coverImageUrl: 'cover-url' });
  });

  it('does not invent a title when the original filename is unavailable', async () => {
    persistence.load.mockResolvedValue([legacy({ filePath: undefined })]);
    const [loaded] = await loadLibraryBooks(fs, cover);
    expect(loaded?.title).toBe('ssreader');
  });

  it('is idempotent after the corrected row is normally saved and loaded again', async () => {
    persistence.load.mockResolvedValue([legacy()]);
    const [first] = await loadLibraryBooks(fs, cover);
    persistence.load.mockResolvedValue([structuredClone(first)]);
    const [second] = await loadLibraryBooks(fs, cover);
    expect(second).toEqual(first);
  });
});
