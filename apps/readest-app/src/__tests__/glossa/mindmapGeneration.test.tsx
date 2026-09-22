import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ReadingMindmap } from '@/glossa/mindmap/types';

const f = vi.hoisted(() => ({
  generate: vi.fn(),
  expand: vi.fn(),
  read: vi.fn(),
  use: vi.fn(),
  checkpoint: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/glossa/harness/epub', () => ({
  createEpubBookAccess: () => ({
    documentHash: 'book',
    chapters: [{ id: 'chapter', title: 'Chapter one', depth: 0 }],
    readChapter: f.read,
    readAll: f.read,
  }),
}));
vi.mock('@/glossa/mindmap/explore', () => ({
  generateOverviewMap: f.generate,
  expandMapNode: f.expand,
}));
vi.mock('@/glossa/ai/provider', async (original) => ({
  ...(await original<typeof import('@/glossa/ai/provider')>()),
  getActiveProviderConfig: () => ({
    id: 'fixture',
    name: 'Fixture',
    model: 'model',
    baseUrl: 'https://example.test/v1',
  }),
  getProviderStatus: async () => ({ configured: true }),
}));
vi.mock('@/glossa/ui/ConversationModelPicker', () => ({
  default: () => <span>Model picker</span>,
}));
vi.mock('@/glossa/ui/GeneratedMindmapPanel', () => ({
  default: () => <span>Original passage generator</span>,
}));
vi.mock('@/glossa/mindmap/checkpoints', () => ({
  getMapCheckpointKey: async () => 'key',
  mapCheckpointStore: { load: f.checkpoint },
}));
import MindmapGeneration from '@/glossa/ui/MindmapGeneration';
const props = {
  book: { hash: 'book', title: 'Book', format: 'EPUB' } as Book,
  bookDoc: {} as BookDoc,
  bookKey: 'book',
  onUseMap: f.use,
};
beforeEach(() => {
  vi.clearAllMocks();
  f.checkpoint.mockResolvedValue({ checkpoint: null });
});
afterEach(cleanup);

it('waits for an explicit generation request and uses the chosen chapter', async () => {
  f.generate.mockResolvedValue({ id: 'generated' });
  render(<MindmapGeneration {...props} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
    target: { value: 'chapter' },
  });
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Generate mind map' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(f.use).toHaveBeenCalledWith({ id: 'generated' }));
  expect(f.generate.mock.calls[0]![0].target).toEqual({ kind: 'chapter', chapterId: 'chapter' });
});
it('cancels a changed range and discards a late result', async () => {
  let finish!: (map: ReadingMindmap) => void;
  f.generate.mockImplementation(
    () =>
      new Promise<ReadingMindmap>((resolve) => {
        finish = resolve;
      }),
  );
  render(<MindmapGeneration {...props} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Map range' }), {
    target: { value: 'book' },
  });
  const button = screen.getByRole('button', { name: 'Generate mind map' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await screen.findByRole('button', { name: 'Stop' });
  const signal = f.generate.mock.calls[0]![0].signal as AbortSignal;
  fireEvent.change(screen.getByRole('combobox', { name: 'Map range' }), {
    target: { value: 'passage' },
  });
  expect(signal.aborted).toBe(true);
  finish({ id: 'late' } as ReadingMindmap);
  await waitFor(() => expect(screen.getByText('Original passage generator')).toBeTruthy());
  expect(f.use).not.toHaveBeenCalled();
});
it('shows a useful failure and leaves generation available for retry', async () => {
  f.generate.mockRejectedValue(new Error('private provider details'));
  render(<MindmapGeneration {...props} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Map range' }), {
    target: { value: 'book' },
  });
  const button = screen.getByRole('button', { name: 'Generate mind map' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  expect((await screen.findByRole('alert')).textContent).not.toContain('private');
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
});

it('offers saved progress after reopening without reading the book or calling the model', async () => {
  f.checkpoint.mockResolvedValue({ checkpoint: { batches: [{ points: [] }, {}] } });
  render(<MindmapGeneration {...props} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Map range' }), {
    target: { value: 'book' },
  });
  const button = await screen.findByRole('button', { name: 'Continue generation' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  expect(screen.getByRole('status').textContent).toContain('Saved progress');
  expect(f.read).not.toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();
  f.generate.mockResolvedValue({ id: 'resumed' });
  fireEvent.click(button);
  await waitFor(() => expect(f.use).toHaveBeenCalledWith({ id: 'resumed' }));
  expect(f.generate.mock.calls[0]![0].restart).toBe(false);
});
it('starts a fresh attempt only when explicitly requested', async () => {
  f.checkpoint.mockResolvedValue({ checkpoint: { batches: [{ points: [] }, {}] } });
  f.generate.mockResolvedValue({ id: 'fresh' });
  render(<MindmapGeneration {...props} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Map range' }), {
    target: { value: 'book' },
  });
  const restart = await screen.findByRole('button', { name: 'Start again' });
  await waitFor(() => expect(restart.hasAttribute('disabled')).toBe(false));
  fireEvent.click(restart);
  await waitFor(() => expect(f.generate).toHaveBeenCalled());
  expect(f.generate.mock.calls[0]![0].restart).toBe(true);
});
