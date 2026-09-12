import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ChapterContent, ChapterSource } from '@/glossa/context/types';
import { GuideError, type ReadingGuide, type ReadingPassage } from '@/glossa/guide/types';
import { ModelServiceError } from '@/glossa/ai/provider';

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
vi.mock('@/glossa/citations/navigation', () => ({ navigateGuideSource: f.navigate }));
vi.mock('@/glossa/ai/provider', async (original) => ({
  ModelServiceError: (await original<typeof import('@/glossa/ai/provider')>()).ModelServiceError,
  getActiveProviderConfig: f.active,
  getProviderStatus: f.status,
}));
vi.mock('@/glossa/guide/passages', () => ({ buildReadingPassages: f.passages }));
vi.mock('@/glossa/guide/generate', () => ({
  generateReadingGuide: f.generate,
  getReadingGuideCacheKey: f.cacheKey,
}));
vi.mock('@/glossa/guide/store', () => ({ loadReadingGuide: f.load, saveReadingGuide: f.save }));

import ReadingGuidePanel from '@/glossa/ui/ReadingGuidePanel';

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
const guide: ReadingGuide = {
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
  orientation: [
    { text: 'Follow the reason before the conclusion.', sourceIds: ['s1'], kind: 'source' },
  ],
  difficulties: [
    {
      title: 'Why this step follows',
      explanation: {
        text: 'This is an explanatory analogy.',
        kind: 'inference',
        sourceIds: ['s1'],
      },
    },
  ],
  readingCue: {
    text: 'Read the next sentence with this reason in mind.',
    sourceIds: ['s1'],
    kind: 'source',
  },
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
const mount = () => render(<ReadingGuidePanel book={book} bookDoc={bookDoc} bookKey='book-view' />);
const choosePassage = async () => {
  fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
    target: { value: chapter.id },
  });
  fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
    target: { value: passage.id },
  });
  const button = await screen.findByRole('button', { name: 'Generate guide' });
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

