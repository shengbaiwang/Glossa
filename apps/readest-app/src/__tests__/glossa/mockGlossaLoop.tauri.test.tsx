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
import { createContextPack } from '@/glossa/context/contextPack';
import { createGlossaSourcedNoteStore } from '@/glossa/notes/glossaSourcedNotes';
import GlossaPanel from '@/glossa/ui/GlossaPanel';
import { useGlossaPanelStore } from '@/glossa/ui/glossaPanelStore';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { DocumentAdapter } from '@/glossa/context/types';
import type { FoliateView } from '@/types/view';
import type { BookConfig } from '@/types/book';
import type { AppService } from '@/types/system';

// The WebDriver browser runner is a real iframe rather than jsdom, so opt it
// into React's asynchronous act flushing for this interaction specification.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EPUB_URL = new URL('../fixtures/data/glossa-reading-sample.epub', import.meta.url).href;
const DOCUMENT_ID = 'glossa-reading-sample-tauri';

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
    const node = candidate as Text;
    const start = node.data.indexOf(exact);
    if (start < 0) continue;
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + exact.length);
    return range;
  }
  throw new Error(`Fixture quote not found: ${exact}`);
};

describe('Mock Glossa reading loop in the macOS Tauri WebView', () => {
  let view: FoliateView;
  let runtime: EpubNavigationRuntime;
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    expect((window.top ?? window) as unknown as Record<string, unknown>).toHaveProperty(
      '__TAURI_INTERNALS__',
    );
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
    host?.remove();
    view?.close();
    view?.remove();
  });

  test('uses Mock for selection actions, a chapter summary, saved notes, exports, and citation return', async () => {
    await Promise.resolve(view.goTo(0));
    const chapterOne = view.renderer.getContents().find((content) => content.index === 0)!;
    const exact = 'records every amber mark';
    const range = findTextRange(chapterOne.doc, exact);
    chapterOne.doc.getSelection()?.removeAllRanges();
    chapterOne.doc.getSelection()?.addRange(range);
    const adapter = createEpubDocumentAdapter({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
    });
    const selection = await adapter.getSelection();
    expect(selection?.text).toBe(exact);
    const contextPack = createContextPack({
      selection: selection!,
      selectionContext: await adapter.getSelectionContext({ adjacentParagraphs: 1 }),
    });
    const summaryAdapter: DocumentAdapter = {
      ...adapter,
      getCurrentReadSectionText: async () => ({
        documentId: DOCUMENT_ID,
        format: 'epub',
        sectionId: selection!.anchor.sectionId!,
        blocks: contextPack.segments.map((segment, order) => ({
          text: segment.text,
          anchor: segment.anchor,
          kind: 'paragraph',
          order,
        })),
      }),
    };
    const navigator = createEpubAnchorNavigator({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
      highlightDurationMs: 1000,
    });
    let config: BookConfig = { bookHash: DOCUMENT_ID, updatedAt: 1 };
    const sourcedNoteStore = createGlossaSourcedNoteStore({
      documentId: DOCUMENT_ID,
      getEntries: () => config.glossaSourcedNotes,
      writeEntries: async (entries) => {
        config = { ...config, glossaSourcedNotes: entries };
      },
    });
    const savedExports: string[] = [];
    const saveFile: AppService['saveFile'] = async (filename, content) => {
      savedExports.push(`${filename}:${String(content)}`);
      return true;
    };
    const addAnnotationSpy = vi.spyOn(view, 'addAnnotation');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await act(async () => {
      useGlossaPanelStore.setState({
        isOpen: true,
        isPinned: false,
        isCollapsed: false,
        width: '32%',
        selection,
        contextPack,
        navigator,
        adapter: summaryAdapter,
        sourcedNoteStore,
      });
      root.render(
        React.createElement(GlossaPanel, {
          safeAreaInsets: null,
          systemUIVisible: false,
          statusBarHeight: 0,
          appService: { saveFile } as AppService,
        }),
      );
    });
    await nextFrame();
    await nextFrame();
    expect(host.textContent).toContain('选区 + 同章节前 1 段 · 未使用后文');

    await act(async () => {
      (
        Array.from(host.querySelectorAll('button')).find(
          (button) => button.textContent === 'Explain',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await nextFrame();
    await nextFrame();
    expect(host.textContent).toContain('解释（Mock）');
    const saveNote = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save as note',
    ) as HTMLButtonElement;
    await act(async () => saveNote.click());
    expect(host.textContent).toContain('Note saved locally.');
    expect(config.glossaSourcedNotes?.[0]?.sources).toHaveLength(1);
    await act(async () => {
      (
        Array.from(host.querySelectorAll('button')).find(
          (button) => button.textContent === 'Translate',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await nextFrame();
    expect(host.textContent).toContain('翻译（Mock）');
    await act(async () => {
      (
        Array.from(host.querySelectorAll('button')).find(
          (button) => button.textContent === 'Summarize read chapter',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await nextFrame();
    expect(host.textContent).toContain('核心观点（Mock）');
    config = JSON.parse(JSON.stringify(config)) as BookConfig;
    const reloadedNoteStore = createGlossaSourcedNoteStore({
      documentId: DOCUMENT_ID,
      getEntries: () => config.glossaSourcedNotes,
      writeEntries: async (entries) => {
        config = { ...config, glossaSourcedNotes: entries };
      },
    });
    await act(async () => {
      useGlossaPanelStore.getState().close();
      useGlossaPanelStore
        .getState()
        .open(
          selection!,
          contextPack,
          navigator,
          undefined,
          summaryAdapter,
          undefined,
          reloadedNoteStore,
        );
    });
    await nextFrame();
    await nextFrame();
    const source = host.querySelector('[aria-label="Saved note source 1-1"]') as HTMLButtonElement;
    expect(source.textContent).toContain(exact);

    await Promise.resolve(view.goTo(2));
    const originIndex = view.resolveCFI(view.lastLocation!.cfi!).index;
    await act(async () => source.click());
    await nextFrame();
    await nextFrame();
    const overlay = chapterOne.overlayer as { element?: SVGSVGElement };
    expect(overlay.element?.querySelector('g[fill="#f0b429"]')).toBeTruthy();
    const returnButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Return to reading position'),
    ) as HTMLButtonElement;
    expect(returnButton.textContent).toContain('Return to reading position');
    await act(async () => returnButton.click());
    await nextFrame();
    expect(view.resolveCFI(view.lastLocation!.cfi!).index).toBe(originIndex);
    await act(async () => {
      (
        Array.from(host.querySelectorAll('button')).find(
          (button) => button.textContent === 'Export Markdown',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    await nextFrame();
    await act(async () => {
      (
        Array.from(host.querySelectorAll('button')).find(
          (button) => button.textContent === 'Export JSON',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(savedExports).toHaveLength(2);
    expect(savedExports[0]).toContain(`${DOCUMENT_ID}-glossa-notes.md:`);
    expect(savedExports[1]).toContain(`${DOCUMENT_ID}-glossa-notes.json:`);
    expect(addAnnotationSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    addAnnotationSpy.mockRestore();
    fetchSpy.mockRestore();
    navigator.dispose();
  });
});
