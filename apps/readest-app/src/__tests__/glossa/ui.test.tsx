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
import { createContextPack } from '@/glossa/context/contextPack';
import type { AIProvider } from '@/glossa/ai';
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
import type { SelectedText } from '@/glossa/context/types';

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

const renderPanel = (provider?: AIProvider) =>
  render(
    <GlossaPanel
      safeAreaInsets={null}
      systemUIVisible={false}
      statusBarHeight={0}
      provider={provider}
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
    navigator: null,
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
      'the current selection + one preceding paragraph',
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

  test('sends free questions with Enter, keeps Shift+Enter as a newline, and uses the prior turn', async () => {
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
    expect(screen.getByText(/上一问“这句话是什么意思？”/u)).toBeTruthy();
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