describe('Reading guide', () => {
  it('shows bounded recovery and clears its notice when recovery fails', async () => {
    let fail!: (error: Error) => void;
    f.generate.mockImplementation(({ onRetry }) => {
      onRetry();
      return new Promise((_, reject) => {
        fail = reject;
      });
    });
    mount();
    fireEvent.click(await choosePassage());
    await screen.findByText('The response was cut short. Retrying with more room…');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await act(async () => fail(new ModelServiceError('Recovery failed.')));
    await screen.findByRole('alert');
    expect(screen.queryByText('The response was cut short. Retrying with more room…')).toBeNull();
    expect(f.save).not.toHaveBeenCalled();
  });
  it('opens only the local contents and requires separate chapter, passage and generation choices', async () => {
    mount();
    await act(async () => {});
    expect((screen.getByRole('combobox', { name: 'Chapter' }) as HTMLSelectElement).value).toBe('');
    expect(f.extract).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    const selector = await screen.findByRole('combobox', { name: 'Passage' });
    expect((selector as HTMLSelectElement).value).toBe('');
    expect(f.load).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    fireEvent.change(selector, { target: { value: passage.id } });
    const generate = await screen.findByRole('button', { name: 'Generate guide' });
    await waitFor(() => expect(generate.hasAttribute('disabled')).toBe(false));
    expect(screen.getByText(/Only this passage will be sent to Test service/)).toBeTruthy();
    expect(f.generate).not.toHaveBeenCalled();
    expect(
      screen.queryByText(
        'Choose the passage you are reading. Start with a short guide, then unfold only what needs explaining.',
      ),
    ).toBeNull();
    const range = screen.getByText('Passage 1 · 28 characters').closest('details')!;
    expect(range.open).toBe(true);
    fireEvent.click(generate);
    await screen.findByText(guide.orientation[0]!.text);
    expect(f.generate).toHaveBeenCalledWith(
      expect.objectContaining({ passage, chapterId: chapter.id }),
    );
    expect(f.save).toHaveBeenCalledWith(guide, expect.any(AbortSignal));
    expect(range.open).toBe(false);
    fireEvent.click(screen.getByText('Passage 1 · 28 characters'));
    expect(range.open).toBe(true);
    expect(screen.getByText('Why this step follows').closest('details')?.open).toBe(false);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('blocks generation after saved-guide loading fails and allows a read-only retry', async () => {
    f.load.mockRejectedValueOnce(new Error('private payload')).mockResolvedValueOnce(guide);
    mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
      target: { value: passage.id },
    });
    const retry = await screen.findByRole('button', { name: 'Retry loading guide' });
    expect(screen.getByRole('button', { name: 'Generate guide' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.click(retry);
    await screen.findByText(guide.orientation[0]!.text);
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(screen.queryByText('private payload')).toBeNull();
  });

  it('keeps a generated guide visible after save failure and retries saving without another model call', async () => {
    f.save.mockRejectedValueOnce(new Error('private note')).mockResolvedValueOnce(undefined);
    mount();
    fireEvent.click(await choosePassage());
    fireEvent.click(await screen.findByRole('button', { name: 'Retry saving guide' }));
    await screen.findByText('Guide saved on this device.');
    expect(screen.getByText(guide.orientation[0]!.text)).toBeTruthy();
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('private note')).toBeNull();
  });

  it('keeps the previous valid guide when generation fails and hides unknown error payloads', async () => {
    f.load.mockResolvedValue(guide);
    f.generate.mockRejectedValue(new Error('secret payload'));
    mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
      target: { value: passage.id },
    });
    const button = await screen.findByRole('button', { name: 'Regenerate guide' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    fireEvent.click(button);
    await screen.findByRole('alert');
    expect(screen.getByText(guide.orientation[0]!.text)).toBeTruthy();
    expect(screen.queryByText('secret payload')).toBeNull();
  });

  it('aborts a late generation when the passage changes and does not save or auto-generate the next passage', async () => {
    let finish!: (value: ReadingGuide) => void;
    f.generate.mockImplementation(
      () =>
        new Promise<ReadingGuide>((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    fireEvent.click(await choosePassage());
    const signal = f.generate.mock.calls[0]![0].signal as AbortSignal;
    fireEvent.change(screen.getByRole('combobox', { name: 'Passage' }), {
      target: { value: secondPassage.id },
    });
    expect(signal.aborted).toBe(true);
    await act(async () => finish(guide));
    expect(f.save).not.toHaveBeenCalled();
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(guide.orientation[0]!.text)).toBeNull();
  });

  it('verifies the local source before jumping and supports returning to the reading position', async () => {
    f.load.mockResolvedValue(guide);
    mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
      target: { value: passage.id },
    });
    fireEvent.click((await screen.findAllByRole('button', { name: 'View source 1' }))[0]!);
    await screen.findByText('Verified in this book');
    expect(f.resolve).toHaveBeenCalledWith(
      bookDoc,
      source,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(f.navigate).toHaveBeenCalledWith(
      expect.anything(),
      'verified-cfi',
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Return to reading position' }));
    await waitFor(() =>
      expect(f.navigate).toHaveBeenCalledWith(
        expect.anything(),
        'origin-cfi',
        expect.any(AbortSignal),
      ),
    );
  });

  it('aborts local parsing on close and ignores its late response', async () => {
    let finish!: (value: ChapterContent) => void;
    f.extract.mockImplementation(
      () =>
        new Promise<ChapterContent>((resolve) => {
          finish = resolve;
        }),
    );
    const view = mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    const signal = f.extract.mock.calls[0]![2].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(content));
    expect(f.load).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });
  it.each([
    new GuideError('invalid-response', 'The model returned an invalid guide. Try again.'),
    new ModelServiceError('The API key was rejected. Check the key and service address.'),
  ])('shows trusted safe error text: %s', async (error) => {
    f.generate.mockRejectedValue(error);
    mount();
    fireEvent.click(await choosePassage());
    expect((await screen.findByRole('alert')).textContent).toBe(error.message);
  });

  it('labels background help separately and treats its links as related passages', async () => {
    f.load.mockResolvedValue({
      ...guide,
      difficulties: [
        {
          title: 'A necessary concept',
          explanation: {
            text: 'A minimal general definition.',
            sourceIds: ['s1'],
            kind: 'background',
          },
        },
      ],
    });
    mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
      target: { value: passage.id },
    });
    const detail = (await screen.findByText('A necessary concept')).closest('details')!;
    expect(detail.open).toBe(false);
    fireEvent.click(screen.getByText('A necessary concept'));
    expect(screen.getByText('Background explanation')).toBeTruthy();
    expect(screen.getByText('Related passage')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Related passage 1' })).toBeTruthy();
  });

  it('does not jump when local source verification fails', async () => {
    f.load.mockResolvedValue(guide);
    f.resolve.mockResolvedValue(null);
    mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
      target: { value: passage.id },
    });
    fireEvent.click((await screen.findAllByRole('button', { name: 'View source 1' }))[0]!);
    await screen.findByRole('alert');
    expect(f.navigate).not.toHaveBeenCalled();
    expect(screen.getByText(source.text)).toBeTruthy();
    expect(screen.queryByText('Verified in this book')).toBeNull();
  });

  it('aborts saving on close and recovers the generated result for a local retry', async () => {
    let finish!: () => void;
    f.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = mount();
    fireEvent.click(await choosePassage());
    await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    const signal = f.save.mock.calls[0]![1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish());
    mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
      target: { value: passage.id },
    });
    expect(await screen.findByText(guide.orientation[0]!.text)).toBeTruthy();
    const retry = await screen.findByRole('button', { name: 'Retry saving guide' });
    await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    fireEvent.click(retry);
    await screen.findByText('Guide saved on this device.');
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it('isolates a late saved-guide response after switching books', async () => {
    let finish!: (value: ReadingGuide) => void;
    f.load.mockImplementationOnce(
      () =>
        new Promise<ReadingGuide>((resolve) => {
          finish = resolve;
        }),
    );
    const view = mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
      target: { value: passage.id },
    });
    await waitFor(() => expect(f.load).toHaveBeenCalledTimes(1));
    view.rerender(
      <ReadingGuidePanel
        book={{ ...book, hash: 'second-book', title: 'Second book' }}
        bookDoc={bookDoc}
        bookKey='second-view'
      />,
    );
    await act(async () => finish(guide));
    expect((screen.getByRole('combobox', { name: 'Chapter' }) as HTMLSelectElement).value).toBe('');
    expect(screen.queryByText(guide.orientation[0]!.text)).toBeNull();
    expect(f.generate).not.toHaveBeenCalled();
  });
  it('aborts generation when the configured model service changes', async () => {
    let finish!: (value: ReadingGuide) => void;
    f.generate.mockImplementationOnce(
      () =>
        new Promise<ReadingGuide>((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    fireEvent.click(await choosePassage());
    const signal = f.generate.mock.calls[0]![0].signal as AbortSignal;
    f.active.mockReturnValue({
      ...provider,
      id: 'new-service',
      name: 'New service',
      baseUrl: 'https://new.example.test/v1',
    });
    await act(async () => window.dispatchEvent(new Event('glossa-model-settings-changed')));
    expect(signal.aborted).toBe(true);
    await act(async () => finish(guide));
    expect(f.save).not.toHaveBeenCalled();
    expect(screen.queryByText(guide.orientation[0]!.text)).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate guide' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
  });

  it('aborts saving when model settings change and keeps the unsaved guide recoverable', async () => {
    let finish!: () => void;
    f.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    fireEvent.click(await choosePassage());
    await waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    const signal = f.save.mock.calls[0]![1] as AbortSignal;
    f.active.mockReturnValue({ ...provider, model: 'another-model' });
    await act(async () => window.dispatchEvent(new Event('glossa-model-settings-changed')));
    expect(signal.aborted).toBe(true);
    await act(async () => finish());
    expect(screen.getByText(guide.orientation[0]!.text)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving guide' }));
    await screen.findByText('Guide saved on this device.');
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps the first return position when a closed source jump completes late', async () => {
    let finish!: () => void;
    f.navigate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    f.load.mockResolvedValue(guide);
    mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Chapter' }), {
      target: { value: chapter.id },
    });
    fireEvent.change(await screen.findByRole('combobox', { name: 'Passage' }), {
      target: { value: passage.id },
    });
    fireEvent.click((await screen.findAllByRole('button', { name: 'View source 1' }))[0]!);
    await waitFor(() => expect(f.navigate).toHaveBeenCalledTimes(1));
    const signal = f.navigate.mock.calls[0]![2] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Close source excerpt' }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish());
    expect(
      screen.getByRole('button', { name: 'Return to reading position' }).hasAttribute('disabled'),
    ).toBe(false);
    f.progress.mockReturnValue({ location: 'late-source-position' });
    fireEvent.click(screen.getAllByRole('button', { name: 'View source 1' })[0]!);
    await screen.findByText('Verified in this book');
    fireEvent.click(screen.getByRole('button', { name: 'Return to reading position' }));
    await waitFor(() =>
      expect(f.navigate).toHaveBeenLastCalledWith(
        expect.anything(),
        'origin-cfi',
        expect.any(AbortSignal),
      ),
    );
  });
});
