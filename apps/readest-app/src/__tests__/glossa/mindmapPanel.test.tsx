import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ChapterContent, ChapterSource } from '@/glossa/context/types';
import { type ReadingPassage } from '@/glossa/passages/types';
import type { ReadingMindmap } from '@/glossa/mindmap/types';

const f = vi.hoisted(() => ({
  chapters: vi.fn(),
  extract: vi.fn(),
  passages: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  generate: vi.fn(),
  cacheKey: vi.fn(),
  active: vi.fn(),
  status: vi.fn(),
  resolve: vi.fn(),
  navigate: vi.fn(),
  progress: vi.fn(),
  setBook: vi.fn(),
  setPanel: vi.fn(),
  openSettings: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    key.replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? name)),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      getProgress: f.progress,
      getView: () => ({}),
    }),
  },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      setSettingsDialogBookKey: f.setBook,
      setRequestedPanel: f.setPanel,
      setSettingsDialogOpen: f.openSettings,
    }),
  },
}));
vi.mock('@/glossa/context/chapters', () => ({
  listChapters: f.chapters,
  extractChapter: f.extract,
}));
vi.mock('@/glossa/citations/sources', () => ({ resolveSource: f.resolve }));
vi.mock('@/glossa/citations/navigation', () => ({ navigateSource: f.navigate }));
vi.mock('@/glossa/ai/provider', async (original) => ({
  ModelServiceError: (await original<typeof import('@/glossa/ai/provider')>()).ModelServiceError,
  getActiveProviderConfig: f.active,
  getProviderStatus: f.status,
}));
vi.mock('@/glossa/passages/passages', () => ({ buildReadingPassages: f.passages }));
vi.mock('@/glossa/mindmap/generate', () => ({
  generateMindmap: f.generate,
  getMindmapCacheKey: f.cacheKey,
}));
vi.mock('@/glossa/mindmap/store', () => ({ loadMindmap: f.load, saveMindmap: f.save }));

import MindmapPanel from '@/glossa/ui/MindmapPanel';

