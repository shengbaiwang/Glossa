import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import SavedMindmaps from '@/glossa/ui/SavedMindmaps';
const f = vi.hoisted(() => ({
  list: vi.fn(),
  resolve: vi.fn(),
  navigate: vi.fn(),
  reveal: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/glossa/mindmap/store', () => ({ listSavedMindmaps: f.list }));
vi.mock('@/glossa/citations/sources', () => ({ resolveSource: f.resolve }));
vi.mock('@/glossa/citations/navigation', () => ({ navigateGuideSource: f.navigate }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({ getView: () => ({}), getProgress: () => ({ location: 'origin-cfi' }) }),
  },
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  f.list.mockResolvedValue([
    {
      id: 'old',
      createdAt: '2026-09-12T00:00:00Z',
      nodes: [
        {
          id: 'root',
          parentId: null,
          label: 'Verified idea',
          relation: '',
          explanation: 'Original statement',
          kind: 'source',
          sourceIds: ['s1'],
        },
      ],
      sources: [{ sourceId: 's1', text: 'Original statement' }],
      insufficientEvidence: false,
    },
  ]);
  f.resolve.mockResolvedValue({ cfi: 'verified-cfi' });
  f.navigate.mockResolvedValue(undefined);
});
const mount = () =>
  render(
    <SavedMindmaps
      book={{ hash: 'book' } as Book}
      bookDoc={{} as BookDoc}
      bookKey='view'
      onNavigate={f.reveal}
    />,
  );
it('verifies before navigating and returns to the original position', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Verified idea' }));
  await waitFor(() =>
    expect(f.navigate).toHaveBeenCalledWith({}, 'verified-cfi', expect.any(AbortSignal)),
  );
  expect(f.reveal).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Back to reading position' }));
  await waitFor(() =>
    expect(f.navigate).toHaveBeenLastCalledWith({}, 'origin-cfi', expect.any(AbortSignal)),
  );
});
it('refuses unverified locations and cancels work when the archive closes', async () => {
  f.resolve.mockResolvedValueOnce(null);
  const view = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Verified idea' }));
  await screen.findByRole('alert');
  expect(f.navigate).not.toHaveBeenCalled();
  let finish: ((value: { cfi: string }) => void) | undefined;
  f.resolve.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Verified idea' }));
  const signal = f.resolve.mock.calls.at(-1)?.[2].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  finish?.({ cfi: 'late-cfi' });
  await Promise.resolve();
  expect(f.navigate).not.toHaveBeenCalled();
});
