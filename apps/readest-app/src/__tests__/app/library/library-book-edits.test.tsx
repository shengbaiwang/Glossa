import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLibraryBookEdits } from '@/app/library/hooks/useLibraryBookEdits';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
const mocks = vi.hoisted(() => ({ save: vi.fn(async (_books: Book[]) => {}) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => ({ saveLibraryBooks: mocks.save }) } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
const original: Book = {
  hash: 'original',
  title: 'Original',
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  progress: [3, 100],
  tags: ['old'],
  metadata: { title: 'Embedded', author: 'Author', language: 'en', identifier: 'identity' },
};
const current = () => useLibraryStore.getState().library[0]!;
beforeEach(() => {
  mocks.save.mockReset();
  mocks.save.mockResolvedValue();
  useLibraryStore.setState({ libraryLoaded: true });
  useLibraryStore.getState().setLibrary([original]);
});
afterEach(cleanup);
it('renames without altering identity, raw metadata, progress or personal tags', async () => {
  const { result } = renderHook(useLibraryBookEdits);
  await act(async () => {
    expect(await result.current.apply([original], 'title', ' Personal ')).toBe(true);
  });
  expect(current()).toMatchObject({
    hash: original.hash,
    title: 'Personal',
    author: 'Author',
    progress: [3, 100],
    tags: ['old'],
    metadata: { title: 'Personal', identifier: 'identity' },
  });
  expect(mocks.save).toHaveBeenCalledOnce();
});
it('undo preserves progress saved after the rename', async () => {
  const { result } = renderHook(useLibraryBookEdits);
  await act(async () => {
    await result.current.apply([original], 'title', 'New');
  });
  useLibraryStore
    .getState()
    .setLibrary([{ ...current(), progress: [77, 100], updatedAt: Date.now() + 100 }]);
  await act(async () => {
    await result.current.undo();
  });
  expect(current()).toMatchObject({
    title: original.title,
    progress: [77, 100],
    metadata: original.metadata,
  });
});
it('refuses undo when a newer metadata edit has occurred', async () => {
  const { result } = renderHook(useLibraryBookEdits);
  await act(async () => {
    await result.current.apply([original], 'title', 'New');
  });
  useLibraryStore
    .getState()
    .setLibrary([
      { ...current(), title: 'Other window', metadataUpdatedAt: current().metadataUpdatedAt! + 1 },
    ]);
  await act(async () => {
    await result.current.undo();
  });
  expect(current().title).toBe('Other window');
  expect(mocks.save).toHaveBeenCalledOnce();
});
it('rolls back a failed save and permits retry', async () => {
  const { result } = renderHook(useLibraryBookEdits);
  mocks.save.mockRejectedValueOnce(new Error('disk'));
  await act(async () => {
    expect(await result.current.apply([original], 'title', 'New')).toBe(false);
  });
  expect(current()).toEqual(original);
  await act(async () => {
    expect(await result.current.apply([original], 'title', 'New')).toBe(true);
  });
});
it('updates and restores a batch of statuses without changing reading progress', async () => {
  const second = { ...original, hash: 'second', readingStatus: 'abandoned' as const };
  useLibraryStore.getState().setLibrary([original, second]);
  const { result } = renderHook(useLibraryBookEdits);
  await act(async () => {
    await result.current.apply([original, second], 'readingStatus', 'finished');
  });
  expect(useLibraryStore.getState().library.every((b) => b.readingStatus === 'finished')).toBe(
    true,
  );
  await act(async () => {
    await result.current.undo();
  });
  expect(useLibraryStore.getState().library.map((b) => b.readingStatus)).toEqual([
    undefined,
    'abandoned',
  ]);
  expect(useLibraryStore.getState().library.every((b) => b.progress?.[0] === 3)).toBe(true);
});
it('rejects blank titles and normalizes tags without creating duplicate entries', async () => {
  const { result } = renderHook(useLibraryBookEdits);
  await act(async () => {
    expect(await result.current.apply([original], 'title', '  ')).toBe(false);
    await result.current.apply([original], 'tags', [' history ', 'history', '', 'research']);
  });
  expect(current().tags).toEqual(['history', 'research']);
});
