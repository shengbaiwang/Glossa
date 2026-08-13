import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { createEpubAnchorNavigator, type EpubNavigationRuntime, type SourceAnchor } from '@/glossa';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';

const EPUB_URL = new URL('../fixtures/data/glossa-reading-sample.epub', import.meta.url).href;
const DOCUMENT_ID = 'glossa-reading-sample-tauri';
const HIGHLIGHT_COLOR = '#f0b429';

type LiveOverlayer = {
  add(key: string, range: Range, draw: unknown, options?: { color?: string }): void;
  remove(key: string): void;
  element?: SVGSVGElement;
};

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const settleReflow = async (view: FoliateView, mutate: () => void) => {
  const renderer = view.renderer;
  const stabilized = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      renderer.removeEventListener('stabilized', onStabilized);
      resolve();
    }, 1000);
    const onStabilized: EventListener = () => {
      clearTimeout(timer);
      renderer.removeEventListener('stabilized', onStabilized);
      resolve();
    };
    renderer.addEventListener('stabilized', onStabilized);
  });
  mutate();
  await stabilized;
  await nextFrame();
  await nextFrame();
};

const loadBook = async (): Promise<BookDoc> => {
  const response = await fetch(EPUB_URL);
  expect(response.ok).toBe(true);
  const file = new File([await response.arrayBuffer()], 'glossa-reading-sample.epub', {
    type: 'application/epub+zip',
  });
  return (await new DocumentLoader(file).open()).book;
};

