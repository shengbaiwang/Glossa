import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { createEpubDocumentAdapter, type SelectedText } from '@/glossa';
import type { EpubRuntime } from '@/glossa/context/epub';
import { captureAndOpenGlossaPanel } from '@/glossa/ui/selectionAction';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';

const EPUB_URL = new URL('../fixtures/data/glossa-reading-sample.epub', import.meta.url).href;

const loadBook = async (): Promise<BookDoc> => {
  const response = await fetch(EPUB_URL);
  expect(response.ok).toBe(true);
  const file = new File([await response.arrayBuffer()], 'glossa-reading-sample.epub', {
    type: 'application/epub+zip',
  });
  return (await new DocumentLoader(file).open()).book;
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

describe('Glossa EPUB selection in the macOS Tauri WebView', () => {
  let view: FoliateView;

  beforeAll(async () => {
    expect((window.top ?? window) as unknown as Record<string, unknown>).toHaveProperty(
      '__TAURI_INTERNALS__',
    );
    await import('foliate-js/view.js');
    view = document.createElement('foliate-view') as FoliateView;
    Object.assign(view.style, { width: '760px', height: '620px', position: 'absolute' });
    document.body.appendChild(view);
    await view.open(await loadBook());
    await Promise.resolve(view.goTo(0));
  }, 30000);

  afterAll(() => {
    view?.close();
    view?.remove();
  });

  test('captures a real EPUB Selection before consuming it and performs no writes or requests', async () => {
    const content = view.renderer.getContents().find((item) => item.index === 0);
    expect(content?.doc).toBeTruthy();
    const doc = content!.doc;
    const exact = 'records every amber mark';
    const range = findTextRange(doc, exact);
    const nativeSelection = doc.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    const runtime: EpubRuntime = { view, progress: null };
    const adapter = createEpubDocumentAdapter({
      documentId: 'glossa-reading-sample-tauri',
      getRuntime: () => runtime,
    });
    const open = vi.fn<(selection: SelectedText) => void>();
    const addAnnotationSpy = vi.spyOn(view, 'addAnnotation');
    const pushStateSpy = vi.spyOn(history, 'pushState');
    const replaceStateSpy = vi.spyOn(history, 'replaceState');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(await captureAndOpenGlossaPanel(() => adapter.getSelection(), open)).toBe(true);
    const snapshot = open.mock.calls[0]?.[0];
    expect(snapshot).toMatchObject({
      text: exact,
      anchor: {
        documentId: 'glossa-reading-sample-tauri',
        format: 'epub',
        quote: { exact },
      },
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);

    // The calling integration consumes the browser Selection only after this
    // verified snapshot exists; neither half writes Readest reader state.
    view.deselect();
    expect(doc.getSelection()?.rangeCount).toBe(0);
    expect(addAnnotationSpy).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    addAnnotationSpy.mockRestore();
    pushStateSpy.mockRestore();
    replaceStateSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});
