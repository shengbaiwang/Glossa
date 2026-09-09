import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import type { ChapterContent, ChapterSource } from '@/glossa/context/types';
import type { StudyNoteVersion } from '@/glossa/notes/types';

const f = vi.hoisted(() => ({
  chapters: vi.fn(),
  extract: vi.fn(),
  load: vi.fn(),
  savePersonal: vi.fn(),
  generate: vi.fn(),
  active: vi.fn(),
  status: vi.fn(),
  resolve: vi.fn(),
  goTo: vi.fn(),
  saveFile: vi.fn(),
  setBook: vi.fn(),
  setPanel: vi.fn(),
  openSettings: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    key.replace(/{{(\w+)}}/g, (_, name: string) => String(values?.[name] ?? name)),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { saveFile: f.saveFile } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      getProgress: () => ({ sectionHref: 'one.xhtml', location: 'origin-cfi' }),
      getView: () => ({ goTo: f.goTo }),
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
vi.mock('@/glossa/ai/provider', () => ({
  getActiveProviderConfig: f.active,
  getProviderStatus: f.status,
}));
vi.mock('@/glossa/notes/generate', () => ({
  generateStudyNote: f.generate,
  getStudyNoteCacheKey: async () => 'cache',
}));
vi.mock('@/glossa/notes/store', () => ({
  loadChapterNotes: f.load,
  savePersonalNote: f.savePersonal,
}));

import StudyNotesPanel from '@/glossa/ui/StudyNotesPanel';

const provider = {
  id: 'test',
  name: 'Test service',
  baseUrl: 'https://example.test/v1',
  model: 'study-model',
};
const chapter = {
  id: 'chapter-one',
  title: 'First chapter',
  href: 'one.xhtml',
  depth: 0,
  sectionIndex: 0,
  start: { sectionIndex: 0 },
  end: { sectionIndex: 1 },
};
const source: ChapterSource = {
  sourceId: 's1',
  text: 'Original evidence from the local book.',
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: 'source-cfi',
    quote: { exact: 'Original evidence from the local book.', prefix: '', suffix: '' },
  },
};
const content: ChapterContent = { chapter, sources: [source], characterCount: 38 };
const version: StudyNoteVersion = {
  id: 'v1',
  bookId: 'book',
  bookTitle: 'Test book',
  chapterId: chapter.id,
  chapterTitle: chapter.title,
  title: 'A connected argument',
  overview: [],
  sections: [
    {
      heading: 'Reasoning',
      paragraphs: [{ text: 'A supported explanation.', sourceIds: ['s1'], kind: 'source' }],
    },
  ],
  questions: [
    { question: 'Why does this follow?', answer: 'Because of the evidence.', sourceIds: ['s1'] },
  ],
  insufficientEvidence: false,
  sources: [source],
  provider,
  createdAt: '2026-09-09T00:00:00Z',
  cacheKey: 'cache',
  contentHash: 'hash',
  promptVersion: '1',
  schemaVersion: 1,
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
const mount = () => render(<StudyNotesPanel book={book} bookDoc={bookDoc} bookKey='book-view' />);

beforeEach(() => {
  vi.clearAllMocks();
  f.chapters.mockReturnValue([chapter]);
  f.extract.mockResolvedValue(content);
  f.load.mockResolvedValue({ versions: [], personalNote: '' });
  f.savePersonal.mockResolvedValue(undefined);
  f.active.mockReturnValue(provider);
  f.status.mockResolvedValue({ configured: true, hasApiKey: true, storage: 'session' });
  f.generate.mockResolvedValue(version);
  f.resolve.mockResolvedValue({ cfi: 'verified-cfi', text: source.text, recovered: false });
  f.goTo.mockResolvedValue(undefined);
  f.saveFile.mockResolvedValue(true);
});
afterEach(cleanup);

describe('Chapter study notes', () => {
  it('previews only the selected chapter and never generates until requested', async () => {
    mount();
    await screen.findByText('38 characters · only this chapter');
    expect(f.generate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Generate study note' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate study note' }));
    await screen.findByRole('heading', { name: version.title });
    expect(f.generate.mock.calls[0]![0].content).toBe(content);
    expect(screen.getByText('Study note saved on this device.')).toBeTruthy();
  });

  it('deep links to model settings without requesting credentials or network', async () => {
    f.active.mockReturnValue(null);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure model service' }));
    expect(f.setPanel).toHaveBeenCalledWith('Models');
    expect(f.setBook).toHaveBeenCalledWith('book-view');
    expect(f.openSettings).toHaveBeenCalledWith(true);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('keeps a saved version when a request is cancelled and aborts on closing', async () => {
    f.load.mockResolvedValue({ versions: [version], personalNote: 'My thought' });
    f.generate.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () =>
            reject(new DOMException('Cancelled', 'AbortError')),
          ),
        ),
    );
    const rendered = mount();
    const generate = await screen.findByRole('button', { name: 'Generate a new version' });
    await waitFor(() => expect(generate.hasAttribute('disabled')).toBe(false));
    fireEvent.click(generate);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await screen.findByText('Generation cancelled. Previous notes are kept.');
    expect(screen.getByRole('heading', { name: version.title })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Generate a new version' }));
    await screen.findByRole('button', { name: 'Cancel' });
    const signal = f.generate.mock.calls[1]![0].signal as AbortSignal;
    rendered.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('validates the source before navigation and returns to the original reading position', async () => {
    f.load.mockResolvedValue({ versions: [version], personalNote: '' });
    mount();
    const sources = await screen.findAllByRole('button', { name: 'View source 1' });
    fireEvent.click(sources[0]!);
    await waitFor(() => expect(f.goTo).toHaveBeenCalledWith('verified-cfi'));
    expect(f.resolve).toHaveBeenCalledWith(
      bookDoc,
      source,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText(source.text)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Return to reading position' }));
    await waitFor(() => expect(f.goTo).toHaveBeenLastCalledWith('origin-cfi'));
  });

  it('refuses an unverified source and shows the saved excerpt honestly', async () => {
    f.load.mockResolvedValue({ versions: [version], personalNote: '' });
    f.resolve.mockResolvedValue(null);
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'View source 1' }))[0]!);
    await screen.findByRole('alert');
    expect(f.goTo).not.toHaveBeenCalled();
    expect(screen.getByText('Saved excerpt')).toBeTruthy();
  });

  it('saves personal reflections separately, exports them, and blocks overwriting unread saved data', async () => {
    f.load.mockResolvedValue({ versions: [version], personalNote: 'My thought' });
    const rendered = mount();
    const input = await screen.findByRole('textbox', { name: 'My reflections' });
    fireEvent.change(input, { target: { value: 'My revised thought' } });
    await waitFor(() =>
      expect(f.savePersonal).toHaveBeenCalledWith('book', 'chapter-one', 'My revised thought'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }));
    await waitFor(() => expect(f.saveFile).toHaveBeenCalled());
    expect(f.saveFile.mock.calls[0]![1]).toContain('My revised thought');
    expect(f.generate).not.toHaveBeenCalled();
    rendered.unmount();
    f.load.mockRejectedValue(new Error('storage unavailable'));
    mount();
    await screen.findByRole('button', { name: 'Reload chapter notes' });
    expect(screen.queryByRole('textbox', { name: 'My reflections' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Generate study note' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('does not let a late result from a closed panel update a new note', async () => {
    let resolve: ((value: StudyNoteVersion) => void) | undefined;
    f.generate.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const rendered = mount();
    const button = await screen.findByRole('button', { name: 'Generate study note' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    fireEvent.click(button);
    rendered.unmount();
    await act(async () => resolve?.(version));
    expect(screen.queryByText('Study note saved on this device.')).toBeNull();
  });

  it('retains an unsaved reflection across closing and reopening until a retry succeeds', async () => {
    f.load.mockResolvedValue({ versions: [version], personalNote: 'Previously saved reflection' });
    f.savePersonal.mockRejectedValueOnce(new Error('storage temporarily unavailable'));
    const first = mount();
    fireEvent.change(await screen.findByRole('textbox', { name: 'My reflections' }), {
      target: { value: 'A reflection that has not reached storage yet' },
    });
    await screen.findByText('Your reflection could not be saved.');
    first.unmount();

    const reopened = mount();
    const restored = await screen.findByRole('textbox', { name: 'My reflections' });
    expect((restored as HTMLTextAreaElement).value).toBe(
      'A reflection that has not reached storage yet',
    );
    expect(screen.getByRole('combobox', { name: 'Chapter' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Saved locally · your reflections are never sent to the model');
    expect(f.savePersonal).toHaveBeenLastCalledWith(
      'book',
      'chapter-one',
      'A reflection that has not reached storage yet',
    );
    expect(f.generate).not.toHaveBeenCalled();

    reopened.unmount();
    f.load.mockResolvedValue({
      versions: [version],
      personalNote: 'Fresh value from local storage',
    });
    mount();
    expect(
      ((await screen.findByRole('textbox', { name: 'My reflections' })) as HTMLTextAreaElement)
        .value,
    ).toBe('Fresh value from local storage');
  });

  it('does not let an earlier pending save clear a newer failed draft from a reopened panel', async () => {
    let finishEarlier: (() => void) | undefined;
    f.savePersonal
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishEarlier = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('newer save failed'));
    const first = mount();
    fireEvent.change(await screen.findByRole('textbox', { name: 'My reflections' }), {
      target: { value: 'Earlier pending reflection' },
    });
    expect(screen.getByRole('combobox', { name: 'Chapter' }).hasAttribute('disabled')).toBe(true);
    first.unmount();

    const second = mount();
    fireEvent.change(await screen.findByRole('textbox', { name: 'My reflections' }), {
      target: { value: 'Newer unsaved reflection' },
    });
    await screen.findByText('Your reflection could not be saved.');
    await act(async () => finishEarlier?.());
    second.unmount();

    mount();
    expect(
      ((await screen.findByRole('textbox', { name: 'My reflections' })) as HTMLTextAreaElement)
        .value,
    ).toBe('Newer unsaved reflection');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Saved locally · your reflections are never sent to the model');
  });

  it('aborts a pending source lookup when changing saved versions and ignores its late result', async () => {
    let finishLookup:
      | ((value: { cfi: string; text: string; recovered: boolean }) => void)
      | undefined;
    f.load.mockResolvedValue({
      versions: [{ ...version, id: 'v2', title: 'A newer explanation' }, version],
      personalNote: '',
    });
    f.resolve.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'View source 1' }))[0]!);
    await screen.findByText('Locating source…');
    const signal = f.resolve.mock.calls[0]![2].signal as AbortSignal;
    fireEvent.change(screen.getByRole('combobox', { name: 'Saved versions' }), {
      target: { value: version.id },
    });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('complementary', { name: 'Source excerpt' })).toBeNull();
    await act(async () =>
      finishLookup?.({ cfi: 'obsolete-location', text: source.text, recovered: false }),
    );
    expect(f.goTo).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: version.title })).toBeTruthy();
    expect(screen.queryByText('Original source')).toBeNull();
  });
});
