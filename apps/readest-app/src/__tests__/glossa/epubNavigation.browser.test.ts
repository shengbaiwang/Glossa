import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createEpubAnchorNavigator, type EpubNavigationRuntime, type SourceAnchor } from '@/glossa';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';

const EPUB_URL = new URL('../fixtures/data/glossa-reading-sample.epub', import.meta.url).href;
const DOCUMENT_ID = 'glossa-reading-sample';

const QUOTES = [
  [
    'The Aster Index',
    'records every amber mark',
    'reader turns the page',
    '星标索引',
    '读者翻页前记录',
    '琥珀色标记',
    'first rule is stable',
    'amber mark',
    'passage, not to an answer',
  ],
  [
    'The Shared Margin',
    'shared margin connects',
    'new question',
    'Aster Index',
    '共享页边',
    '新问题连接',
    '保留原始段落',
    'amber mark',
    'compare evidence across chapters',
  ],
  [
    'Return Signals',
    'return signal brings',
    'shared margin back',
    'exact amber mark',
    '回读信号',
    '共享页边带回',
    '确切琥珀色标记',
    'supports recall',
    'earlier chapter',
  ],
] as const;

const LAYOUTS = [
  { width: 640, fontSize: 16, flow: 'paginated' },
  { width: 920, fontSize: 20, flow: 'paginated' },
  { width: 720, fontSize: 24, flow: 'scrolled' },
  { width: 1100, fontSize: 18, flow: 'scrolled' },
] as const;

type BuiltAnchor = { anchor: SourceAnchor; index: number; cfi: string };

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
  const buffer = await response.arrayBuffer();
  const file = new File([buffer], 'glossa-reading-sample.epub', {
    type: 'application/epub+zip',
  });
  return (await new DocumentLoader(file).open()).book;
};