const rendered = (view: FoliateView, index: number) => {
  const content = view.renderer.getContents().find((item) => item.index === index);
  if (!content?.doc) throw new Error(`Section ${index} did not render`);
  return content;
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

const quoteForRange = (range: Range, exact: string): SourceAnchor['quote'] => {
  const container =
    range.startContainer.parentElement?.closest('p, h1') ?? range.startContainer.parentElement;
  const text = container?.textContent ?? exact;
  const start = text.indexOf(exact);
  return {
    exact,
    ...(start > 0 ? { prefix: Array.from(text.slice(0, start)).slice(-48).join('') } : {}),
    ...(start >= 0 && start + exact.length < text.length
      ? {
          suffix: Array.from(text.slice(start + exact.length))
            .slice(0, 48)
            .join(''),
        }
      : {}),
  };
};

const visible = (view: FoliateView, range: Range) => {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
  if (!(frame instanceof HTMLElement)) return false;
  const viewport = view.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  return Array.from(range.getClientRects()).some((rect) => {
    const left = frameRect.left + rect.left;
    const top = frameRect.top + rect.top;
    const right = frameRect.left + rect.right;
    const bottom = frameRect.top + rect.bottom;
    return (
      right > viewport.left &&
      left < viewport.right &&
      bottom > viewport.top &&
      top < viewport.bottom
    );
  });
};

const resolvedRange = (view: FoliateView, cfi: string): Range | null => {
  const resolved = view.resolveCFI(cfi);
  const content = view.renderer.getContents().find(({ index }) => index === resolved.index);
  return content?.doc && typeof resolved.anchor === 'function'
    ? resolved.anchor(content.doc)
    : null;
};

describe('EPUB anchor navigation in the macOS Tauri WebView', () => {
  let book: BookDoc;
  let view: FoliateView;
  let runtime: EpubNavigationRuntime;
  let chapterOne: SourceAnchor;
  let staleChapterOneCfi: string;

  beforeAll(async () => {
    expect((window.top ?? window) as unknown as Record<string, unknown>).toHaveProperty(
      '__TAURI_INTERNALS__',
    );
    await import('foliate-js/view.js');
    book = await loadBook();
    view = document.createElement('foliate-view') as FoliateView;
    Object.assign(view.style, {
      width: '760px',
      height: '620px',
      position: 'absolute',
      inset: '0',
    });
    document.body.appendChild(view);
    await view.open(book);
    runtime = { view: view as unknown as EpubNavigationRuntime['view'], progress: null };

    await Promise.resolve(view.goTo(0));
    const targetRange = findTextRange(rendered(view, 0).doc, 'records every amber mark');
    chapterOne = {
      version: 1,
      documentId: DOCUMENT_ID,
      format: 'epub',
      sectionId: book.sections[0]?.href ?? 'spine:0',
      cfi: view.getCFI(0, targetRange),
      quote: quoteForRange(targetRange, 'records every amber mark'),
    };
    staleChapterOneCfi = view.getCFI(0, findTextRange(rendered(view, 0).doc, 'The Aster Index'));
  }, 30000);

  afterAll(() => {
    try {
      view?.close();
    } finally {
      view?.remove();
    }
  });

  test('returns to a reflowed chapter-one source in the real WebView', async () => {
    await Promise.resolve(view.goTo(2));
    const originCfi = view.lastLocation?.cfi;
    expect(originCfi).toBeTruthy();
    await settleReflow(view, () => {
      view.style.width = '640px';
      view.renderer.setAttribute('flow', 'scrolled');
      view.renderer.setStyles?.(':root { font-size: 23px !important; }');
    });
    const navigator = createEpubAnchorNavigator({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
      highlightDurationMs: 0,
    });
    const session = await navigator.navigate(chapterOne);
    expect(session.result).toMatchObject({ status: 'resolved', exact: true, canReturn: true });
    if (session.result.status === 'resolved') {
      expect(['cfi', 'text-quote']).toContain(session.result.method);
      const range = resolvedRange(view, session.result.anchor.cfi!);
      expect(range?.toString()).toBe(chapterOne.quote.exact);
      expect(range && visible(view, range)).toBe(true);
    }
    navigator.dispose();
  });

  test('uses a transient SVG overlay only, cleans it, and returns once without history', async () => {
    await Promise.resolve(view.goTo(2));
    const originCfi = view.lastLocation?.cfi;
    const addAnnotation = view.addAnnotation.bind(view);
    const addAnnotationSpy = vi.fn(addAnnotation);
    const pushStateSpy = vi.spyOn(history, 'pushState');
    const replaceStateSpy = vi.spyOn(history, 'replaceState');
    view.addAnnotation = addAnnotationSpy;
    const target = rendered(view, 0);
    const originalHtml = target.doc.body.innerHTML;
    const overlayer = target.overlayer as LiveOverlayer;
    const userRange = findTextRange(target.doc, 'amber mark');
    const userKey = chapterOne.cfi!;
    overlayer.add(
      userKey,
      userRange,
      (await import('foliate-js/overlayer.js')).Overlayer.highlight,
      {
        color: '#00aaff',
      },
    );
    const navigator = createEpubAnchorNavigator({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
      highlightDurationMs: 40,
      highlightColor: HIGHLIGHT_COLOR,
    });
    const session = await navigator.navigate(chapterOne);
    expect(session.result).toMatchObject({ status: 'resolved', exact: true, canReturn: true });
    const overlay = (rendered(view, 0).overlayer as { element?: SVGSVGElement }).element;
    expect(overlay?.querySelector('g[fill="#f0b429"]')).toBeTruthy();
    expect(overlay?.querySelector('g[fill="#00aaff"]')).toBeTruthy();
    expect(rendered(view, 0).doc.body.innerHTML).toBe(originalHtml);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(overlay?.querySelector('g[fill="#f0b429"]')).toBeNull();
    expect(overlay?.querySelector('g[fill="#00aaff"]')).toBeTruthy();
    expect(await session.returnToOrigin()).toBe(true);
    expect(view.resolveCFI(view.lastLocation!.cfi!).index).toBe(view.resolveCFI(originCfi!).index);
    expect(await session.returnToOrigin()).toBe(false);
    expect(addAnnotationSpy).not.toHaveBeenCalled();
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
    overlayer.remove(userKey);
    navigator.dispose();

    const immediate = createEpubAnchorNavigator({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
      highlightDurationMs: 1000,
      highlightColor: HIGHLIGHT_COLOR,
    });
    await immediate.navigate(chapterOne);
    expect(overlay?.querySelector('g[fill="#f0b429"]')).toBeTruthy();
    immediate.dispose();
    expect(overlay?.querySelector('g[fill="#f0b429"]')).toBeNull();
    view.addAnnotation = addAnnotation;
    pushStateSpy.mockRestore();
    replaceStateSpy.mockRestore();
  });

  test('recovers a stale CFI by its unique section TextQuote', async () => {
    await Promise.resolve(view.goTo(2));
    const navigator = createEpubAnchorNavigator({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
      highlightDurationMs: 0,
    });
    const session = await navigator.navigate({ ...chapterOne, cfi: staleChapterOneCfi });
    expect(session.result).toMatchObject({ status: 'resolved', method: 'text-quote', exact: true });
    if (session.result.status === 'resolved') {
      const range = resolvedRange(view, session.result.anchor.cfi!);
      expect(range?.toString()).toBe(chapterOne.quote.exact);
    }
    navigator.dispose();
  });
});
