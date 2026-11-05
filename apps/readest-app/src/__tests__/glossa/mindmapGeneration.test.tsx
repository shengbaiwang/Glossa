import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ReadingMindmap } from '@/glossa/mindmap/types';
import type { ProviderConfig } from '@/glossa/ai/provider';

const f = vi.hoisted(() => ({
  generate: vi.fn(),
  expand: vi.fn(),
  read: vi.fn(),
  use: vi.fn(),
  checkpoint: vi.fn(),
  config: {} as ProviderConfig,
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
  getActiveProviderConfig: () => ({ ...f.config }),
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
import { MODEL_SETTINGS_EVENT } from '@/glossa/ai/provider';
const props = {
  book: { hash: 'book', title: 'Book', format: 'EPUB' } as Book,
  bookDoc: {} as BookDoc,
  bookKey: 'book',
  onUseMap: f.use,
};
beforeEach(() => {
  vi.clearAllMocks();
  f.use.mockReset();
  f.config = {
    id: 'fixture',
    name: 'Fixture',
    model: 'model',
    baseUrl: 'https://example.test/v1',
  };
  f.checkpoint.mockResolvedValue({ checkpoint: null });
});
afterEach(cleanup);

it('offers only chapter and whole-book generation ranges', () => {
  render(<MindmapGeneration {...props} />);
  const range = screen.getByRole('combobox', { name: 'Map range' }) as HTMLSelectElement;
  expect(Array.from(range.options, (option) => option.value)).toEqual(['chapter', 'book']);
});

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
    target: { value: 'chapter' },
  });
  expect(signal.aborted).toBe(true);
  finish({ id: 'late' } as ReadingMindmap);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Chapter' })).toBeTruthy());
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

it('labels zero progress as a retry and restores a safe validation error without model work', async () => {
  f.checkpoint.mockResolvedValue({
    checkpoint: {
      batches: [
        {
          failure: {
            kind: 'sources',
            issues: [{ path: ['nodes', 'sourceIds'], rule: 'source_whitelist' }],
          },
        },
      ],
    },
  });
  render(<MindmapGeneration {...props} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Map range' }), {
    target: { value: 'book' },
  });
  await screen.findByRole('button', { name: 'Retry generation' });
  expect((await screen.findByRole('alert')).textContent).toContain('outside the supplied evidence');
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});

it('keeps a generated map available after unrelated settings updates and a service rename', async () => {
  const map = { id: 'generated-awaiting-save' } as ReadingMindmap;
  f.generate.mockResolvedValue(map);
  f.use.mockImplementationOnce(() => {
    throw new Error('Synthetic save failure');
  });
  render(<MindmapGeneration {...props} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Map range' }), {
    target: { value: 'book' },
  });
  const generate = screen.getByRole('button', { name: 'Generate mind map' });
  await waitFor(() => expect(generate.hasAttribute('disabled')).toBe(false));
  fireEvent.click(generate);
  await screen.findByRole('button', { name: 'Use generated map' });
  const saveError = screen.getByRole('alert').textContent;
  const checkpointReads = f.checkpoint.mock.calls.length;
  await act(async () => {
    window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
  });
  f.config = { ...f.config, name: 'Renamed service' };
  await act(async () => {
    window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
  });
  expect(screen.getByRole('alert').textContent).toBe(saveError);
  fireEvent.click(screen.getByRole('button', { name: 'Use generated map' }));
  expect(f.use).toHaveBeenCalledTimes(2);
  expect(f.use).toHaveBeenLastCalledWith(map);
  expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.checkpoint).toHaveBeenCalledTimes(checkpointReads);
});

it.each([
  'model',
  'capabilities',
])('keeps active work on an unchanged default, but cancels a changed mind-map %s', async (change) => {
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
  const generate = screen.getByRole('button', { name: 'Generate mind map' });
  await waitFor(() => expect(generate.hasAttribute('disabled')).toBe(false));
  fireEvent.click(generate);
  await screen.findByRole('button', { name: 'Stop' });
  const signal = f.generate.mock.calls[0]![0].signal as AbortSignal;
  await act(async () => {
    window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
  });
  expect(signal.aborted).toBe(false);
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  f.config =
    change === 'model'
      ? { ...f.config, model: 'another-model' }
      : { ...f.config, capabilityOverrides: { json: false } };
  await act(async () => {
    window.dispatchEvent(new Event(MODEL_SETTINGS_EVENT));
    finish({ id: 'stale-map' } as ReadingMindmap);
  });
  expect(signal.aborted).toBe(true);
  expect(f.use).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Use generated map' })).toBeNull();
});
