import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import { useLibraryRefresh } from '@/hooks/useLibraryRefresh';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';

let receive: (() => void) | null = null;
const close = vi.fn();
vi.stubGlobal(
  'BroadcastChannel',
  class {
    set onmessage(fn: () => void) {
      receive = fn;
    }
    close = close;
  },
);
afterEach(() => {
  cleanup();
  receive = null;
  vi.clearAllMocks();
});
it('refreshes reader progress while open and discards out-of-order reloads', async () => {
  const book = {
    hash: 'test',
    title: 'Original',
    format: 'EPUB',
    createdAt: 1,
    updatedAt: 1,
  } as Book;
  useLibraryStore.getState().setLibrary([book]);
  useLibraryStore.setState({ libraryLoaded: false });
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
  act(() => {
    receive!();
    window.dispatchEvent(new Event('focus'));
  });
  await waitFor(() => expect(useLibraryStore.getState().library[0]?.progress).toEqual([1, 4]));
  expect(useLibraryStore.getState().libraryLoaded).toBe(true);
  await act(async () => finish([book]));
  expect(useLibraryStore.getState().library[0]?.progress).toEqual([1, 4]);
  view.unmount();
  expect(close).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('focus'));
  expect(load).toHaveBeenCalledTimes(2);
});
