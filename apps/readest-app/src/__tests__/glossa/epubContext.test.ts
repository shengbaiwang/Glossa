import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  getEpubReadingContext,
  subscribeToEpubSelection,
  type EpubRuntime,
} from '@/glossa/context/epub';

const fixtureChapterOne = `
  <section id="chapter-1">
    <h1>The Aster Index / 星标索引</h1>
    <p id="c1-p1">The Aster Index records every amber mark before the reader turns the page.</p>
    <p id="c1-p2" lang="zh">星标索引在读者翻页前记录每一个琥珀色标记。</p>
    <p id="c1-p3">Its first rule is stable: an amber mark points to a passage, not to an answer.</p>
    <script>window.untrustedScriptText = 'not reading text';</script>
    <style>.hidden-copy { display: none; }</style>
    <p class="hidden-copy" style="display: none">Hidden fixture text must not be collected.</p>
    <p hidden="hidden">Hidden attribute text must not be collected.</p>
    <nav><p>Navigation text must not be collected.</p></nav>
  </section>`;

const makeDocument = (html: string) => {
  const doc = document.implementation.createHTMLDocument('fixture chapter');
  doc.body.innerHTML = html;
  return doc;
};

const selectText = (doc: Document, elementId: string, start: number, end: number) => {
  const node = doc.getElementById(elementId)?.firstChild;
  if (!node) throw new Error(`Missing fixture text node: ${elementId}`);
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = doc.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  // jsdom does not keep a Selection for detached documents created with
  // createHTMLDocument; foliate's iframe documents do. Mirror that iframe API.
  Object.defineProperty(doc, 'getSelection', {
    configurable: true,
    value: () => ({ rangeCount: 1, getRangeAt: () => range }),
  });
  return range;
};

const setVisibleRange = (runtime: EpubRuntime, range: Range) => {
  const viewLocation = runtime.view.lastLocation as { range: Range };
  viewLocation.range = range;
};

