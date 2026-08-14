import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useSwipeToDismiss', async () => {
  const React = await import('react');
  return {
    useSwipeToDismiss: () => ({
      panelRef: React.createRef<HTMLDivElement>(),
      overlayRef: React.createRef<HTMLDivElement>(),
      panelHeight: { current: 1 },
      handleVerticalDragStart: vi.fn(),
    }),
  };
});
vi.mock('@/hooks/usePanelResize', () => ({
  usePanelResize: () => ({ handleResizeStart: vi.fn(), handleResizeKeyDown: vi.fn() }),
}));
vi.mock('@/glossa/ai/deepseekKeychain', () => ({
  DEEPSEEK_API_KEYCHAIN_KEY: 'glossa.deepseek.api-key.v1',
  clearDeepSeekApiKey: vi.fn(),
  getDeepSeekApiKey: vi.fn(),
  getDeepSeekKeychainStatus: vi.fn(),
  saveDeepSeekApiKey: vi.fn(),
}));

import GlossaPanel from '@/glossa/ui/GlossaPanel';
import { useGlossaPanelStore } from '@/glossa/ui/glossaPanelStore';
import {
  createChapterToSelectionContextPack,
  createContextPack,
  createReadSectionContextPack,
} from '@/glossa/context/contextPack';
import {
  validateGlossaChapterSummary,
  type AIProvider,
  type AIProviderRequest,
  type ChapterSummaryCache,
} from '@/glossa/ai';
import {
  clearDeepSeekApiKey,
  getDeepSeekApiKey,
  getDeepSeekKeychainStatus,
  saveDeepSeekApiKey,
} from '@/glossa/ai/deepseekKeychain';
import type { DocumentNavigator } from '@/glossa/citations/navigation';
import {
  canAskGlossaForEpubSelection,
  captureAndOpenGlossaPanel,
} from '@/glossa/ui/selectionAction';
import type { DocumentAdapter, SelectedText } from '@/glossa/context/types';
import { createGlossaSourcedNoteStore } from '@/glossa/notes/glossaSourcedNotes';
import type { BookConfig } from '@/types/book';
import type { AppService } from '@/types/system';

const env = process.env as Record<string, string | undefined>;
const flagName = 'NEXT_PUBLIC_GLOSSA_ENABLED';
const originalFlag = env[flagName];

const selected = (text: string): SelectedText => ({
  text,
  anchor: {
    version: 1,
    documentId: 'fixture-book',
    format: 'epub',
    sectionId: 'chapter-1.xhtml',
    cfi: 'epubcfi(/6/2!/4/1:0)',
    quote: { exact: text },
  },
});

const renderPanel = (provider?: AIProvider, appService?: { saveFile: AppService['saveFile'] }) =>
  render(
    <GlossaPanel
      safeAreaInsets={null}
      systemUIVisible={false}
      statusBarHeight={0}
      provider={provider}
      appService={appService}
    />,
  );

const contextFor = (selection: SelectedText) =>
  createContextPack({ selection, selectionContext: [selection] });

beforeEach(() => {
  env[flagName] = 'true';
  useGlossaPanelStore.setState({
    isOpen: false,
    isPinned: false,
    isCollapsed: false,
    width: '32%',
    selection: null,
    contextPack: null,
    chapterContextPack: null,
    chapterContextUnavailableReason: null,
    navigator: null,
    adapter: null,
    chapterSummaryCache: null,
    sourcedNoteStore: null,
  });
  vi.mocked(getDeepSeekKeychainStatus).mockResolvedValue({ available: false, configured: false });
  vi.mocked(getDeepSeekApiKey).mockResolvedValue(null);
  vi.mocked(saveDeepSeekApiKey).mockResolvedValue();
  vi.mocked(clearDeepSeekApiKey).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  if (originalFlag === undefined) delete env[flagName];
  else env[flagName] = originalFlag;
  vi.clearAllMocks();
});

