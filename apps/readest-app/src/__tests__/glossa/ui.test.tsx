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

import GlossaPanel from '@/glossa/ui/GlossaPanel';
import { useGlossaPanelStore } from '@/glossa/ui/glossaPanelStore';
import { createContextPack } from '@/glossa/context/contextPack';
import type { AIProvider } from '@/glossa/ai';
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
});

afterEach(() => {
  cleanup();
  if (originalFlag === undefined) delete env[flagName];
  else env[flagName] = originalFlag;
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
    expect(screen.getByLabelText('Source 1').textContent).toContain('amber mark');

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
      fireEvent.click(screen.getByLabelText('Source 1'));
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
});