const makeRuntime = (doc: Document, range: Range | null, index = 0): EpubRuntime => {
  const loadTarget = new EventTarget();
  const visibleRange = doc.createRange();
  visibleRange.selectNodeContents(doc.body);
  return {
    view: {
      renderer: {
        getContents: () => [{ doc, index }],
      },
      getCFI: (sectionIndex, selectedRange) =>
        `epubcfi(/6/${sectionIndex + 2}!/${selectedRange.toString().length})`,
      lastLocation:
        range === null
          ? undefined
          : {
              cfi: 'epubcfi(/6/2!/4/1:0)',
              range: visibleRange,
              section: { current: index, total: 3 },
              location: { current: 2, next: 3, total: 9 },
              fraction: 0.25,
            },
      addEventListener: loadTarget.addEventListener.bind(loadTarget),
      removeEventListener: loadTarget.removeEventListener.bind(loadTarget),
    },
    progress: {
      location: 'epubcfi(/6/2!/4/1:0)',
      sectionHref: 'chapter-1.xhtml',
      sectionLabel: 'The Aster Index / 星标索引',
      section: { current: index, total: 3 },
      pageinfo: { current: 2, total: 9 },
      fraction: 0.25,
      index,
    },
  };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('EPUB reading context', () => {
  test('returns null when the loaded chapter has no selection', () => {
    const doc = makeDocument(fixtureChapterOne);
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const context = getEpubReadingContext(makeRuntime(doc, range));

    expect(context.selection).toBeNull();
  });

  test('reads exact selected fixture text without script, style, hidden, or navigation text', () => {
    const doc = makeDocument(fixtureChapterOne);
    const source = 'The Aster Index records every amber mark before the reader turns the page.';
    const range = selectText(doc, 'c1-p1', 4, 37);
    const context = getEpubReadingContext(makeRuntime(doc, range));

    expect(context.selection).toEqual({
      sectionIndex: 0,
      text: source.slice(4, 37),
      cfi: 'epubcfi(/6/2!/33)',
    });
    expect(context.visibleText.map((segment) => segment.text)).toEqual([
      'The Aster Index / 星标索引',
      source,
      '星标索引在读者翻页前记录每一个琥珀色标记。',
      'Its first rule is stable: an amber mark points to a passage, not to an answer.',
    ]);
  });

  test('returns the current chapter locator and progress from Readest progress state', () => {
    const doc = makeDocument(fixtureChapterOne);
    const range = selectText(doc, 'c1-p2', 0, 4);

    expect(getEpubReadingContext(makeRuntime(doc, range)).location).toEqual({
      sectionIndex: 0,
      sectionHref: 'chapter-1.xhtml',
      sectionLabel: 'The Aster Index / 星标索引',
      cfi: 'epubcfi(/6/2!/4/1:0)',
      chapterProgress: { current: 0, total: 3 },
      pageProgress: { current: 2, total: 9 },
      bookProgress: 0.25,
    });
  });

  test('keeps visible text in document order and bounds adjacent paragraphs to the active chapter', () => {
    const doc = makeDocument(fixtureChapterOne);
    const source = '星标索引在读者翻页前记录每一个琥珀色标记。';
    const range = selectText(doc, 'c1-p2', 0, source.length);
    const context = getEpubReadingContext(makeRuntime(doc, range), { adjacentParagraphs: 1 });

    expect(context.visibleText.map((segment) => segment.text)).toEqual([
      'The Aster Index / 星标索引',
      'The Aster Index records every amber mark before the reader turns the page.',
      source,
      'Its first rule is stable: an amber mark points to a passage, not to an answer.',
    ]);
    expect(context.selectionParagraphs.map((segment) => segment.text)).toEqual([
      'The Aster Index records every amber mark before the reader turns the page.',
      source,
      'Its first rule is stable: an amber mark points to a passage, not to an answer.',
    ]);
    expect(context.selectionParagraphs).toHaveLength(3);
  });

  test("clips visible text to foliate's actual visible range", () => {
    const doc = makeDocument(fixtureChapterOne);
    const source = 'The Aster Index records every amber mark before the reader turns the page.';
    const selected = selectText(doc, 'c1-p1', 0, 3);
    const runtime = makeRuntime(doc, selected);
    const visible = doc.createRange();
    visible.setStart(doc.getElementById('c1-p1')!.firstChild!, 4);
    visible.setEnd(doc.getElementById('c1-p2')!.firstChild!, 4);
    setVisibleRange(runtime, visible);

    expect(getEpubReadingContext(runtime).visibleText.map((segment) => segment.text)).toEqual([
      source.slice(4),
      '星标索引',
    ]);
  });

  test('safely degrades before a reader has initialized or for empty chapter text', () => {
    const emptyDoc = makeDocument('<section id="empty"></section>');
    const emptyRange = emptyDoc.createRange();
    emptyRange.selectNodeContents(emptyDoc.body);
    const uninitialized: EpubRuntime = {
      view: {
        renderer: { getContents: () => [] },
        getCFI: () => 'unused',
      },
      progress: null,
    };

    expect(getEpubReadingContext(uninitialized)).toEqual({
      selection: null,
      location: null,
      visibleText: [],
      selectionParagraphs: [],
    });
    expect(getEpubReadingContext(makeRuntime(emptyDoc, emptyRange))).toMatchObject({
      selection: null,
      visibleText: [],
      selectionParagraphs: [],
    });
  });

  test('does not register selection listeners while Glossa is disabled', () => {
    const doc = makeDocument(fixtureChapterOne);
    const range = selectText(doc, 'c1-p3', 0, 3);
    const runtime = makeRuntime(doc, range);
    const addListener = vi.spyOn(doc, 'addEventListener');
    const removeListener = vi.spyOn(doc, 'removeEventListener');

    getEpubReadingContext(runtime);
    expect(addListener).not.toHaveBeenCalledWith('selectionchange', expect.any(Function));

    const unsubscribe = subscribeToEpubSelection(runtime, vi.fn());
    expect(addListener).not.toHaveBeenCalledWith('selectionchange', expect.any(Function));
    unsubscribe();
    expect(removeListener).not.toHaveBeenCalledWith('selectionchange', expect.any(Function));
  });

  test('registers selection listeners only after Glossa is explicitly enabled and subscribed', () => {
    const doc = makeDocument(fixtureChapterOne);
    const range = selectText(doc, 'c1-p3', 0, 3);
    const runtime = makeRuntime(doc, range);
    const addListener = vi.spyOn(doc, 'addEventListener');
    const removeListener = vi.spyOn(doc, 'removeEventListener');
    const originalFlag = process.env['NEXT_PUBLIC_GLOSSA_ENABLED'];
    process.env['NEXT_PUBLIC_GLOSSA_ENABLED'] = 'true';

    const onSelection = vi.fn();
    const unsubscribe = subscribeToEpubSelection(runtime, onSelection);
    expect(addListener).toHaveBeenCalledWith('selectionchange', expect.any(Function));

    doc.dispatchEvent(new Event('selectionchange'));
    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({ text: 'Its' }));

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith('selectionchange', expect.any(Function));
    if (originalFlag === undefined) {
      delete process.env['NEXT_PUBLIC_GLOSSA_ENABLED'];
    } else {
      process.env['NEXT_PUBLIC_GLOSSA_ENABLED'] = originalFlag;
    }
  });
});