describe('Glossa selection entry', () => {
  test('is absent unless the explicit flag, EPUB format, and non-empty selection all exist', () => {
    env[flagName] = 'false';
    expect(canAskGlossaForEpubSelection('EPUB', 'amber mark')).toBe(false);
    env[flagName] = 'true';
    expect(canAskGlossaForEpubSelection('PDF', 'amber mark')).toBe(false);
    expect(canAskGlossaForEpubSelection('EPUB', '   ')).toBe(false);
    expect(canAskGlossaForEpubSelection('EPUB', 'amber mark')).toBe(true);
  });

  test('captures an immutable adapter snapshot before opening and ignores an empty selection', async () => {
    const open = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const source = selected('amber mark');
    expect(await captureAndOpenGlossaPanel(async () => source, open)).toBe(true);
    expect(open).toHaveBeenCalledWith(source);
    expect(open.mock.calls[0]?.[0]).not.toBe(source);
    expect(await captureAndOpenGlossaPanel(async () => selected('   '), open)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('Glossa panel', () => {
  test('defaults to Mock and makes DeepSeek configuration explicit without rendering a key', async () => {
    const selection = selected('amber mark');
    vi.mocked(getDeepSeekKeychainStatus).mockResolvedValue({ available: true, configured: false });
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel();
    expect(screen.getByRole('radio', { name: 'Mock' }).getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'DeepSeek' }));
      await Promise.resolve();
    });
    expect(screen.getByText('DeepSeek API key: not configured')).toBeTruthy();
    const keyInput = screen.getByLabelText('DeepSeek API key') as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: 'test-only-key' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save key'));
      await Promise.resolve();
    });
    expect(saveDeepSeekApiKey).toHaveBeenCalledWith('test-only-key');
    expect(keyInput.value).toBe('');
  });

  test('requires a one-time DeepSeek sending-range confirmation before any request', async () => {
    const selection = selected('amber mark');
    vi.mocked(getDeepSeekKeychainStatus).mockResolvedValue({ available: true, configured: true });
    vi.mocked(getDeepSeekApiKey).mockResolvedValue('test-only-key');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":"{\\"status\\":\\"insufficient_evidence\\",\\"paragraphs\\":[],\\"followups\\":[]}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'DeepSeek' }));
      await Promise.resolve();
    });
    fireEvent.change(screen.getByPlaceholderText('Ask about the selected text'), {
      target: { value: 'What does this mean?' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Send'));
      await Promise.resolve();
    });
    expect(screen.getByLabelText('DeepSeek privacy confirmation').textContent).toContain(
      '仅选区 · 未使用后文 (1 segments)',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText('Send to DeepSeek'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  test('does not render or register a panel while the flag is disabled', () => {
    env[flagName] = 'false';
    useGlossaPanelStore.getState().open(selected('amber mark'));
    renderPanel();
    expect(screen.queryByLabelText('Glossa')).toBeNull();
  });

  test('shows the snapshot, replaces it on a new selection, and closes with Escape', () => {
    const first = selected('amber mark');
    useGlossaPanelStore.getState().open(first, contextFor(first));
    renderPanel();
    expect(screen.getByText('amber mark')).toBeTruthy();
    expect(screen.getByText('仅选区 · 未使用后文')).toBeTruthy();

    act(() => {
      const replacement = selected('shared margin');
      useGlossaPanelStore.getState().open(replacement, contextFor(replacement));
    });
    expect(screen.getByText('shared margin')).toBeTruthy();
    expect(useGlossaPanelStore.getState().selection?.text).toBe('shared margin');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Glossa')).toBeNull();
    expect(useGlossaPanelStore.getState().selection?.text).toBe('shared margin');
  });

  test('defaults to the minimal range and swaps to the frozen chapter-to-selection snapshot', async () => {
    const selection = selected('amber mark');
    const minimal = contextFor(selection);
    const chapter = createChapterToSelectionContextPack({
      selection,
      precedingBlocks: [
        { ...selected('chapter heading'), kind: 'heading', order: 0 },
        { ...selected('earlier only'), kind: 'paragraph', order: 1 },
      ],
    });
    const seenPacks: string[][] = [];
    const localProvider: AIProvider = {
      async *stream(request) {
        seenPacks.push(request.contextPack.segments.map(({ text }) => text));
        yield {
          type: 'complete',
          answer: {
            status: 'answered',
            paragraphs: [
              {
                text: 'bounded answer',
                sourceIds: [request.contextPack.selectionSourceId],
                basis: 'document',
              },
            ],
            followups: [],
          },
        };
      },
    };
    useGlossaPanelStore.getState().open(selection, minimal, undefined, { pack: chapter });
    renderPanel(localProvider);
    expect(screen.getByRole('radio', { name: '最小范围' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('radio', { name: '本章开头至选区' }));
    expect(screen.getByText('本章开头至选区 · 3 段 · 未使用后文')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Explain'));
      await Promise.resolve();
    });
    expect(seenPacks).toEqual([['chapter heading', 'earlier only', 'amber mark']]);
  });

  test('closes without reader persistence or model activity', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    useGlossaPanelStore.getState().open(selected('amber mark'));
    renderPanel();
    fireEvent.click(screen.getByLabelText('Close Glossa'));
    expect(useGlossaPanelStore.getState().isOpen).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('uses independent pin and collapse controls without changing the selection snapshot', () => {
    const selection = selected('amber mark');
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel();
    fireEvent.click(screen.getByLabelText('Pin Glossa'));
    expect(screen.queryByText('仅选区 · 未使用后文')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByLabelText('Glossa')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Collapse Glossa'));
    expect(screen.getByLabelText('Expand Glossa')).toBeTruthy();
    expect(useGlossaPanelStore.getState().selection?.text).toBe('amber mark');
  });

  test('runs the three quick actions, streams Mock text, and reports insufficient preceding evidence', async () => {
    const selection = selected('amber mark');
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByText('Explain'));
      await Promise.resolve();
    });
    expect(screen.getByText(/解释（Mock）/u)).toBeTruthy();
    expect(screen.getByLabelText('Source 1-1').textContent).toContain('amber mark');

    await act(async () => {
      fireEvent.click(screen.getByText('Translate'));
      await Promise.resolve();
    });
    expect(screen.getByText(/翻译（Mock）/u)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Connect to previous'));
      await Promise.resolve();
    });
    expect(screen.getByText(/Evidence insufficient/u)).toBeTruthy();
  });

  test('shows actual token usage and a labelled local USD estimate after a response', async () => {
    const selection = selected('amber mark');
    const provider: AIProvider = {
      modelVersion: 'deepseek-v4-flash',
      async *stream(request) {
        yield {
          type: 'usage',
          usage: { inputTokens: 100, outputTokens: 50, cacheHitTokens: 20, cacheMissTokens: 80 },
        };
        yield {
          type: 'complete',
          answer: {
            status: 'answered',
            paragraphs: [
              {
                text: 'Answer with measured usage.',
                sourceIds: [request.contextPack.selectionSourceId],
                basis: 'document',
              },
            ],
            followups: [],
          },
        };
      },
    };
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel(provider);

    await act(async () => {
      fireEvent.click(screen.getByText('Explain'));
      await Promise.resolve();
    });

    const usage = screen.getByLabelText('Usage and estimated cost');
    expect(usage.textContent).toContain('Input 100');
    expect(usage.textContent).toContain('Output 50');
    expect(usage.textContent).toContain('Cache hit 20');
    expect(usage.textContent).toContain('Cache miss 80');
    expect(usage.textContent).toContain('Estimated cost:');
    expect(usage.textContent).toContain('USD');
    expect(usage.textContent).toContain('Rate deepseek-v4-flash');
  });

  test('keeps the EPUB selection in explain and translate requests, excludes later text, and navigates through local citations', async () => {
    const selection = {
      ...selected('selected EPUB passage'),
      anchor: { ...selected('selected EPUB passage').anchor, cfi: 'epubcfi(/6/2!/4/3:0)' },
    };
    const previous = {
      ...selected('preceding EPUB passage'),
      anchor: { ...selected('preceding EPUB passage').anchor, cfi: 'epubcfi(/6/2!/4/1:0)' },
    };
    const later = {
      ...selected('unread later EPUB passage'),
      anchor: { ...selected('unread later EPUB passage').anchor, cfi: 'epubcfi(/6/2!/4/5:0)' },
    };
    const contextPack = createContextPack({
      selection,
      selectionContext: [previous, selection, later],
    });
    const requests: AIProviderRequest[] = [];
    const navigate = vi.fn(async (anchor: SelectedText['anchor']) => ({
      result: {
        status: 'resolved' as const,
        method: 'cfi' as const,
        exact: true,
        anchor,
        canReturn: true,
      },
      returnToOrigin: vi.fn(async () => true),
      dispose: vi.fn(),
    }));
    const provider: AIProvider = {
      async *stream(request) {
        requests.push(request);
        yield {
          type: 'complete',
          answer: {
            status: 'answered',
            paragraphs: [
              {
                text: `${request.action} result`,
                sourceIds: [request.contextPack.selectionSourceId],
                basis: 'document',
              },
            ],
            followups: [],
          },
        };
      },
    };
    useGlossaPanelStore.getState().open(selection, contextPack, { navigate, dispose: vi.fn() });
    renderPanel(provider);

    for (const action of ['Explain', 'Translate']) {
      await act(async () => {
        fireEvent.click(screen.getByText(action));
        await Promise.resolve();
      });
    }

    expect(requests.map(({ action }) => action)).toEqual(['explain', 'translate']);
    for (const request of requests) {
      expect(request.contextPack.segments.filter(({ role }) => role === 'selection')).toEqual([
        expect.objectContaining({ text: selection.text }),
      ]);
      expect(request.contextPack.segments.map(({ text }) => text)).not.toContain(later.text);
    }
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Source 2-1'));
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(selection.anchor);
  });

  test('saves only a completed answer, reports duplicates, and restores every saved source after config reload', async () => {
    const selection = selected('amber mark');
    const navigate = vi.fn(async (anchor: SelectedText['anchor']) => ({
      result: {
        status: 'resolved' as const,
        method: 'cfi' as const,
        exact: true,
        anchor,
        canReturn: true,
      },
      returnToOrigin: vi.fn(async () => true),
      dispose: vi.fn(),
    }));
    let config: BookConfig = { bookHash: 'fixture-book', updatedAt: 1 };
    const noteStore = createGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getEntries: () => config.glossaSourcedNotes,
      writeEntries: async (entries) => {
        config = { ...config, glossaSourcedNotes: entries };
      },
    });
    const localProvider: AIProvider = {
      async *stream(request) {
        yield {
          type: 'complete',
          answer: {
            status: 'answered',
            paragraphs: [
              {
                text: 'A saved verified answer.',
                sourceIds: [request.contextPack.segments[0]!.sourceId],
                basis: 'document',
              },
            ],
            followups: [],
          },
        };
      },
    };
    useGlossaPanelStore
      .getState()
      .open(
        selection,
        contextFor(selection),
        { navigate, dispose: vi.fn() },
        undefined,
        undefined,
        undefined,
        noteStore,
      );
    renderPanel(localProvider);
    await act(async () => {
      fireEvent.click(screen.getByText('Explain'));
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText('Save as note'));
    await act(async () => await Promise.resolve());
    expect(screen.getByText('Note saved locally.')).toBeTruthy();
    expect(config.glossaSourcedNotes?.[0]).toMatchObject({
      version: 3,
      original: {
        version: 2,
        answer: { text: 'A saved verified answer.', basis: 'document' },
        context: {
          request: { action: 'explain' },
          selection: { text: 'amber mark' },
        },
      },
    });
    expect(config.glossaSourcedNotes?.[0]?.sources).toHaveLength(1);

    fireEvent.click(screen.getByText('Save as note'));
    await act(async () => await Promise.resolve());
    expect(screen.getByText('This note is already saved.')).toBeTruthy();

    cleanup();
    config = JSON.parse(JSON.stringify(config)) as BookConfig;
    const reloadedStore = createGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getEntries: () => config.glossaSourcedNotes,
      writeEntries: async (entries) => {
        config = { ...config, glossaSourcedNotes: entries };
      },
    });
    useGlossaPanelStore
      .getState()
      .open(
        selection,
        contextFor(selection),
        { navigate, dispose: vi.fn() },
        undefined,
        undefined,
        undefined,
        reloadedStore,
      );
    renderPanel();
    expect(screen.getByLabelText('Saved Glossa notes')).toBeTruthy();
    expect(screen.getByLabelText('Saved note context').textContent).toContain(
      'Explain selected text',
    );
    expect(screen.getByLabelText('Saved note context').textContent).toContain('amber mark');
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    fireEvent.change(screen.getByLabelText('Your note'), {
      target: { value: 'My own reading reminder.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save note changes' }));
      await Promise.resolve();
    });
    expect(screen.getByText('Note updated locally.')).toBeTruthy();
    expect(config.glossaSourcedNotes?.[0]).toMatchObject({
      version: 3,
      userNote: 'My own reading reminder.',
      original: {
        version: 2,
        answer: { text: 'A saved verified answer.', basis: 'document' },
        context: { selection: { text: 'amber mark' }, request: { action: 'explain' } },
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Saved note source 1-1'));
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenLastCalledWith(selection.anchor);
    expect(screen.getByText('Return to reading position')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.getByText('Delete this saved note?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep note' }));
    expect(config.glossaSourcedNotes).toHaveLength(1);
    expect(screen.getByText('My own reading reminder.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
      await Promise.resolve();
    });
    expect(config.glossaSourcedNotes).toEqual([]);
    expect(
      screen.getByText('No saved notes are available to export for this document.'),
    ).toBeTruthy();
  });

  test('exports saved notes as Markdown or JSON and reports cancellation and save failure', async () => {
    const selection = selected('amber mark');
    const savedNote = {
      version: 1 as const,
      id: 'legacy-note',
      documentId: 'fixture-book',
      answer: 'Legacy verified answer.',
      sources: [
        {
          sourceId: 'source_legacy',
          text: 'amber mark',
          anchor: selection.anchor,
        },
      ],
      createdAt: 1,
    };
    const noteStore = createGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getEntries: () => [savedNote],
      writeEntries: async () => {},
    });
    const saveFile = vi
      .fn<AppService['saveFile']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('disk unavailable'));
    useGlossaPanelStore
      .getState()
      .open(
        selection,
        contextFor(selection),
        undefined,
        undefined,
        undefined,
        undefined,
        noteStore,
      );
    renderPanel(undefined, { saveFile });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }));
      await Promise.resolve();
    });
    expect(saveFile).toHaveBeenLastCalledWith(
      'fixture-book-glossa-notes.md',
      expect.stringContaining('Legacy verified answer.'),
      { mimeType: 'text/markdown' },
    );
    expect(screen.getByText('Markdown export saved.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
      await Promise.resolve();
    });
    expect(saveFile).toHaveBeenLastCalledWith(
      'fixture-book-glossa-notes.json',
      expect.stringContaining('"version": 1'),
      { mimeType: 'application/json' },
    );
    expect(screen.getByText('Export cancelled.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
      await Promise.resolve();
    });
    expect(screen.getByText('Could not export notes. Please try again.')).toBeTruthy();
  });

  test('keeps export controls disabled with an explicit current-document empty state', () => {
    const selection = selected('amber mark');
    const noteStore = createGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getEntries: () => [],
      writeEntries: async () => {},
    });
    useGlossaPanelStore
      .getState()
      .open(
        selection,
        contextFor(selection),
        undefined,
        undefined,
        undefined,
        undefined,
        noteStore,
      );
    renderPanel(undefined, { saveFile: vi.fn() });

    expect(
      screen.getByText('No saved notes are available to export for this document.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export Markdown' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Export JSON' }).hasAttribute('disabled')).toBe(true);
  });

  test('keeps the saved-note card after a failed confirmed deletion', async () => {
    const selection = selected('amber mark');
    const savedNote = {
      version: 1 as const,
      id: 'legacy-note',
      documentId: 'fixture-book',
      answer: 'Legacy verified answer.',
      sources: [
        {
          sourceId: 'source_legacy',
          text: 'amber mark',
          anchor: selection.anchor,
        },
      ],
      createdAt: 1,
    };
    const noteStore = createGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getEntries: () => [savedNote],
      writeEntries: async () => {
        throw new Error('disk unavailable');
      },
    });
    useGlossaPanelStore
      .getState()
      .open(
        selection,
        contextFor(selection),
        undefined,
        undefined,
        undefined,
        undefined,
        noteStore,
      );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
      await Promise.resolve();
    });
    expect(screen.getByText('Could not delete note. Please try again.')).toBeTruthy();
    expect(screen.getByText('Legacy verified answer.')).toBeTruthy();
    expect(screen.queryByText('Delete this saved note?')).toBeNull();
  });

  test('never offers a save action while a result is loading, cancelled, errored, or insufficient', async () => {
    const selection = selected('amber mark');
    const provider: AIProvider = {
      async *stream(request, signal) {
        if (request.action === 'relate') {
          yield {
            type: 'complete',
            answer: { status: 'insufficient_evidence', paragraphs: [], followups: [] },
          };
          return;
        }
        if (request.action === 'translate') {
          yield { type: 'error', error: { code: 'provider-error', message: 'test failure' } };
          return;
        }
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          ),
        );
      },
    };
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel(provider);
    fireEvent.click(screen.getByText('Explain'));
    await act(async () => await Promise.resolve());
    expect(screen.queryByText('Save as note')).toBeNull();
    fireEvent.click(screen.getByText('Cancel'));
    await act(async () => await Promise.resolve());
    expect(screen.queryByText('Save as note')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText('Translate'));
      await Promise.resolve();
    });
    expect(screen.getByText('test failure')).toBeTruthy();
    expect(screen.queryByText('Save as note')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText('Connect to previous'));
      await Promise.resolve();
    });
    expect(
      screen.getByText(
        'Evidence insufficient: the current context does not support this question.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Save as note')).toBeNull();
  });

  test('summarizes only adapter-proved read chapter blocks with a structured local result', async () => {
    const selection = selected('amber mark');
    const readBlock = {
      ...selected('A verified read chapter claim.'),
      kind: 'paragraph' as const,
      order: 0,
    };
    const secondReadBlock = {
      ...selected('A separate verified chapter claim.'),
      kind: 'paragraph' as const,
      order: 1,
    };
    secondReadBlock.anchor.cfi = 'epubcfi(/6/2!/4/3:0)';
    const unreadBlock = {
      ...selected('Unread later chapter text.'),
      kind: 'paragraph' as const,
      order: 1,
    };
    const getCurrentReadSectionText = vi.fn(async () => ({
      documentId: 'fixture-book',
      format: 'epub' as const,
      sectionId: 'chapter-1.xhtml',
      blocks: [readBlock, secondReadBlock],
    }));
    const adapter = { getCurrentReadSectionText } as unknown as DocumentAdapter;
    const seenPacks: string[][] = [];
    const returned = vi.fn(async () => true);
    const navigate = vi.fn(async (anchor: SelectedText['anchor']) => ({
      result: {
        status: 'resolved' as const,
        method: 'cfi' as const,
        exact: true,
        anchor,
        canReturn: true,
      },
      returnToOrigin: returned,
      dispose: vi.fn(),
    }));
    const localProvider: AIProvider = {
      async *stream(request) {
        seenPacks.push(request.contextPack.segments.map(({ text }) => text));
        const [firstSourceId, secondSourceId] = request.contextPack.segments.map(
          ({ sourceId }) => sourceId,
        );
        yield {
          type: 'complete',
          answer: {
            status: 'summarized',
            corePoints: [
              { text: 'First verified core point.', sourceIds: [firstSourceId!] },
              { text: 'Second verified core point.', sourceIds: [secondSourceId!] },
            ],
            evidence: [{ text: 'Verified evidence.', sourceIds: [secondSourceId!] }],
            concepts: [
              { term: 'claim', explanation: 'A read statement.', sourceIds: [firstSourceId!] },
            ],
            openQuestions: [{ text: 'What follows from it?', sourceIds: [secondSourceId!] }],
          },
        };
      },
    };
    useGlossaPanelStore
      .getState()
      .open(selection, contextFor(selection), { navigate, dispose: vi.fn() }, undefined, adapter);
    renderPanel(localProvider);
    await act(async () => {
      fireEvent.click(screen.getByText('Summarize read chapter'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getCurrentReadSectionText).toHaveBeenCalledOnce();
    expect(seenPacks).toEqual([[readBlock.text, secondReadBlock.text]]);
    expect(JSON.stringify(seenPacks)).not.toContain(unreadBlock.text);
    expect(screen.getByText('Core points')).toBeTruthy();
    expect(screen.getByText('First verified core point.')).toBeTruthy();
    expect(screen.getByText('Second verified core point.')).toBeTruthy();
    expect(screen.getByLabelText('Core point sources 1-1').textContent).toContain(readBlock.text);
    expect(screen.getByLabelText('Core point sources 1-1').textContent).not.toContain(
      secondReadBlock.text,
    );
    expect(screen.getByLabelText('Core point sources 1-2').textContent).toContain(
      secondReadBlock.text,
    );
    expect(screen.getByLabelText('Core point sources 1-2').textContent).not.toContain(
      readBlock.text,
    );
    expect(screen.queryByLabelText('Sources')).toBeNull();
    expect(screen.getByText('Verified evidence.')).toBeTruthy();
    expect(screen.getByText('Open questions')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Core point source 1-2-1'));
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(secondReadBlock.anchor);
    await act(async () => {
      fireEvent.click(screen.getByText('Return to reading position'));
      await Promise.resolve();
    });
    expect(returned).toHaveBeenCalledOnce();
  });

  test('uses a valid local chapter-summary cache before calling the provider', async () => {
    const selection = selected('amber mark');
    const readBlock = {
      ...selected('A verified read chapter claim.'),
      kind: 'paragraph' as const,
      order: 0,
    };
    const secondReadBlock = {
      ...selected('A separate verified chapter claim.'),
      kind: 'paragraph' as const,
      order: 1,
    };
    secondReadBlock.anchor.cfi = 'epubcfi(/6/2!/4/3:0)';
    const readPack = createReadSectionContextPack({ section: [readBlock, secondReadBlock] });
    if (!readPack) throw new Error('Fixture cache must have read evidence');
    const getCurrentReadSectionText = vi.fn(async () => ({
      documentId: 'fixture-book',
      format: 'epub' as const,
      sectionId: 'chapter-1.xhtml',
      blocks: [readBlock, secondReadBlock],
    }));
    const adapter = { getCurrentReadSectionText } as unknown as DocumentAdapter;
    const [firstSourceId, secondSourceId] = readPack.segments.map(({ sourceId }) => sourceId);
    const cached = validateGlossaChapterSummary(
      {
        status: 'summarized',
        corePoints: [
          { text: 'Cached first core point.', sourceIds: [firstSourceId!] },
          { text: 'Cached second core point.', sourceIds: [secondSourceId!] },
        ],
        evidence: [{ text: 'Cached evidence.', sourceIds: [secondSourceId!] }],
        concepts: [],
        openQuestions: [],
      },
      readPack,
    );
    if (!cached.ok) throw new Error('Fixture cache must validate');
    const chapterSummaryCache: ChapterSummaryCache = {
      read: vi.fn(() => cached),
      write: vi.fn(),
    };
    const stream = vi.fn();
    const localProvider: AIProvider = { modelVersion: 'test-model-v1', stream };
    const navigate = vi.fn(async (anchor: SelectedText['anchor']) => ({
      result: {
        status: 'resolved' as const,
        method: 'cfi' as const,
        exact: true,
        anchor,
        canReturn: true,
      },
      returnToOrigin: vi.fn(async () => true),
      dispose: vi.fn(),
    }));
    useGlossaPanelStore
      .getState()
      .open(
        selection,
        contextFor(selection),
        { navigate, dispose: vi.fn() },
        undefined,
        adapter,
        chapterSummaryCache,
      );
    renderPanel(localProvider);
    await act(async () => {
      fireEvent.click(screen.getByText('Summarize read chapter'));
      await Promise.resolve();
    });
    expect(chapterSummaryCache.read).toHaveBeenCalledOnce();
    expect(stream).not.toHaveBeenCalled();
    expect(chapterSummaryCache.write).not.toHaveBeenCalled();
    expect(screen.getByText('Cached first core point.')).toBeTruthy();
    expect(screen.getByText('Cached second core point.')).toBeTruthy();
    expect(screen.getByLabelText('Core point sources 1-1').textContent).toContain(readBlock.text);
    expect(screen.getByLabelText('Core point sources 1-1').textContent).not.toContain(
      secondReadBlock.text,
    );
    expect(screen.getByLabelText('Core point sources 1-2').textContent).toContain(
      secondReadBlock.text,
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Core point source 1-2-1'));
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(secondReadBlock.anchor);
  });

  test('writes only a completed, validated chapter summary and never on cancellation', async () => {
    const selection = selected('amber mark');
    const readBlock = {
      ...selected('A verified read chapter claim.'),
      kind: 'paragraph' as const,
      order: 0,
    };
    const adapter = {
      getCurrentReadSectionText: vi.fn(async () => ({
        documentId: 'fixture-book',
        format: 'epub' as const,
        sectionId: 'chapter-1.xhtml',
        blocks: [readBlock],
      })),
    } as unknown as DocumentAdapter;
    const chapterSummaryCache: ChapterSummaryCache = { read: vi.fn(() => null), write: vi.fn() };
    const blockingProvider: AIProvider = {
      modelVersion: 'test-model-v1',
      async *stream(_request, signal) {
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          ),
        );
      },
    };
    useGlossaPanelStore
      .getState()
      .open(selection, contextFor(selection), undefined, undefined, adapter, chapterSummaryCache);
    renderPanel(blockingProvider);
    await act(async () => {
      fireEvent.click(screen.getByText('Summarize read chapter'));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText('Cancel'));
    await act(async () => await Promise.resolve());
    expect(chapterSummaryCache.write).not.toHaveBeenCalled();
  });

  test('reports insufficient evidence without calling a provider when the chapter has no verified read blocks', async () => {
    const selection = selected('amber mark');
    const stream = vi.fn();
    const adapter = {
      getCurrentReadSectionText: vi.fn(async () => ({
        documentId: 'fixture-book',
        format: 'epub' as const,
        sectionId: 'chapter-1.xhtml',
        blocks: [],
      })),
    } as unknown as DocumentAdapter;
    const localProvider: AIProvider = { stream };
    useGlossaPanelStore
      .getState()
      .open(selection, contextFor(selection), undefined, undefined, adapter);
    renderPanel(localProvider);
    await act(async () => {
      fireEvent.click(screen.getByText('Summarize read chapter'));
      await Promise.resolve();
    });
    expect(stream).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Evidence insufficient: no verified read text is available in this chapter.',
      ),
    ).toBeTruthy();
  });

  test('sends free questions with Enter, keeps Shift+Enter as a newline, and uses a bounded history summary', async () => {
    const selection = selected('amber mark');
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel();
    const input = screen.getByPlaceholderText('Ask about the selected text');

    fireEvent.change(input, { target: { value: '这句话是什么意思？' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('这句话是什么意思？')).toBeTruthy();
    expect(screen.getByText(/回答（Mock）/u)).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe('');

    fireEvent.change(input, { target: { value: '第一行' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect((input as HTMLTextAreaElement).value).toBe('第一行');
    expect(screen.getByLabelText('Glossa conversation').textContent).not.toContain('第一行');

    fireEvent.change(input, { target: { value: '请换一种更简单的方式说明。' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/这次追问保留了同一文档中先前问题的摘要/u)).toBeTruthy();
  });

  test('adds only adapter-filtered read-keyword evidence before a free-question request', async () => {
    const selection = selected('amber mark');
    const retrieved = selected('A prior amber mark explains the term.');
    retrieved.anchor.cfi = 'epubcfi(/6/2!/4/3:0)';
    const searchReadText = vi.fn(async () => [retrieved]);
    const adapter = { searchReadText } as unknown as DocumentAdapter;
    const seenPacks: string[][] = [];
    const localProvider: AIProvider = {
      async *stream(request) {
        seenPacks.push(request.contextPack.segments.map(({ text }) => text));
        yield {
          type: 'complete',
          answer: {
            status: 'answered',
            paragraphs: [
              {
                text: 'Retrieved evidence answer.',
                sourceIds: [request.contextPack.segments.at(-1)!.sourceId],
                basis: 'document',
              },
            ],
            followups: [],
          },
        };
      },
    };
    useGlossaPanelStore
      .getState()
      .open(selection, contextFor(selection), undefined, undefined, adapter);
    renderPanel(localProvider);
    const input = screen.getByPlaceholderText('Ask about the selected text');
    fireEvent.change(input, { target: { value: 'What is an amber mark?' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(searchReadText).toHaveBeenCalledWith('amber mark', expect.any(Object));
    expect(seenPacks).toEqual([['amber mark', 'A prior amber mark explains the term.']]);
    expect(screen.getByText('Retrieved evidence answer.')).toBeTruthy();
  });

  test('does not send blank or overlong Unicode questions and shows a limit message', () => {
    const selection = selected('amber mark');
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel();
    const input = screen.getByPlaceholderText('Ask about the selected text');
    expect((screen.getByText('Send') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: '🙂'.repeat(2001) } });
    expect(screen.getByText('Questions must be 2,000 characters or fewer.')).toBeTruthy();
    expect((screen.getByText('Send') as HTMLButtonElement).disabled).toBe(true);
  });

  test('replaces a streaming free question, marks the old reply cancelled, and ignores its stale output', async () => {
    const aborted = vi.fn();
    const blockingProvider: AIProvider = {
      async *stream(request, signal) {
        yield { type: 'text-delta', text: `partial ${request.question}` };
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted();
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true },
          ),
        );
      },
    };
    const selection = selected('amber mark');
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel(blockingProvider);
    const input = screen.getByPlaceholderText('Ask about the selected text');
    fireEvent.change(input, { target: { value: 'first question' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => await Promise.resolve());
    fireEvent.change(input, { target: { value: 'second question' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => await Promise.resolve());
    expect(screen.getByText('Request cancelled.')).toBeTruthy();
    expect(screen.getByText('second question')).toBeTruthy();
    expect(aborted).toHaveBeenCalledOnce();
  });

  test('clears the ephemeral conversation on selection replacement and panel close', async () => {
    const selection = selected('amber mark');
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel();
    const input = screen.getByPlaceholderText('Ask about the selected text');
    fireEvent.change(input, { target: { value: '这句话是什么意思？' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('这句话是什么意思？')).toBeTruthy();

    const replacement = selected('shared margin');
    await act(async () =>
      useGlossaPanelStore.getState().open(replacement, contextFor(replacement)),
    );
    expect(screen.queryByText('这句话是什么意思？')).toBeNull();
    fireEvent.click(screen.getByLabelText('Close Glossa'));
    useGlossaPanelStore.getState().open(replacement, contextFor(replacement));
    expect(screen.queryByText('这句话是什么意思？')).toBeNull();
  });

  test('shows structured provider errors, cancellation, and source navigation without fetch', async () => {
    const errorProvider: AIProvider = {
      async *stream() {
        yield { type: 'error', error: { code: 'provider-error', message: 'Mock provider failed' } };
      },
    };
    const selection = selected('amber mark');
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel(errorProvider);
    await act(async () => {
      fireEvent.click(screen.getByText('Explain'));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toContain('Mock provider failed');
    expect(screen.getByText('Usage and estimated cost unavailable.')).toBeTruthy();
  });

  test('labels each local-answer paragraph as document or inference in text and aria metadata', async () => {
    const selection = selected('amber mark');
    const localProvider: AIProvider = {
      async *stream(request) {
        const sourceId = request.contextPack.segments[0]!.sourceId;
        yield {
          type: 'complete',
          answer: {
            status: 'answered',
            paragraphs: [
              { text: 'Direct evidence.', sourceIds: [sourceId], basis: 'document' },
              { text: 'Supported interpretation.', sourceIds: [sourceId], basis: 'inference' },
            ],
            followups: [],
          },
        };
      },
    };
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel(localProvider);
    await act(async () => {
      fireEvent.click(screen.getByText('Explain'));
      await Promise.resolve();
    });
    expect(screen.getByText('原文')).toBeTruthy();
    expect(screen.getByText('基于原文的推断')).toBeTruthy();
    expect(screen.getByLabelText('Paragraph basis: 原文')).toBeTruthy();
    expect(screen.getByLabelText('Paragraph basis: 基于原文的推断')).toBeTruthy();
  });

  test('only retries a recoverable error after the user clicks Retry', async () => {
    const selection = selected('amber mark');
    let calls = 0;
    const retryProvider: AIProvider = {
      async *stream(request) {
        calls++;
        if (calls === 1) {
          yield { type: 'error', error: { code: 'rate-limited', message: 'Slow down' } };
          return;
        }
        yield {
          type: 'complete',
          answer: {
            status: 'answered',
            paragraphs: [
              {
                text: 'Retried local result.',
                sourceIds: [request.contextPack.segments[0]!.sourceId],
                basis: 'document',
              },
            ],
            followups: [],
          },
        };
      },
    };
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel(retryProvider);
    await act(async () => {
      fireEvent.click(screen.getByText('Explain'));
      await Promise.resolve();
    });
    expect(calls).toBe(1);
    expect(screen.getByText('Retry')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Retry'));
      await Promise.resolve();
    });
    expect(calls).toBe(2);
    expect(screen.getByText('Retried local result.')).toBeTruthy();
  });

  test('cancels a streaming request from both Cancel and panel close', async () => {
    const aborted = vi.fn();
    const blockingProvider: AIProvider = {
      async *stream(_request, signal) {
        yield { type: 'text-delta', text: 'partial Mock answer' };
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted();
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true },
          ),
        );
      },
    };
    const selection = selected('amber mark');
    useGlossaPanelStore.getState().open(selection, contextFor(selection));
    renderPanel(blockingProvider);
    await act(async () => {
      fireEvent.click(screen.getByText('Explain'));
      await Promise.resolve();
    });
    expect(screen.getByText('partial Mock answer')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Request cancelled.')).toBeTruthy();
    expect(aborted).toHaveBeenCalledOnce();

    act(() => useGlossaPanelStore.getState().open(selection, contextFor(selection)));
    await act(async () => {
      fireEvent.click(screen.getByText('Explain'));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByLabelText('Close Glossa'));
    expect(aborted).toHaveBeenCalledTimes(2);
  });

  test('clicks a local source and returns through the existing navigator', async () => {
    const selection = selected('amber mark');
    const returned = vi.fn(async () => true);
    const navigate = vi.fn(async () => ({
      result: {
        status: 'resolved' as const,
        method: 'cfi' as const,
        exact: true,
        anchor: selection.anchor,
        canReturn: true,
      },
      returnToOrigin: returned,
      dispose: vi.fn(),
    }));
    const navigator: DocumentNavigator = { navigate, dispose: vi.fn() };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    useGlossaPanelStore.getState().open(selection, contextFor(selection), navigator);
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByText('Explain'));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Source 1-1'));
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(selection.anchor);
    await act(async () => {
      fireEvent.click(screen.getByText('Return to reading position'));
      await Promise.resolve();
    });
    expect(returned).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('keeps a completed historical answer source clickable after a follow-up', async () => {
    const selection = selected('amber mark');
    const navigate = vi.fn(async () => ({
      result: {
        status: 'resolved' as const,
        method: 'cfi' as const,
        exact: true,
        anchor: selection.anchor,
        canReturn: true,
      },
      returnToOrigin: vi.fn(async () => true),
      dispose: vi.fn(),
    }));
    useGlossaPanelStore.getState().open(selection, contextFor(selection), {
      navigate,
      dispose: vi.fn(),
    });
    renderPanel();
    const input = screen.getByPlaceholderText('Ask about the selected text');
    for (const question of ['这句话是什么意思？', '请换一种更简单的方式说明。']) {
      fireEvent.change(input, { target: { value: question } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Source 1-1'));
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(selection.anchor);
    expect(screen.getByLabelText('Source 2-1')).toBeTruthy();
  });
});
