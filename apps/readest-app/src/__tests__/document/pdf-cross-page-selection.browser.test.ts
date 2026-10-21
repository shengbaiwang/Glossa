import { afterEach, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import 'foliate-js/view.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { parseOCRPage } from '@/services/pdfEnhancement';
import recognized from '@/__tests__/fixtures/data/glossa-ocr-pages.json';

type Fragment = { index: number; range: Range };
type PDFView = FoliateView & {
  getPDFSelection(): Fragment[] | null;
  history: FoliateView['history'] & { pushState(target: number): void };
};
let view: PDFView | undefined;
let book: BookDoc | undefined;

afterEach(async () => {
  view?.close();
  view?.remove();
  await book?.destroy?.();
});

async function open(ocr: boolean) {
  await page.viewport(1000, 1100);
  const bytes = await fetch(
    `/src/__tests__/fixtures/data/glossa-${ocr ? 'ocr' : 'reading'}-sample.pdf`,
  ).then((r) => r.arrayBuffer());
  book = (
    await new DocumentLoader(new File([bytes], 'original.pdf'), {
      pdfOCR: ocr ? async (index) => parseOCRPage(recognized[index], index) : undefined,
    }).open()
  ).book;
  view = document.createElement('foliate-view') as PDFView;
  view.style.cssText = 'display:block;width:600px;height:1000px';
  document.body.append(view);
  await view.open(book);
  view.renderer.setAttribute('spread', 'none');
  view.renderer.setAttribute('zoom', 'original-size');
  view.renderer.setAttribute('scale-factor', '40');
  view.renderer.setAttribute('flow', 'scrolled');
  await view.goTo(0);
  await expect
    .poll(
      () =>
        view!.renderer
          .getContents()
          .filter((c) => (c.index ?? -1) < 2 && c.doc.querySelector('.textLayer span')).length,
    )
    .toBe(2);
  await expect
    .poll(() =>
      view!.renderer
        .getContents()
        .filter((c) => (c.index ?? -1) < 2)
        .every(
          (c) =>
            !!c.overlayer &&
            getComputedStyle(c.doc.defaultView!.frameElement!).pointerEvents === 'auto',
        ),
    )
    .toBe(true);
  return [0, 1].map((index) => view!.renderer.getContents().find((c) => c.index === index)!.doc);
}

function words(doc: Document) {
  const root = doc.querySelector('[data-pdf-ocr-text]') ?? doc.querySelector('.textLayer')!;
  return [...root.querySelectorAll<HTMLElement>('span')].filter(
    (s) => s.firstChild?.nodeType === 3 && s.textContent?.trim(),
  );
}
function overlay(index: number) {
  return (
    view!.renderer.getContents().find((c) => c.index === index)!.overlayer as {
      element: SVGElement;
    }
  ).element;
}
function point(span: HTMLElement, end: boolean) {
  const range = span.ownerDocument.createRange();
  range.selectNodeContents(span);
  const box = range.getBoundingClientRect();
  const frame = span.ownerDocument.defaultView!.frameElement!.getBoundingClientRect();
  return {
    x: frame.left + (end ? box.right - 0.1 : box.left + 0.1),
    y: frame.top + box.top + box.height / 2,
  };
}

it.each([
  false,
  true,
])('retains the original page while a paginated mouse drag turns at the page edge (reverse %s)', async (reverse) => {
  await open(true);
  view!.renderer.setAttribute('flow', 'paginated');
  await expect
    .poll(() => view!.renderer.getContents().some((c) => c.doc.querySelector('.textLayer span')))
    .toBe(true);
  await view!.goTo(reverse ? 1 : 0);
  const content = view!.renderer.getContents().find((c) => c.index === (reverse ? 1 : 0))!;
  const origin = point(reverse ? words(content.doc)[0]! : words(content.doc).at(-1)!, reverse);
  const box = view!.renderer.getBoundingClientRect();
  await commands.dragPDFText(
    origin,
    reverse ? { x: box.left + 4, y: box.top + 4 } : { x: box.right - 4, y: box.bottom - 4 },
    1000,
  );
  expect(view!.getPDFSelection()?.map((f) => f.index)).toEqual([0, 1]);
  expect(view!.getPDFSelection()![0]!.range.startContainer.isConnected).toBe(true);
  expect(view!.getPDFSelection()![1]!.range.toString().trim()).not.toBe('');
});

it.each([
  false,
  true,
])('continues keyboard selection through a paginated text-layer rebuild (reverse %s)', async (reverse) => {
  await open(true);
  view!.renderer.setAttribute('flow', 'paginated');
  await expect
    .poll(() => view!.renderer.getContents().some((c) => c.doc.querySelector('.textLayer span')))
    .toBe(true);
  const index = reverse ? 1 : 0;
  await view!.goTo(index);
  const doc = view!.renderer.getContents().find((c) => c.index === index)!.doc;
  const word = reverse ? words(doc)[0]! : words(doc).at(-1)!;
  await commands.dragPDFText(point(word, reverse), point(word, !reverse));
  await commands.pressPDFSelectionKey(reverse ? 'Shift+ArrowLeft' : 'Shift+ArrowRight');
  await expect.poll(() => view!.getPDFSelection()?.map((f) => f.index)).toEqual([0, 1]);
  expect(view!.getPDFSelection()![index]!.range.toString().trim()).toBe(word.textContent!.trim());
  expect(view!.getPDFSelection()!.every((f) => f.range.startContainer.isConnected)).toBe(true);
});

it('edits a hidden cross-page endpoint in paginated mode without navigating the fixed anchor', async () => {
  const [a, b] = await open(true);
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  const cfis = view!.getPDFSelection()!.map((f) => view!.getCFI(f.index, f.range));
  view!.renderer.setAttribute('flow', 'paginated');
  await expect
    .poll(() => view!.renderer.getContents().some((c) => c.doc.querySelector('.textLayer span')))
    .toBe(true);
  await view!.goTo(1);
  expect(await view!.startPDFSelectionHandle!(cfis, 'end')).toBe(true);
  expect(view!.renderer.index).toBe(1);
  expect(view!.getPDFSelection()?.map((f) => f.index)).toEqual([0, 1]);
  view!.stopPDFSelectionHandle!();
});

it('drags across both visible pages in a double-page spread', async () => {
  await open(true);
  view!.renderer.setAttribute('flow', 'paginated');
  await expect
    .poll(() => view!.renderer.getContents().some((c) => c.doc.querySelector('.textLayer span')))
    .toBe(true);
  view!.renderer.setAttribute('spread', 'both');
  await expect
    .poll(() => view!.renderer.getContents().some((c) => c.doc.querySelector('.textLayer span')))
    .toBe(true);
  await view!.goTo(1);
  const a = view!.renderer.getContents().find((c) => c.index === 1)!.doc;
  const b = view!.renderer.getContents().find((c) => c.index === 2)!.doc;
  await commands.dragPDFText(point(words(a).at(-1)!, false), point(words(b)[0]!, true));
  expect(view!.getPDFSelection()?.map((f) => f.index)).toEqual([1, 2]);
  expect(view!.getPDFSelection()![0]!.range.toString().trim()).toBe(
    words(a).at(-1)!.textContent!.trim(),
  );
  expect(view!.getPDFSelection()![1]!.range.toString().trim()).toBe(
    words(b)[0]!.textContent!.trim(),
  );
});

it.each([
  { ocr: true, reverse: false },
  { ocr: false, reverse: false },
  { ocr: true, reverse: true },
  { ocr: false, reverse: true },
])('keeps the original anchor when Shift-clicking after keyboard adjustment ($ocr / $reverse)', async ({
  ocr,
  reverse,
}) => {
  const [a, b] = await open(ocr);
  const start = words(a!).at(-1)!;
  const end = words(b!)[0]!;
  // The native fixture's penultimate span is an active PDF link.
  const earlier = words(a!).at(ocr ? -2 : -3)!;
  await commands.dragPDFText(
    reverse ? point(end, true) : point(start, false),
    reverse ? point(start, false) : point(end, true),
  );
  await commands.pressPDFSelectionKey(reverse ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
  await commands.clickPDFText(reverse ? point(earlier, false) : point(words(b!)[1]!, true), true);
  const fragments = view!.getPDFSelection();
  expect(fragments?.map((f) => f.index)).toEqual([0, 1]);
  const expected = (reverse ? a! : b!).createRange();
  const first = reverse ? earlier : words(b!)[0]!;
  const last = reverse ? start : words(b!)[1]!;
  expected.setStart(first.firstChild!, 0);
  expected.setEnd(last.firstChild!, last.textContent!.length);
  expect(fragments?.[reverse ? 0 : 1]?.range.toString()).toBe(expected.toString());
  expect(fragments?.[reverse ? 1 : 0]?.range.toString().trim()).toBe(
    (reverse ? end : start).textContent!.trim(),
  );
});

it.each([
  true,
  false,
])('Shift-clicks into the next page after an ordinary single-page selection (OCR: %s)', async (ocr) => {
  const [a, b] = await open(ocr);
  const start = words(a!).at(-1)!;
  const end = words(b!)[0]!;
  await commands.dragPDFText(point(start, false), point(start, true));
  expect(a!.getSelection()?.toString().trim()).toBe(start.textContent!.trim());
  await commands.clickPDFText(point(end, true), true);
  expect(view!.getPDFSelection()?.map((f) => f.range.toString().trim())).toEqual([
    start.textContent!.trim(),
    end.textContent!.trim(),
  ]);
});

for (const ocr of [true, false]) {
  it(`drags ${ocr ? 'scanned' : 'native'} text across pages, copies the same text and restores both highlight fragments`, async () => {
    const [a, b] = await open(ocr);
    const start = words(a!).at(-1)!;
    const end = words(b!)[0]!;
    await commands.dragPDFText(point(start, false), point(end, true));
    const fragments = view!.getPDFSelection();
    expect(fragments?.map((f) => f.index)).toEqual([0, 1]);
    expect(fragments![0]!.range.toString().trim()).toBe(start.textContent!.trim());
    expect(fragments![1]!.range.toString().trim()).toBe(end.textContent!.trim());
    const text = fragments!.map((f) => f.range.toString()).join('\n');
    const clipboard = new DataTransfer();
    const copy = new ClipboardEvent('copy', {
      clipboardData: clipboard,
      bubbles: true,
      cancelable: true,
    });
    a!.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect(clipboard.getData('text/plain')).toBe(text);
    const cfis = fragments!.map((f) => view!.getCFI(f.index, f.range));
    expect(a!.querySelector('[data-pdf-selection-preview]')).not.toBeNull();
    expect(b!.querySelector('[data-pdf-selection-preview]')).not.toBeNull();
    view!.deselect();
    expect(view!.getPDFSelection()).toBeNull();
    expect(a!.querySelector('[data-pdf-selection-preview]')).toBeNull();
    view!.addEventListener('draw-annotation', (event) => {
      const { draw } = (event as CustomEvent).detail;
      draw(Overlayer.highlight, { color: 'yellow' });
    });
    // JSON round trip is the same additive field used by local config/file sync.
    const annotation = JSON.parse(JSON.stringify({ value: cfis[0], pdfRanges: cfis }));
    await view!.addAnnotation(annotation);
    const expected = [start.textContent!.trim(), end.textContent!.trim()];
    for (const [i, doc] of [a!, b!].entries()) {
      expect(view!.resolveCFI(cfis[i]!).anchor(doc).toString().trim()).toBe(expected[i]);
      expect(overlay(i).querySelector('g[fill="yellow"] path')).not.toBeNull();
    }
    await view!.addAnnotation(annotation, true);
    expect(overlay(1).querySelector('g[fill="yellow"]')).toBeNull();
    // Recreate the book and both iframe documents, as a saved local annotation
    // must resolve independently of the original live DOM Ranges.
    view!.close();
    view!.remove();
    await book!.destroy?.();
    const restored = await open(ocr);
    view!.addEventListener('draw-annotation', (event) => {
      (event as CustomEvent).detail.draw(Overlayer.highlight, { color: 'green' });
    });
    await view!.addAnnotation(annotation);
    for (const [i, doc] of restored.entries()) {
      expect(view!.resolveCFI(cfis[i]!).anchor(doc).toString().trim()).toBe(expected[i]);
      expect(overlay(i).querySelector('g[fill="green"] path')).not.toBeNull();
    }
  });
}

it('supports reverse dragging and clears all page previews on Escape', async () => {
  const [a, b] = await open(true);
  await commands.dragPDFText(point(words(b!)[0]!, true), point(words(a!).at(-1)!, false));
  expect(view!.getPDFSelection()?.map((f) => f.index)).toEqual([0, 1]);
  a!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(view!.getPDFSelection()).toBeNull();
  expect(b!.querySelector('[data-pdf-selection-preview]')).toBeNull();
});

it('clears native selection on pages that leave the range when dragging back', async () => {
  const [a, b] = await open(true);
  await commands.dragPDFText(
    point(words(a!).at(-1)!, false),
    point(words(a!).at(-2)!, false),
    0,
    point(words(b!)[0]!, true),
  );
  expect(view!.getPDFSelection()?.map((f) => f.index)).toEqual([0]);
  expect(a!.getSelection()?.isCollapsed).toBe(false);
  expect(b!.getSelection()?.isCollapsed).toBe(true);
  expect(b!.querySelector('[data-pdf-selection-preview]')).toBeNull();
});

it('keeps the complete selection while panning within the document', async () => {
  const [a, b] = await open(true);
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  const fragments = view!.getPDFSelection();
  await view!.pan(0, 100);
  expect(view!.getPDFSelection()).toBe(fragments);
  expect(a!.querySelector('[data-pdf-selection-preview]')).not.toBeNull();
  expect(b!.querySelector('[data-pdf-selection-preview]')).not.toBeNull();
});

it.each([
  { ocr: false, reverse: false },
  { ocr: false, reverse: true },
  { ocr: true, reverse: false },
  { ocr: true, reverse: true },
])('updates the complete keyboard selection after dragging (OCR=$ocr, reverse=$reverse)', async ({
  ocr,
  reverse,
}) => {
  const [a, b] = await open(ocr);
  const start = words(a!).at(-1)!;
  const end = words(b!)[0]!;
  await commands.dragPDFText(
    point(reverse ? end : start, reverse),
    point(reverse ? start : end, !reverse),
  );
  const before = view!.getPDFSelection()!.map((f) => f.range.toString());
  await commands.pressPDFSelectionKey(reverse ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
  const after = view!.getPDFSelection()!.map((f) => f.range.toString());
  const expected = reverse
    ? [before[0]!.slice(1), before[1]]
    : [before[0], before[1]!.slice(0, -1)];
  expect(after).toEqual(expected.filter((text) => text?.trim()));
  await commands.pressPDFSelectionKey(reverse ? 'Shift+ArrowLeft' : 'Shift+ArrowRight');
  expect(view!.getPDFSelection()!.map((f) => f.range.toString())).toEqual(before);
});

it('extends a mouse selection into the next page with the keyboard, including when the reader holds focus', async () => {
  const [a, b] = await open(true);
  const start = words(a!).at(-1)!;
  await commands.dragPDFText(point(start, false), point(start, true));
  document.body.tabIndex = -1;
  document.body.focus();
  for (let i = 0; i < 3 && view!.getPDFSelection()?.length !== 2; i++) {
    await commands.pressPDFSelectionKey('Shift+ArrowRight');
  }
  expect(view!.getPDFSelection()?.map((f) => f.index)).toEqual([0, 1]);
  expect(view!.getPDFSelection()![0]!.range.toString().trim()).toBe(start.textContent!.trim());
  expect(
    words(b!)[0]!.textContent!.startsWith(view!.getPDFSelection()![1]!.range.toString().trim()),
  ).toBe(true);
});

it('collapses a complete cross-page selection with an unmodified arrow', async () => {
  const [a, b] = await open(true);
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  await commands.pressPDFSelectionKey('ArrowLeft');
  expect(view!.getPDFSelection()).toBeNull();
  expect(a!.querySelector('[data-pdf-selection-preview]')).toBeNull();
  expect(b!.querySelector('[data-pdf-selection-preview]')).toBeNull();
  expect(a!.getSelection()?.isCollapsed).toBe(true);
  expect(b!.getSelection()?.isCollapsed).toBe(true);
});

it('uses word and line extension without losing the other page or copying stale text', async () => {
  const [a, b] = await open(true);
  const start = words(a!).at(-1)!;
  await commands.dragPDFText(point(start, false), point(words(b!)[0]!, true));
  await commands.pressPDFSelectionKey('Control+Shift+ArrowLeft');
  expect(view!.getPDFSelection()?.map((f) => f.index)).toEqual([0]);
  await commands.pressPDFSelectionKey('Shift+ArrowDown');
  const fragments = view!.getPDFSelection()!;
  expect(fragments.map((f) => f.index)).toEqual([0, 1]);
  expect(fragments[1]!.range.toString()).toContain(words(b!)[0]!.textContent!.trim());
  const clipboard = new DataTransfer();
  a!.dispatchEvent(
    new ClipboardEvent('copy', { clipboardData: clipboard, bubbles: true, cancelable: true }),
  );
  expect(clipboard.getData('text/plain')).toBe(fragments.map((f) => f.range.toString()).join('\n'));
  for (const fragment of fragments) {
    expect(
      view!
        .resolveCFI(view!.getCFI(fragment.index, fragment.range))
        .anchor(fragment.range.startContainer.ownerDocument!)
        .toString(),
    ).toBe(fragment.range.toString());
  }
});

it('leaves note editor keyboard selection to the editor', async () => {
  const [a, b] = await open(true);
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  const fragments = view!.getPDFSelection();
  const editor = document.createElement('textarea');
  editor.value = 'Personal note';
  document.body.append(editor);
  try {
    editor.focus();
    editor.setSelectionRange(0, 4);
    await commands.pressPDFSelectionKey('Shift+ArrowRight');
    expect(editor.selectionEnd).toBe(5);
    expect(view!.getPDFSelection()).toBe(fragments);
  } finally {
    editor.remove();
  }
});

it('can select text again by mouse after the keyboard shrinks a selection to its anchor', async () => {
  const [a, b] = await open(true);
  const single = words(a!).at(-1)!;
  expect(single.textContent).toBe('2');
  await commands.dragPDFText(point(single, false), point(single, true));
  await commands.pressPDFSelectionKey('Shift+ArrowLeft');
  expect(view!.getPDFSelection()).toBeNull();
  await commands.dragPDFText(point(words(b!)[0]!, false), point(words(b!)[0]!, true));
  expect(b!.getSelection()?.toString().trim()).toBe(words(b!)[0]!.textContent!.trim());
});

it('does not replace clipboard text selected in a note editor', async () => {
  const [a, b] = await open(true);
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  const editor = document.createElement('textarea');
  editor.value = 'My personal note';
  document.body.append(editor);
  try {
    editor.focus();
    editor.select();
    const copy = new ClipboardEvent('copy', {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    });
    editor.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(false);
  } finally {
    editor.remove();
  }
});

it('clears stale cross-page previews before zoom rebuilds the text layer', async () => {
  const [a, b] = await open(true);
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  view!.renderer.setAttribute('scale-factor', '70');
  await expect.poll(() => view!.getPDFSelection()).toBeNull();
  expect(a!.querySelector('[data-pdf-selection-preview]')).toBeNull();
  expect(b!.querySelector('[data-pdf-selection-preview]')).toBeNull();
});

it.each([
  'next',
  'prev',
  'fraction',
  'search',
  'jump',
  'back',
] as const)('clears the complete selection when navigating with %s', async (navigation) => {
  const [a, b] = await open(true);
  if (navigation === 'back') {
    view!.history.pushState(1);
    view!.history.pushState(0);
  }
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  const fragments = view!.getPDFSelection();
  expect(fragments?.length).toBe(2);
  const focus = fragments![1]!;
  const cfi = view!.getCFI(focus.index, focus.range);
  if (navigation === 'next') await view!.next();
  else if (navigation === 'prev') await view!.prev();
  else if (navigation === 'fraction') await view!.goToFraction(0.7);
  else if (navigation === 'search') await view!.select(cfi);
  else if (navigation === 'jump') await view!.goTo(2);
  else view!.history.back();
  await expect.poll(() => view!.getPDFSelection()).toBeNull();
  expect(a!.querySelector('[data-pdf-selection-preview]')).toBeNull();
  expect(b!.querySelector('[data-pdf-selection-preview]')).toBeNull();
});

it('keeps extending a held selection while the reader scrolls at the lower edge', async () => {
  await open(true);
  view!.style.height = '500px';
  view!.renderer.setAttribute('scale-factor', '70');
  await view!.goTo(0);
  await expect.poll(() => view!.renderer.scale).toBeCloseTo(0.7);
  const doc = view!.renderer.getContents().find((c) => c.index === 0)!.doc;
  await expect
    .poll(() => getComputedStyle(doc.defaultView!.frameElement!).pointerEvents)
    .toBe('auto');
  const bounds = view!.getBoundingClientRect();
  const from = point(words(doc)[0]!, false);
  const before = view!.renderer.scrollTop;
  await commands.dragPDFText(from, { x: from.x, y: bounds.bottom - 5 }, 1100);
  expect(view!.renderer.scrollTop).toBeGreaterThan(before + 100);
  const indices = view!.getPDFSelection()!.map((f) => f.index);
  expect(indices.length).toBeGreaterThanOrEqual(2);
  expect(indices).toEqual(Array.from({ length: indices.length }, (_, index) => index));
});