const provider = {
  id: 'test',
  name: 'Test service',
  baseUrl: 'https://example.test/v1',
  model: 'guide-model',
};
const chapter = {
  id: 'chapter-one',
  title: 'First chapter',
  href: 'one.xhtml',
  depth: 0,
  sectionIndex: 0,
  start: { sectionIndex: 0 },
};
const source: ChapterSource = {
  sourceId: 's1',
  text: 'The first complete paragraph.',
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: 'source-cfi',
    quote: { exact: 'The first complete paragraph.', prefix: '', suffix: '' },
  },
};
const secondSource: ChapterSource = {
  ...source,
  sourceId: 's2',
  text: 'The second complete paragraph.',
};
const content: ChapterContent = { chapter, sources: [source, secondSource], characterCount: 57 };
const passage: ReadingPassage = {
  id: 'passage-one',
  index: 0,
  title: 'First passage',
  sources: [source],
  characterCount: 28,
  unavailable: false,
};
const secondPassage: ReadingPassage = {
  ...passage,
  id: 'passage-two',
  index: 1,
  title: 'Second passage',
  sources: [secondSource],
};
const guide: ReadingMindmap = {
  id: 'g1',
  bookId: 'book',
  chapterId: chapter.id,
  passageId: passage.id,
  createdAt: '2026-09-10T00:00:00Z',
  cacheKey: 'cache',
  contentHash: 'hash',
  promptVersion: '1',
  schemaVersion: 1,
  provider,
  sources: [source],
  nodes: [
    {
      id: 'root',
      parentId: null,
      label: '问题与解释',
      relation: '',
      explanation: '先辨认问题，再核对解释。',
      sourceIds: ['s1'],
      kind: 'source',
    },
    {
      id: 'reason',
      parentId: 'root',
      label: '理由',
      relation: '需要',
      explanation: '理由支持解释。',
      sourceIds: ['s1'],
      kind: 'source',
    },
    {
      id: 'limit',
      parentId: 'reason',
      label: '适用条件',
      relation: '受限于',
      explanation: '条件限制理由的适用范围。',
      sourceIds: ['s1'],
      kind: 'inference',
    },
  ],
  insufficientEvidence: false,
};
const book: Book = {
  hash: 'book',
  format: 'EPUB',
  title: 'Test book',
  author: 'Test author',
  createdAt: 1,
  updatedAt: 1,
};
const bookDoc = {} as BookDoc;
const mount = () => render(<MindmapPanel book={book} bookDoc={bookDoc} bookKey='book-view' />);
const choosePassage = async () => {
  fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
    target: { value: chapter.id },
  });
  fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
    target: { value: passage.id },
  });
  const button = await screen.findByRole('button', { name: 'Generate mind map' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  return button;
};

beforeEach(() => {
  vi.resetAllMocks();
  f.chapters.mockReturnValue([chapter]);
  f.extract.mockResolvedValue(content);
  f.passages.mockReturnValue([passage, secondPassage]);
  f.load.mockResolvedValue(null);
  f.save.mockResolvedValue(undefined);
  f.cacheKey.mockResolvedValue('cache');
  f.active.mockReturnValue(provider);
  f.status.mockResolvedValue({ configured: true });
  f.generate.mockResolvedValue(guide);
  f.resolve.mockResolvedValue({ text: source.text, cfi: 'verified-cfi', recovered: false });
  f.navigate.mockResolvedValue(undefined);
  f.progress.mockReturnValue({ location: 'origin-cfi' });
});
afterEach(cleanup);

describe('right-side mindmap', () => {
  it('does not jump when a branch source cannot be verified', async () => {
    f.resolve.mockResolvedValue(null);
    mount();
    fireEvent.click(await choosePassage());
    await screen.findByText('Mind map saved on this device.');
    fireEvent.click(screen.getByRole('button', { name: '问题与解释' }));
    await screen.findByRole('alert');
    expect(f.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: 'Source excerpt' }).textContent).toContain(
      source.text,
    );
  });

  it('waits for explicit scope and generation, then exposes relationships and local source navigation', async () => {
    mount();
    await act(async () => {});
    expect(f.extract).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    fireEvent.click(await choosePassage());
    await screen.findByText('Mind map saved on this device.');
    expect(f.generate).toHaveBeenCalledWith(
      expect.objectContaining({ passage, chapterId: chapter.id }),
    );
    expect(screen.getByRole('button', { name: 'Expand 理由' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.queryByRole('button', { name: /适用条件/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand 理由' }));
    expect(f.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '适用条件' }));
    await waitFor(() => expect(f.navigate).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'View source 1' })).toBeNull();
    expect(document.querySelector('.glossa-passage-inference')).toBeNull();
    expect(f.resolve).toHaveBeenCalledWith(bookDoc, source, expect.anything());
    expect(f.navigate).toHaveBeenCalledWith(
      expect.anything(),
      'verified-cfi',
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Return to reading position' }));
    await waitFor(() =>
      expect(f.navigate).toHaveBeenLastCalledWith(
        expect.anything(),
        'origin-cfi',
        expect.any(AbortSignal),
      ),
    );
  });
  it('preserves the generated map after save failure and retries locally', async () => {
    f.save.mockRejectedValueOnce(new Error('private payload'));
    mount();
    fireEvent.click(await choosePassage());
    const retry = await screen.findByRole('button', { name: 'Retry saving mind map' });
    expect(screen.getByRole('button', { name: '问题与解释' })).toBeTruthy();
    expect(screen.queryByText('private payload')).toBeNull();
    fireEvent.click(retry);
    await screen.findByText('Mind map saved on this device.');
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite a map after a load failure', async () => {
    f.load.mockRejectedValueOnce(new Error('corrupt')).mockResolvedValueOnce(guide);
    mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
      target: { value: passage.id },
    });
    const retry = await screen.findByRole('button', { name: 'Retry loading mind map' });
    expect(screen.getByRole('button', { name: 'Generate mind map' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.click(retry);
    await screen.findByRole('button', { name: '问题与解释' });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  });
  it('cancels on close and discards a late model result', async () => {
    let finish!: (value: ReadingMindmap) => void;
    f.generate.mockImplementation(
      () =>
        new Promise<ReadingMindmap>((resolve) => {
          finish = resolve;
        }),
    );
    const panel = mount();
    fireEvent.click(await choosePassage());
    const signal = f.generate.mock.calls[0]![0].signal as AbortSignal;
    panel.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(guide));
    expect(f.save).not.toHaveBeenCalled();
  });
  it('shows model text as inert text and can fold the whole tree', async () => {
    f.generate.mockResolvedValue({
      ...guide,
      nodes: [
        { ...guide.nodes[0]!, label: '<img src=x onerror=alert(1)>' },
        ...guide.nodes.slice(1),
      ],
    });
    mount();
    fireEvent.click(await choosePassage());
    await screen.findByText('Mind map saved on this device.');
    expect(document.querySelector('.glossa-mindmap img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByRole('button', { name: '适用条件' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse branches' }));
    expect(screen.queryByRole('button', { name: '理由' })).toBeNull();
  });
});