const findTextRange = (doc: Document, exact: string): Range => {
  const showText = doc.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(doc.body, showText);
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

const rendered = (view: FoliateView, index: number) => {
  const content = view.renderer.getContents().find((item) => item.index === index);
  if (!content?.doc) throw new Error(`Section ${index} did not render`);
  return content;
};

const normalize = (value: string) => value.replace(/[\s\u00a0]+/gu, ' ').trim();

const resolvedLiveRange = (view: FoliateView, cfi: string): Range | null => {
  const resolved = view.resolveCFI(cfi);
  const content = view.renderer.getContents().find(({ index }) => index === resolved.index);
  if (!content?.doc || typeof resolved.anchor !== 'function') return null;
  return resolved.anchor(content.doc);
};

const isRangeVisible = (view: FoliateView, range: Range): boolean => {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
  if (!(frame instanceof HTMLElement)) return false;
  const viewport = view.getBoundingClientRect();
  const frameRect = frame.getBoundingClientRect();
  return Array.from(range.getClientRects()).some((rect) => {
    const left = frameRect.left + rect.left;
    const right = frameRect.left + rect.right;
    const top = frameRect.top + rect.top;
    const bottom = frameRect.top + rect.bottom;
    return (
      right > viewport.left &&
      left < viewport.right &&
      bottom > viewport.top &&
      top < viewport.bottom
    );
  });
};

describe('EPUB anchor recovery under real foliate reflow (browser)', () => {
  let book: BookDoc;
  let view: FoliateView;
  let runtime: EpubNavigationRuntime;
  let anchors: BuiltAnchor[];

  beforeAll(async () => {
    book = await loadBook();
    await import('foliate-js/view.js');
    view = document.createElement('foliate-view') as FoliateView;
    Object.assign(view.style, {
      width: '900px',
      height: '700px',
      position: 'absolute',
      inset: '0',
    });
    document.body.appendChild(view);
    await view.open(book);
    runtime = { view: view as unknown as EpubNavigationRuntime['view'], progress: null };

    anchors = [];
    for (const [index, sectionQuotes] of QUOTES.entries()) {
      await Promise.resolve(view.goTo(index));
      const { doc } = rendered(view, index);
      const sectionId = book.sections[index]?.href ?? `spine:${index}`;
      for (const exact of sectionQuotes) {
        const range = findTextRange(doc, exact);
        anchors.push({
          index,
          cfi: view.getCFI(index, range),
          anchor: {
            version: 1,
            documentId: DOCUMENT_ID,
            format: 'epub',
            sectionId,
            cfi: view.getCFI(index, range),
            quote: quoteForRange(range, exact),
          },
        });
      }
    }
  }, 30000);

  afterAll(() => {
    try {
      view?.close();
    } finally {
      view?.remove();
    }
  });

  test('recovers at least 99% of 108 anchors across font, width, pagination, and scroll changes', async () => {
    const navigator = createEpubAnchorNavigator({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
      timeoutMs: 10000,
      highlightDurationMs: 0,
    });
    let successes = 0;
    let total = 0;
    const failures: string[] = [];

    for (const layout of LAYOUTS) {
      await settleReflow(view, () => {
        view.style.width = `${layout.width}px`;
        view.renderer.setAttribute('flow', layout.flow);
        view.renderer.setStyles?.(`:root { font-size: ${layout.fontSize}px !important; }`);
      });

      for (const [anchorIndex, built] of anchors.entries()) {
        const sameSection = anchors.filter(({ index }) => index === built.index);
        const staleCfi = sameSection[(sameSection.indexOf(built) + 1) % sameSection.length]!.cfi;
        const variant = anchorIndex % 3;
        const candidate: SourceAnchor = {
          ...built.anchor,
          ...(variant === 0 ? {} : variant === 1 ? { cfi: undefined } : { cfi: staleCfi }),
        };
        const session = await navigator.navigate(candidate);
        total++;
        if (session.result.status === 'resolved' && session.result.exact) {
          const liveRange = session.result.anchor.cfi
            ? resolvedLiveRange(view, session.result.anchor.cfi)
            : null;
          const recovered = normalize(liveRange?.toString() ?? '');
          if (
            recovered === normalize(candidate.quote.exact) &&
            liveRange &&
            isRangeVisible(view, liveRange)
          )
            successes++;
          else
            failures.push(
              `${layout.flow}/${layout.width}/${anchorIndex}/${session.result.method}/${candidate.quote.exact}/${recovered}/${view.renderer.primaryIndex}`,
            );
        } else {
          failures.push(
            `${layout.flow}/${layout.width}/${anchorIndex}/${JSON.stringify(session.result)}`,
          );
        }
      }
    }

    navigator.dispose();
    expect(total).toBe(108);
    expect(successes / total, failures.join('\n')).toBeGreaterThanOrEqual(0.99);
    expect(successes).toBe(total);
  }, 120000);

  test('recovers after equivalent text-node splitting and ordinary whitespace reflow', async () => {
    const exact = 'Index records every amber mark';
    await Promise.resolve(view.goTo(0));
    const originalDoc = rendered(view, 0).doc;
    const originalRange = findTextRange(originalDoc, exact);
    const source: SourceAnchor = {
      version: 1,
      documentId: DOCUMENT_ID,
      format: 'epub',
      sectionId: book.sections[0]?.href ?? 'spine:0',
      cfi: view.getCFI(0, originalRange),
      quote: quoteForRange(originalRange, exact),
    };
    const node = originalRange.startContainer as Text;
    node.data = node.data.replace(exact, 'Index\n  records every amber mark');
    node.splitText(Math.max(1, node.data.indexOf('records')));
    await settleReflow(view, () => {
      view.style.width = '680px';
      view.renderer.setAttribute('flow', 'scrolled');
      view.renderer.setStyles?.(':root { font-size: 23px !important; }');
    });
    const navigator = createEpubAnchorNavigator({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
      highlightDurationMs: 0,
    });

    const result = (await navigator.navigate(source)).result;

    expect(result).toMatchObject({ status: 'resolved', exact: true });
    if (result.status === 'resolved') expect(['cfi', 'text-quote']).toContain(result.method);
    const recovered =
      result.status === 'resolved' && result.anchor.cfi
        ? resolvedLiveRange(view, result.anchor.cfi)
        : null;
    expect(normalize(recovered?.toString() ?? '')).toBe(normalize(exact));
    expect(recovered && isRangeVisible(view, recovered)).toBe(true);
    navigator.dispose();
  });

  test('shows and removes a real non-persistent overlayer, then returns to the origin', async () => {
    await Promise.resolve(view.goTo(2));
    const originCfi = view.lastLocation?.cfi;
    expect(originCfi).toBeTruthy();
    const navigator = createEpubAnchorNavigator({
      documentId: DOCUMENT_ID,
      getRuntime: () => runtime,
      highlightDurationMs: 80,
      highlightColor: '#f0b429',
    });

    const session = await navigator.navigate(anchors[1]!.anchor);
    const target = rendered(view, 0);
    const overlayElement = (target.overlayer as { element?: SVGSVGElement } | undefined)?.element;

    expect(session.result).toMatchObject({ status: 'resolved', exact: true, canReturn: true });
    expect(overlayElement?.querySelector('g[fill="#f0b429"]')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(overlayElement?.querySelector('g[fill="#f0b429"]')).toBeNull();
    await expect(session.returnToOrigin()).resolves.toBe(true);
    const returned = view.resolveCFI(view.lastLocation!.cfi!);
    const origin = view.resolveCFI(originCfi!);
    expect(returned.index).toBe(origin.index);
    navigator.dispose();
  });
});
