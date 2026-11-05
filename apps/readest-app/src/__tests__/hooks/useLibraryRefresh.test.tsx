import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import { useLibraryRefresh } from '@/hooks/useLibraryRefresh';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';

let receive: ((event?: { data: unknown }) => void) | null = null;
const close = vi.fn();
vi.stubGlobal(
  'BroadcastChannel',
  class {
    constructor(private name: string) {}
    set onmessage(fn: (event?: { data: unknown }) => void) {
      if (this.name === 'glossa-library-updated') receive = fn;
    }
    close = close;
  },
);
afterEach(() => {
  cleanup();
  receive = null;
  vi.clearAllMocks();
});
const book = {
  hash: 'test',
  title: 'Original',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
} as Book;
it('coalesces bursts and discards a snapshot invalidated while loading', async () => {
  useLibraryStore.getState().setLibrary([book]);
  let finish!: (books: Book[]) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Book[]>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue([{ ...book, progress: [1, 4], updatedAt: 3 }]);
  const view = renderHook(() => useLibraryRefresh({ loadLibraryBooks: load }));
  act(() => receive!());
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  act(() => {
    receive!();
    window.dispatchEvent(new Event('focus'));
  });
  expect(load).toHaveBeenCalledOnce();
  await act(async () => finish([book]));
  await waitFor(() => expect(useLibraryStore.getState().library[0]?.progress).toEqual([1, 4]));
  view.unmount();
  window.dispatchEvent(new Event('focus'));
  expect(load).toHaveBeenCalledTimes(2);
});
it('reads only notified identities and keeps unrelated artwork and membership', async () => {
  const other = { ...book, hash: 'other', coverImageUrl: 'blob:stable' };
  useLibraryStore.getState().setLibrary([book, other], true);
  const load = vi.fn().mockResolvedValue([{ ...book, progress: [2, 4], updatedAt: 4 }]);
  renderHook(() => useLibraryRefresh({ loadLibraryBooks: load }));
  act(() => receive!({ data: { hashes: ['test'] } }));
  await waitFor(() => expect(useLibraryStore.getState().library[0]?.progress).toEqual([2, 4]));
  expect(load).toHaveBeenCalledWith(['test']);
  expect(useLibraryStore.getState().library[1]?.coverImageUrl).toBe('blob:stable');
});
it('retains the shelf on failure and recovers on a later refresh', async () => {
  useLibraryStore.getState().setLibrary([book]);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error('disk unavailable'))
    .mockResolvedValue([book]);
  renderHook(() => useLibraryRefresh({ loadLibraryBooks: load }));
  act(() => receive!());
  await waitFor(() => expect(warning).toHaveBeenCalled());
  expect(useLibraryStore.getState().library[0]).toEqual(book);
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  warning.mockRestore();
});

it('carries invalidated identities into the follow-up subset read', async () => {
  useLibraryStore.getState().setLibrary([book, { ...book, hash: 'other' }], true);
  let finish!: (books: Book[]) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Book[]>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue([{ ...book, updatedAt: 5 }]);
  renderHook(() => useLibraryRefresh({ loadLibraryBooks: load }));
  act(() => receive!({ data: { hashes: ['test'] } }));
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  act(() => receive!({ data: { hashes: ['other'] } }));
  await act(async () => finish([book]));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  expect(new Set(load.mock.calls[1]![0])).toEqual(new Set(['test', 'other']));
});
