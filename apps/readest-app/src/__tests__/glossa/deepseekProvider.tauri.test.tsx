import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({
    panelRef: { current: null },
    overlayRef: { current: null },
    panelHeight: { current: 1 },
    handleVerticalDragStart: vi.fn(),
  }),
}));
vi.mock('@/hooks/usePanelResize', () => ({
  usePanelResize: () => ({ handleResizeStart: vi.fn(), handleResizeKeyDown: vi.fn() }),
}));

import {
  createEpubAnchorNavigator,
  createEpubDocumentAdapter,
  type EpubNavigationRuntime,
} from '@/glossa';
import { DeepSeekProvider, createDeepSeekKeychain } from '@/glossa/ai';
import { createContextPack } from '@/glossa/context/contextPack';
import GlossaPanel from '@/glossa/ui/GlossaPanel';
import { useGlossaPanelStore } from '@/glossa/ui/glossaPanelStore';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EPUB_URL = new URL('../fixtures/data/glossa-reading-sample.epub', import.meta.url).href;
const DOCUMENT_ID = 'glossa-deepseek-tauri';
const TEST_KEY_NAME = 'glossa.test.deepseek.api-key.v1';
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const loadBook = async (): Promise<BookDoc> => {
  const response = await fetch(EPUB_URL);
  expect(response.ok).toBe(true);
  return (
    await new DocumentLoader(
      new File([await response.arrayBuffer()], 'glossa-reading-sample.epub'),
    ).open()
  ).book;
};

const findTextRange = (doc: Document, exact: string): Range => {
  const walker = doc.createTreeWalker(doc.body, doc.defaultView?.NodeFilter.SHOW_TEXT ?? 4);
  let candidate: Node | null;
  while ((candidate = walker.nextNode())) {
    const text = candidate as Text;
    const start = text.data.indexOf(exact);
    if (start < 0) continue;
    const range = doc.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + exact.length);
    return range;
  }
  throw new Error(`Fixture quote not found: ${exact}`);
};

describe('DeepSeek Glossa loop in the macOS Tauri WebView', () => {
  let view: FoliateView;
  let runtime: EpubNavigationRuntime;
  let host: HTMLDivElement;
  let root: Root;
  const keychain = createDeepSeekKeychain(TEST_KEY_NAME);

  beforeAll(async () => {
    expect((window.top ?? window) as unknown as Record<string, unknown>).toHaveProperty(
      '__TAURI_INTERNALS__',
    );
    await keychain.clear().catch(() => undefined);
    await keychain.save('test-only-key');
    expect(await keychain.getStatus()).toEqual({ available: true, configured: true });
    await import('foliate-js/view.js');
    view = document.createElement('foliate-view') as FoliateView;
    Object.assign(view.style, { width: '760px', height: '620px', position: 'absolute' });
    document.body.appendChild(view);
    await view.open(await loadBook());
    runtime = { view: view as unknown as EpubNavigationRuntime['view'], progress: null };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }, 30000);

  afterAll(async () => {
    await act(async () => root?.unmount());
    await keychain.clear();
    expect(await keychain.getStatus()).toEqual({ available: true, configured: false });
    host?.remove();
    view?.close();
    view?.remove();
  });

  test('uses the local fake SSE service, validates local source IDs, jumps, and returns', async () => {
    await Promise.resolve(view.goTo(0));
    const chapter = view.renderer.getContents().find((content) => content.index === 0)!;
    const exact = 'records every amber mark';
    const selectionRange = findTextRange(chapter.doc, exact);
    chapter.doc.getSelection()?.removeAllRanges();
    chapter.doc.getSelection()?.addRange(selectionRange);
    const adapter = createEpubDocumentAdapter({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
    });
    const selection = await adapter.getSelection();
    const contextPack = createContextPack({
      selection: selection!,
      selectionContext: await adapter.getSelectionContext({ adjacentParagraphs: 1 }),
    });
    const navigator = createEpubAnchorNavigator({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
    });
    const localFakeSSEFetch: typeof fetch = async (_input, init) => {
      const currentMessage = JSON.parse(String(init?.body)).messages.at(-1).content;
      const sourceId = JSON.parse(currentMessage).contextPack.excerpts[0].sourceId;
      const answer = JSON.stringify({
        status: 'answered',
        paragraphs: [
          {
            text: 'The local fake SSE service confirmed the selected reading evidence.',
            sourceIds: [sourceId],
            basis: 'document',
          },
        ],
        followups: [],
      });
      return new Response(
        `: test keep-alive\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' }, status: 200 },
      );
    };
    const provider = new DeepSeekProvider({
      // The WebDriver iframe cannot reach its isolated loopback Next port.
      // This in-process transport has the exact local SSE response contract;
      // production leaves fetch unset and uses getAIFetch() / Tauri Rust HTTP.
      getApiKey: keychain.getKeyForRequest,
      fetch: localFakeSSEFetch,
    });
    await act(async () => {
      useGlossaPanelStore.setState({
        isOpen: true,
        isPinned: false,
        isCollapsed: false,
        width: '32%',
        selection,
        contextPack,
        navigator,
      });
      root.render(
        React.createElement(GlossaPanel, {
          safeAreaInsets: null,
          systemUIVisible: false,
          statusBarHeight: 0,
          provider,
        }),
      );
    });
    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent === 'Explain')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(host.textContent).toContain('local fake SSE service confirmed'), {
      timeout: 5000,
    });
    const source = host.querySelector('[aria-label="Source 1-1"]') as HTMLButtonElement;
    expect(source.textContent).toContain(exact);

    await Promise.resolve(view.goTo(2));
    const originIndex = view.resolveCFI(view.lastLocation!.cfi!).index;
    await act(async () => source.click());
    await nextFrame();
    expect(
      (chapter.overlayer as { element?: SVGSVGElement }).element?.querySelector(
        'g[fill="#f0b429"]',
      ),
    ).toBeTruthy();
    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Return to reading position'))
        ?.click();
    });
    await nextFrame();
    expect(view.resolveCFI(view.lastLocation!.cfi!).index).toBe(originIndex);
    navigator.dispose();
  });
});
