import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMap } from '@/glossa/mindmap/workspace';
import { useMapWorkspace } from '@/glossa/mindmap/workspaceSession';
import { MapStorageConflict } from '@/glossa/mindmap/workspaceStore';
const f = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/glossa/mindmap/workspaceStore', () => ({
  loadMapWorkspace: f.load,
  saveMapWorkspace: f.save,
  MapStorageConflict: class extends Error {},
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  f.load.mockImplementation(async (bookId: string) => ({
    version: 1,
    bookId,
    revision: 0,
    activeId: null,
    maps: [],
  }));
  f.save.mockResolvedValue(undefined);
});
it('keeps failed writes across close/reopen, retries and preserves undo', async () => {
  const id = crypto.randomUUID();
  const hook = renderHook(() => useMapWorkspace(id));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  f.save.mockRejectedValue(new Error('disk full'));
  const map = createMap('Kept');
  act(() => hook.result.current.update((data) => ({ ...data, maps: [map], activeId: map.id })));
  await waitFor(() => expect(hook.result.current.status).toBe('error'));
  hook.unmount();
  const reopened = renderHook(() => useMapWorkspace(id));
  expect(reopened.result.current.data?.maps[0]?.nodes[0]?.label).toBe('Kept');
  expect(f.load).toHaveBeenCalledTimes(1);
  f.save.mockResolvedValue(undefined);
  await act(() => reopened.result.current.retry());
  expect(reopened.result.current.status).toBe('ready');
  act(() => reopened.result.current.undo());
  expect(reopened.result.current.data?.maps).toEqual([]);
  act(() => reopened.result.current.undo(true));
  expect(reopened.result.current.data?.maps[0]?.id).toBe(map.id);
});
it('blocks corruption replacement and retries reading without creating a blank workspace', async () => {
  f.load.mockRejectedValueOnce(new Error('corrupt'));
  const id = crypto.randomUUID();
  const hook = renderHook(() => useMapWorkspace(id));
  await waitFor(() => expect(hook.result.current.status).toBe('error'));
  act(() => hook.result.current.update((data) => ({ ...data, maps: [] })));
  expect(hook.result.current.data).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
  await act(() => hook.result.current.retry());
  expect(hook.result.current.status).toBe('ready');
});
it('coalesces in-flight edits in sequence and refuses to overwrite a conflicting window', async () => {
  const id = crypto.randomUUID();
  const hook = renderHook(() => useMapWorkspace(id));
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  let finish: (() => void) | undefined;
  f.save.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = createMap('First');
  const second = createMap('Second');
  act(() => hook.result.current.update((data) => ({ ...data, maps: [first], activeId: first.id })));
  act(() =>
    hook.result.current.update((data) => ({ ...data, maps: [first, second], activeId: second.id })),
  );
  expect(f.save).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish?.();
  });
  expect(f.save.mock.calls[1]?.[0].revision).toBe(1);
  expect(f.save.mock.calls[1]?.[0].maps).toHaveLength(2);
  f.save.mockRejectedValueOnce(new MapStorageConflict());
  act(() => hook.result.current.update((data) => ({ ...data, activeId: first.id })));
  await waitFor(() => expect(hook.result.current.status).toBe('conflict'));
  const count = f.save.mock.calls.length;
  act(() => hook.result.current.undo());
  await act(() => hook.result.current.retry());
  expect(f.save).toHaveBeenCalledTimes(count);
});
