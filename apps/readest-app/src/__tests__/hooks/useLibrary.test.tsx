import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';

const mocks = vi.hoisted(() => ({ load: vi.fn(), settings: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {
      getAppService: async () => ({ loadLibraryBooks: mocks.load, loadSettings: mocks.settings }),
    },
  }),
}));
vi.mock('@/store/readerStore', async () => {
  const { create } = await import('zustand');
  return { useReaderStore: create(() => ({ viewStates: {} })) };
});
vi.mock('@/store/settingsStore', async () => {
  const { create } = await import('zustand');
  return {
    useSettingsStore: create((set) => ({
      settings: { libraryFolders: [] },
      setSettings: (settings: unknown) => set({ settings }),
    })),
  };
});
import { useLibrary } from '@/hooks/useLibrary';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';

const book = (hash: string, extra: Partial<Book> = {}): Book => ({
  hash,
  title: hash,
  author: '',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({
    library: [],
    libraryLoaded: false,
    hashIndex: new Map(),
    visibleLibrary: [],
  });
  useReaderStore.setState({ viewStates: {} });
  mocks.settings.mockResolvedValue({ libraryFolders: [] });
});
afterEach(cleanup);

it('allows the requested book before a full library load and keeps partial state explicitly incomplete', async () => {
  let complete!: (books: Book[]) => void;
  mocks.load.mockImplementation((hashes?: string[]) =>
    hashes
      ? Promise.resolve([book('a')])
      : new Promise<Book[]>((resolve) => {
          complete = resolve;
        }),
  );
  const hook = renderHook(() => useLibrary(['a']));
  await waitFor(() => expect(hook.result.current.libraryLoaded).toBe(true));
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith(['a']);
  expect(useLibraryStore.getState().getBookByHash('a')?.hash).toBe('a');
  expect(useLibraryStore.getState().libraryLoaded).toBe(false);

  act(() =>
    useReaderStore.setState({ viewStates: { 'a-view': { key: 'a-view', inited: true } } } as never),
  );
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  act(() => useLibraryStore.getState().updateBookProgress('a', [3, 9], undefined));
  const changedAt = useLibraryStore.getState().getBookByHash('a')!.updatedAt;
  // Reader config saves and other ordinary mutations use setLibrary without
  // claiming that the currently loaded subset is the entire library.
  act(() => useLibraryStore.getState().setLibrary([...useLibraryStore.getState().library]));
  expect(useLibraryStore.getState().libraryLoaded).toBe(false);
  await act(async () => complete([book('a'), book('b')]));
  expect(useLibraryStore.getState().libraryLoaded).toBe(true);
  expect(useLibraryStore.getState().library).toHaveLength(2);
  expect(useLibraryStore.getState().getBookByHash('a')).toMatchObject({
    progress: [3, 9],
    updatedAt: changedAt,
  });
});

it('preserves normal full-library loading and already loaded transient book records', async () => {
  mocks.load.mockResolvedValue([book('a'), book('b')]);
  const hook = renderHook(() => useLibrary());
  await waitFor(() => expect(hook.result.current.libraryLoaded).toBe(true));
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith();
  hook.unmount();
  useLibraryStore.getState().setLibrary([book('streamed')]);
  const second = renderHook(() => useLibrary(['streamed']));
  expect(second.result.current.libraryLoaded).toBe(true);
  expect(mocks.load).toHaveBeenCalledTimes(1);
});

it('cancels queued full-library work when the reader unmounts before the next paint', async () => {
  mocks.load.mockResolvedValue([book('a')]);
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 123);
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  try {
    const hook = renderHook(() => useLibrary(['a']));
    await waitFor(() => expect(hook.result.current.libraryLoaded).toBe(true));
    act(() =>
      useReaderStore.setState({
        viewStates: { 'a-view': { key: 'a-view', inited: true } },
      } as never),
    );
    expect(frame).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    hook.unmount();
    expect(cancel).toHaveBeenCalledWith(123);
    expect(mocks.load).toHaveBeenCalledTimes(1);
  } finally {
    frame.mockRestore();
    cancel.mockRestore();
  }
});

