import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLibraryBookEdits } from '@/app/library/hooks/useLibraryBookEdits';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import { getLocalBookFilename } from '@/utils/book';
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
it('rolls back a failed rename while preserving later reading progress', async () => {
  const { result } = renderHook(useLibraryBookEdits);
  let progressUpdatedAt = 0;
  mocks.save.mockImplementationOnce(async () => {
    progressUpdatedAt = current().updatedAt + 100;
    useLibraryStore
      .getState()
      .setLibrary([{ ...current(), progress: [77, 100], updatedAt: progressUpdatedAt }]);
    throw new Error('disk');
  });
  await act(async () => {
    expect(await result.current.apply([original], 'title', 'New')).toBe(false);
  });
  expect(current()).toMatchObject({
    title: original.title,
    metadata: original.metadata,
    progress: [77, 100],
    updatedAt: progressUpdatedAt,
  });
  expect(current().metadataUpdatedAt).toBe(original.metadataUpdatedAt);
  expect(useLibraryStore.getState().libraryLoaded).toBe(true);
});
it('preserves a later metadata edit when an earlier rename fails to save', async () => {
  const { result } = renderHook(useLibraryBookEdits);
  const metadata = { ...original.metadata!, title: 'Other window', author: 'New author' };
  mocks.save.mockImplementationOnce(async () => {
    const updatedAt = current().updatedAt + 100;
    useLibraryStore.getState().setLibrary([
      {
        ...current(),
        title: metadata.title,
        author: metadata.author,
        metadata,
        metadataUpdatedAt: updatedAt,
        updatedAt,
      },
    ]);
    throw new Error('disk');
  });
  await act(async () => {
    expect(await result.current.apply([original], 'title', 'New')).toBe(false);
  });
  expect(current()).toMatchObject({ title: metadata.title, author: metadata.author, metadata });
});
it('rolls back a failed status save without overwriting later metadata or progress', async () => {
  const { result } = renderHook(useLibraryBookEdits);
  const metadata = { ...original.metadata!, title: 'Other window' };
  let updatedAt = 0;
  mocks.save.mockImplementationOnce(async () => {
    updatedAt = current().updatedAt + 100;
    useLibraryStore.getState().setLibrary([
      {
        ...current(),
        title: metadata.title,
        metadata,
        metadataUpdatedAt: updatedAt,
        progress: [77, 100],
        updatedAt,
      },
    ]);
    throw new Error('disk');
  });
  await act(async () => {
    expect(await result.current.apply([original], 'readingStatus', 'finished')).toBe(false);
  });
  expect(current()).toMatchObject({
    title: metadata.title,
    metadata,
    metadataUpdatedAt: updatedAt,
    progress: [77, 100],
    updatedAt,
  });
  expect(current().readingStatus).toBe(original.readingStatus);
  expect(current().readingStatusUpdatedAt).toBe(original.readingStatusUpdatedAt);
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

it('confirms only selected metadata fields and safely undoes without losing reading progress', async () => {
  const { result } = renderHook(useLibraryBookEdits);
  await act(async () => {
    expect(
      await result.current.applyMetadata(original, {
        publisher: 'Local Press',
        translator: 'Translator',
      }),
    ).toBe(true);
  });
  expect(current()).toMatchObject({
    title: 'Original',
    author: 'Author',
    tags: ['old'],
    metadata: {
      title: 'Embedded',
      publisher: 'Local Press',
      translator: 'Translator',
      identifier: 'identity',
    },
  });
  useLibraryStore.getState().setLibrary([{ ...current(), progress: [88, 100] }]);
  await act(async () => {
    await result.current.undo();
  });
  expect(current().metadata).toEqual(original.metadata);
  expect(current().progress).toEqual([88, 100]);
});

it('rejects a stale confirmation and keeps a failed confirmation retryable', async () => {
  const { result } = renderHook(useLibraryBookEdits);
  useLibraryStore
    .getState()
    .setLibrary([{ ...original, metadataUpdatedAt: 3, author: 'Personal author' }]);
  await act(async () => {
    expect(await result.current.applyMetadata(original, { author: 'Detected author' })).toBe(false);
  });
  expect(current().author).toBe('Personal author');
  mocks.save.mockRejectedValueOnce(new Error('disk'));
  const expected = current();
  await act(async () => {
    expect(await result.current.applyMetadata(expected, { publisher: 'Retry Press' })).toBe(false);
  });
  expect(current().metadata?.publisher).toBeUndefined();
  await act(async () => {
    expect(await result.current.applyMetadata(current(), { publisher: 'Retry Press' })).toBe(true);
  });
  expect(current().title).toBe('Original');
});

it('keeps the managed file path when adopting a title on a legacy record', async () => {
  const path = getLocalBookFilename(original);
  const { result } = renderHook(useLibraryBookEdits);
  await act(async () => {
    expect(await result.current.applyMetadata(original, { title: 'Formal title' })).toBe(true);
  });
  expect(current().title).toBe('Formal title');
  expect(getLocalBookFilename(current())).toBe(path);
  await act(async () => {
    await result.current.undo();
  });
  expect(current().title).toBe('Original');
  expect(getLocalBookFilename(current())).toBe(path);
});