it('discards a late full-library response after the reader closes', async () => {
  let complete!: (books: Book[]) => void;
  mocks.load.mockImplementation((hashes?: string[]) =>
    hashes
      ? Promise.resolve([book('a')])
      : new Promise<Book[]>((resolve) => {
          complete = resolve;
        }),
  );
  const hook = renderHook(() => useLibrary(['a']));
  await waitFor(() => expect(hook.result.current.libraryLoaded).toBe(true));
  act(() =>
    useReaderStore.setState({ viewStates: { 'a-view': { key: 'a-view', inited: true } } } as never),
  );
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  hook.unmount();
  await act(async () => complete([book('a'), book('b')]));
  expect(useLibraryStore.getState().libraryLoaded).toBe(false);
  expect(useLibraryStore.getState().library.map((row) => row.hash)).toEqual(['a']);
});

it('loads the new route and discards a pending response from the previous route', async () => {
  const pending = new Map<string, (books: Book[]) => void>();
  mocks.load.mockImplementation(
    (hashes: string[]) =>
      new Promise<Book[]>((resolve) => {
        pending.set(hashes[0]!, resolve);
      }),
  );
  const hook = renderHook(({ ids }) => useLibrary(ids), { initialProps: { ids: ['a'] } });
  await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(['a']));
  hook.rerender({ ids: ['b'] });
  await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(['b']));
  await act(async () => pending.get('b')!([book('b')]));
  expect(hook.result.current.libraryLoaded).toBe(true);
  await act(async () => pending.get('a')!([book('a')]));
  expect(useLibraryStore.getState().library.map((row) => row.hash)).toEqual(['b']);
});

it('waits for each route while avoiding duplicate loads for new arrays of the same IDs', async () => {
  let complete!: (books: Book[]) => void;
  mocks.load.mockImplementation((hashes: string[]) =>
    hashes[0] === 'a'
      ? Promise.resolve([book('a')])
      : new Promise<Book[]>((resolve) => {
          complete = resolve;
        }),
  );
  const hook = renderHook(({ ids }) => useLibrary(ids), { initialProps: { ids: ['a'] } });
  await waitFor(() => expect(hook.result.current.libraryLoaded).toBe(true));
  hook.rerender({ ids: ['b'] });
  expect(hook.result.current.libraryLoaded).toBe(false);
  await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(['b']));
  hook.rerender({ ids: ['b'] });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  await act(async () => complete([book('b')]));
  expect(hook.result.current.libraryLoaded).toBe(true);
});

it('discards a late initial response after the reader closes', async () => {
  let complete!: (books: Book[]) => void;
  mocks.load.mockImplementation(
    () =>
      new Promise<Book[]>((resolve) => {
        complete = resolve;
      }),
  );
  const hook = renderHook(() => useLibrary(['a']));
  await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(['a']));
  hook.unmount();
  await act(async () => complete([book('a')]));
  expect(useLibraryStore.getState().library).toEqual([]);
});

it('uses complete disk membership while retaining transient books and records added during the read', async () => {
  let complete!: (books: Book[]) => void;
  const transient = book('transient', { filePath: '/opened.epub', deletedAt: 1 });
  useLibraryStore.getState().setLibrary([book('stale'), transient], false);
  mocks.load.mockImplementation((hashes?: string[]) =>
    hashes
      ? Promise.resolve([book('a')])
      : new Promise<Book[]>((resolve) => {
          complete = resolve;
        }),
  );
  const hook = renderHook(() => useLibrary(['a']));
  await waitFor(() => expect(hook.result.current.libraryLoaded).toBe(true));
  act(() =>
    useReaderStore.setState({ viewStates: { 'a-view': { key: 'a-view', inited: true } } } as never),
  );
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  act(() =>
    useLibraryStore
      .getState()
      .setLibrary([...useLibraryStore.getState().library, book('imported')], false),
  );
  await act(async () => complete([book('a', { deletedAt: 3, updatedAt: 3 })]));
  expect(useLibraryStore.getState().getBookByHash('stale')).toBeUndefined();
  expect(useLibraryStore.getState().getBookByHash('transient')).toEqual(transient);
  expect(useLibraryStore.getState().getBookByHash('imported')?.hash).toBe('imported');
  expect(useLibraryStore.getState().getBookByHash('a')?.deletedAt).toBe(3);
});
