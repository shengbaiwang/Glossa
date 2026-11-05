import { afterEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { appendOCR } from 'foliate-js/pdf-ocr.js';
import { getPDFSelectionCaret, setupOCRSelection } from 'foliate-js/pdf-selection.js';
import * as CFI from 'foliate-js/epubcfi.js';
import { textWalker } from 'foliate-js/text-walker.js';
import 'foliate-js/view.js';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { parseOCRPage } from '@/services/pdfEnhancement';
import recognized from '@/__tests__/fixtures/data/glossa-ocr-pages.json';

declare module 'vitest/browser' {
  interface BrowserCommands {
    pressPDFSelectionKey(key: string): Promise<void>;
    clickPDFText(
      point: { x: number; y: number },
      shift?: boolean,
      clickCount?: number,
    ): Promise<void>;
    doubleClickPDFText(point: { x: number; y: number }): Promise<void>;
    dragPDFHandle(
      from: { x: number; y: number },
      to: { x: number; y: number },
      cancel?: boolean,
      secondFinger?: boolean,
    ): Promise<void>;
    dragPDFText(
      from: { x: number; y: number },
      to: { x: number; y: number },
      pauseAtEndMs?: number,
      via?: { x: number; y: number },
    ): Promise<void>;
  }
}

// Original contents layout: OCR returns the title column, then the page column.
// No user book text or OCR cache is included in this fixture.
const scan = {
  index: 0,
  native: false,
  lines: [
    { text: '第一节 ', x: 0.1, y: 0.15, width: 0.12, height: 0.03, endLine: false },
    { text: '精确选择', x: 0.25, y: 0.15, width: 0.18, height: 0.03, endLine: true },
    { text: '第二节 ', x: 0.1, y: 0.25, width: 0.12, height: 0.03, endLine: false },
    { text: '保留笔记', x: 0.25, y: 0.25, width: 0.18, height: 0.03, endLine: true },
    { text: '12', x: 0.8, y: 0.15, width: 0.045, height: 0.025, endLine: true },
    { text: '24', x: 0.8, y: 0.25, width: 0.045, height: 0.025, endLine: true },
  ],
};
let frame: HTMLIFrameElement;
let view: FoliateView | undefined;
let book: BookDoc | undefined;
async function open(scale = 1, material = scan) {
  await page.viewport(1100, 1000);
  const css = await fetch('/vendor/pdfjs/text_layer_builder.css').then((r) => r.text());
  frame = document.createElement('iframe');
  frame.style.cssText = `position:fixed;left:0;top:0;width:${640 * scale}px;height:${600 * scale}px;border:0;display:block`;
  const ready = new Promise<void>((resolve) => {
    frame.onload = () => resolve();
  });
  frame.srcdoc = `<style>html,body{margin:0}${css}</style><div class="textLayer"></div>`;
  document.body.append(frame);
  await ready;
  const doc = frame.contentDocument!;
  appendOCR(doc.querySelector('.textLayer'), material, { width: 640 * scale, height: 600 * scale });
  return doc;
}
const currentSpans = (doc: Document) => [
  ...doc.querySelectorAll<HTMLElement>('.textLayer span:not([data-pdf-legacy])'),
];
const textRange = (span: HTMLElement) => {
  const range = span.ownerDocument.createRange();
  range.setStart(span.firstChild!, 0);
  range.setEnd(span.firstChild!, span.textContent!.length);
  return range;
};
const point = (span: HTMLElement, end = false) => {
  const box = textRange(span).getBoundingClientRect();
  const host = frame.getBoundingClientRect();
  return {
    x: host.x + (end ? box.right - 0.5 : box.left + 0.5),
    y: host.y + box.y + box.height / 2,
  };
};
afterEach(async () => {
  view?.close();
  view?.remove();
  await book?.destroy?.();
  view = undefined;
  book = undefined;
  frame?.remove();
});

it.each([
  0.75, 1, 1.5,
])('selects vertical CJK by glyph height at scale %s and restores its CFI', async (scale) => {
  const material = {
    ...scan,
    lines: [
      { text: '春夏秋冬山川', x: 0.6, y: 0.15, width: 0.045, height: 0.4, endLine: true },
      { text: '清风明月', x: 0.5, y: 0.15, width: 0.045, height: 0.27, endLine: true },
    ],
  };
  const doc = await open(scale, material);
  setupOCRSelection(doc.querySelector('.textLayer'));
  const span = currentSpans(doc)[0]!;
  const selected = doc.createRange();
  selected.setStart(span.firstChild!, 1);
  selected.setEnd(span.firstChild!, 4);
  const box = selected.getBoundingClientRect();
  expect(box.height).toBeLessThan(textRange(span).getBoundingClientRect().height * 0.6);
  const host = frame.getBoundingClientRect();
  await commands.dragPDFText(
    { x: host.x + box.left + box.width / 2, y: host.y + box.top + 0.1 },
    { x: host.x + box.left + box.width / 2, y: host.y + box.bottom - 0.1 },
  );
  expect(doc.getSelection()!.toString()).toBe('夏秋冬');
  const cfi = CFI.fromRange(doc.getSelection()!.getRangeAt(0));
  expect(CFI.toRange(doc, CFI.parse(cfi))!.toString()).toBe('夏秋冬');
});

it('projects rotated OCR while its iframe is hidden without changing CFI or mouse endpoints', async () => {
  const doc = await open();
  const layer = doc.querySelector('.textLayer')!;
  layer.replaceChildren();
  frame.style.cssText =
    'position:fixed;left:0;top:0;width:800px;height:600px;border:0;display:none';
  const rotated = parseOCRPage(recognized[2], 2)!;
  appendOCR(layer, rotated, { width: 800, height: 600 });
  frame.style.display = 'block';
  const spans = currentSpans(doc);
  for (const span of spans) {
    const word = rotated.lines.find((item) => item.text === span.textContent)!;
    const rect = textRange(span).getBoundingClientRect();
    expect(Math.abs(rect.left - word.x * 800)).toBeLessThan(1);
    expect(Math.abs(rect.top - word.y * 600)).toBeLessThan(1);
    expect(Math.abs(rect.width - word.width * 800)).toBeLessThan(1);
    expect(Math.abs(rect.height - word.height * 600)).toBeLessThan(1);
    expect(span.getBoundingClientRect().right).toBeLessThanOrEqual(802);
  }
  setupOCRSelection(layer);
  const span = spans.find((item) => item.textContent === 'Chapter ')!;
  const selected = textRange(span);
  selected.setEnd(span.firstChild!, 7);
  const box = selected.getBoundingClientRect(),
    host = frame.getBoundingClientRect();
  await commands.dragPDFText(
    { x: host.x + box.left + 0.1, y: host.y + box.top + box.height / 2 },
    { x: host.x + box.right - 0.1, y: host.y + box.top + box.height / 2 },
  );
  expect(doc.getSelection()!.toString()).toBe('Chapter');
  const cfi = CFI.fromRange(doc.getSelection()!.getRangeAt(0));
  expect(CFI.toRange(doc, CFI.parse(cfi))!.toString()).toBe('Chapter');
});

it('keeps multi-column block order and exact OCR characters through a real mouse selection', async () => {
  const material = {
    ...scan,
    lines: [
      { text: '左栏第一行', x: 0.1, y: 0.15, width: 0.25, height: 0.03, endLine: true },
      { text: '辨认0O错误 é🪶', x: 0.1, y: 0.25, width: 0.25, height: 0.03, endLine: true },
      { text: '右栏第一行', x: 0.6, y: 0.15, width: 0.25, height: 0.03, endLine: true },
      { text: '右栏第二行', x: 0.6, y: 0.25, width: 0.25, height: 0.03, endLine: true },
    ],
  };
  const doc = await open(1, material);
  setupOCRSelection(doc.querySelector('.textLayer'));
  const spans = currentSpans(doc);
  await commands.dragPDFText(point(spans[1]!), point(spans[2]!, true));
  expect(doc.getSelection()!.toString()).toBe('辨认0O错误 é🪶\n右栏第一行');
});

it('selects Hebrew glyphs in their visual direction beside mixed Latin text', async () => {
  const doc = await open(1, {
    ...scan,
    lines: [
      { text: 'אבגדה', x: 0.15, y: 0.15, width: 0.25, height: 0.04, endLine: true },
      { text: 'Latin 中文 é 🪶', x: 0.15, y: 0.3, width: 0.5, height: 0.04, endLine: true },
    ],
  });
  setupOCRSelection(doc.querySelector('.textLayer'));
  const node = currentSpans(doc)[0]!.firstChild!;
  const range = doc.createRange();
  range.setStart(node, 1);
  range.setEnd(node, 4);
  const box = range.getBoundingClientRect(),
    host = frame.getBoundingClientRect();
  await commands.dragPDFText(
    { x: host.x + box.right - 0.1, y: host.y + box.top + box.height / 2 },
    { x: host.x + box.left + 0.1, y: host.y + box.top + box.height / 2 },
  );
  expect(doc.getSelection()!.toString()).toBe('בגד');
});

it('keeps a native PDF drag on its character endpoints when the pointer crosses line whitespace', async () => {
  const doc = await open(1, {
    ...scan,
    lines: [
      {
        text: 'First paragraph precise endpoints',
        x: 0.1,
        y: 0.15,
        width: 0.65,
        height: 0.04,
        endLine: true,
      },
      {
        text: 'Second paragraph stays separate',
        x: 0.1,
        y: 0.32,
        width: 0.65,
        height: 0.04,
        endLine: true,
      },
    ],
  });
  // Native PDF.js spans use the same absolutely positioned and transformed
  // glyph boxes, without the OCR projection wrapper or legacy CFI nodes.
  doc.querySelectorAll('[data-pdf-legacy]').forEach((element) => element.remove());
  doc.querySelector('[data-pdf-ocr-text]')!.removeAttribute('data-pdf-ocr-text');
  setupOCRSelection(doc.querySelector('.textLayer'));
  const first = currentSpans(doc)[0]!;
  const node = first.firstChild!;
  const box = textRange(first).getBoundingClientRect();
  const end = getPDFSelectionCaret(doc, box.right + 12, box.top + box.height / 2);
  expect(end?.node).toBe(node);
  expect(end?.offset).toBe(node.textContent!.length);
  const start = doc.createRange();
  start.setStart(node, 6);
  start.setEnd(node, 15);
  const partial = start.getBoundingClientRect(),
    host = frame.getBoundingClientRect();
  await commands.dragPDFText(
    { x: host.x + partial.left + 0.1, y: host.y + partial.top + partial.height / 2 },
    { x: host.x + partial.right - 0.1, y: host.y + partial.top + partial.height / 2 },
    0,
    { x: host.x + box.right + 12, y: host.y + box.top + box.height / 2 },
  );
  expect(doc.getSelection()!.toString()).toBe('paragraph');
});

it('fits native selection rectangles to OCR boxes at several zoom levels, including spaces', async () => {
  for (const scale of [0.75, 1, 1.5]) {
    const doc = await open(scale);
    for (const span of currentSpans(doc)) {
      const word = scan.lines.find((w) => w.text === span.textContent)!;
      const box = textRange(span).getBoundingClientRect();
      expect(Math.abs(box.left - word.x * 640 * scale)).toBeLessThan(1);
      expect(Math.abs(box.top - word.y * 600 * scale)).toBeLessThan(1);
      expect(Math.abs(box.width - word.width * 640 * scale)).toBeLessThan(1);
      expect(Math.abs(box.height - word.height * 600 * scale)).toBeLessThan(1);
    }
    frame.remove();
  }
});

for (const ocr of [false, true]) {
  it(`selects exact characters by mouse in a real ${ocr ? 'scanned' : 'native'} PDF after zoom`, async () => {
    await page.viewport(1200, 1200);
    const bytes = await fetch(
      `/src/__tests__/fixtures/data/glossa-${ocr ? 'ocr' : 'reading'}-sample.pdf`,
    ).then((r) => r.arrayBuffer());
    book = (
      await new DocumentLoader(new File([bytes], 'original.pdf'), {
        pdfOCR: ocr ? async (index) => parseOCRPage(recognized[index], index) : undefined,
      }).open()
    ).book;
    view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:600px;height:800px';
    document.body.append(view);
    await view.open(book);
    view.renderer.setAttribute('spread', 'none');
    view.renderer.setAttribute('zoom', 'fit-width');
    await view.goTo(1);
    let saved = '';
    for (const factor of [100, 135]) {
      const previous = view.renderer
        .getContents()
        .find((c) => c.index === 1)
        ?.doc.querySelector('canvas')
        ?.getBoundingClientRect().width;
      view.renderer.setAttribute('scale-factor', String(factor));
      if (factor !== 100)
        await expect
          .poll(
            () =>
              view!.renderer
                .getContents()
                .find((c) => c.index === 1)
                ?.doc.querySelector('canvas')
                ?.getBoundingClientRect().width,
          )
          .not.toBe(previous);
      await expect
        .poll(
          () =>
            view!.renderer
              .getContents()
              .find((c) => c.index === 1)
              ?.doc.querySelector('.textLayer')?.textContent,
        )
        .toContain('Copper');
      let doc = view.renderer.getContents().find((c) => c.index === 1)!.doc;
      const span = currentSpans(doc).find((s) => s.textContent?.startsWith('Copper'))!;
      let range = doc.createRange();
      range.setStart(span.firstChild!, 0);
      range.setEnd(span.firstChild!, 6);
      const target = view.getCFI(1, range);
      await view.goTo(target);
      doc = view.renderer.getContents().find((c) => c.index === 1)!.doc;
      range = view.resolveCFI(target).anchor(doc);
      frame = doc.defaultView!.frameElement as HTMLIFrameElement;
      const rect = range.getBoundingClientRect();
      const host = frame.getBoundingClientRect();
      await commands.dragPDFText(
        { x: host.x + rect.left + 0.5, y: host.y + rect.top + rect.height / 2 },
        { x: host.x + rect.right - 0.5, y: host.y + rect.top + rect.height / 2 },
      );
      expect(doc.getSelection()!.toString()).toBe('Copper');
      if (!saved) saved = view.getCFI(1, doc.getSelection()!.getRangeAt(0));
      expect(view.resolveCFI(saved).anchor(doc).toString()).toBe('Copper');
      if (ocr && factor === 135)
        await page.screenshot({
          element: view,
          path: '/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-precise-selection.png',
        });
      doc.getSelection()!.removeAllRanges();
    }
  });
}

it('retains explicit native PDF double-click words and triple-click paragraphs', async () => {
  await page.viewport(1200, 1200);
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-reading-sample.pdf').then(
    (response) => response.arrayBuffer(),
  );
  book = (await new DocumentLoader(new File([bytes], 'original.pdf')).open()).book;
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:600px;height:800px';
  document.body.append(view);
  await view.open(book);
  view.renderer.setAttribute('spread', 'none');
  view.renderer.setAttribute('zoom', 'fit-width');
  await view.goTo(1);
  await expect
    .poll(
      () =>
        view!.renderer
          .getContents()
          .find((item) => item.index === 1)
          ?.doc.querySelector('.textLayer')?.textContent,
    )
    .toContain('Copper');
  let doc = view.renderer.getContents().find((item) => item.index === 1)!.doc;
  const span = currentSpans(doc).find((element) => element.textContent?.startsWith('Copper'))!;
  const range = doc.createRange();
  range.setStart(span.firstChild!, 1);
  range.setEnd(span.firstChild!, 4);
  const target = view.getCFI(1, range);
  await view.goTo(target);
  doc = view.renderer.getContents().find((item) => item.index === 1)!.doc;
  frame = doc.defaultView!.frameElement as HTMLIFrameElement;
  const box = view.resolveCFI(target).anchor(doc).getBoundingClientRect();
  const host = frame.getBoundingClientRect();
  const position = { x: host.x + box.left + box.width / 2, y: host.y + box.top + box.height / 2 };
  await commands.doubleClickPDFText(position);
  expect(doc.getSelection()!.toString()).toBe('Copper');
  await commands.clickPDFText(position, false, 3);
  expect(doc.getSelection()!.toString().trim()).toBe('Copper marker 2 is the searchable line.');
});

it('drags through the visual row without collecting other titles, and keeps legacy and new CFIs distinct', async () => {
  const doc = await open();
  const spans = currentSpans(doc);
  const first = spans.find((s) => s.textContent === '第一节 ')!;
  const number = spans.find((s) => s.textContent === '12')!;
  await commands.dragPDFText(point(first), point(number, true));
  expect(doc.getSelection()!.toString().replace(/\s+/g, '')).toBe('第一节精确选择12');
  const range = doc.getSelection()!.getRangeAt(0);
  const saved = CFI.fromRange(range);
  expect(CFI.toRange(doc, CFI.parse(saved))!.toString()).toBe(range.toString());
  const legacy = doc.querySelector<HTMLElement>('[data-pdf-legacy]');
  expect(legacy).toBeTruthy();
  const legacyCFI = CFI.fromRange(textRange(legacy!));
  expect(legacyCFI).toBe('epubcfi(/4/2/2,/1:0,/1:4)');
  expect(legacyCFI).not.toBe(CFI.fromRange(textRange(first)));
  expect(CFI.toRange(doc, CFI.parse(legacyCFI))!.toString()).toBe('第一节 ');
  const searched = [...textWalker(doc, (strings: string[]) => [strings.join('')])].join('');
  expect(searched).toBe('第一节 精确选择12第二节 保留笔记24');
  doc.getSelection()!.removeAllRanges();
  await commands.dragPDFText(point(number, true), point(first));
  expect(doc.getSelection()!.toString().replace(/\s+/g, '')).toBe('第一节精确选择12');
});

it('reinstalls OCR endpoint handling without duplicate listeners and leaves a keyboard-editable selection', async () => {
  const doc = await open();
  const layer = doc.querySelector('.textLayer')!;
  setupOCRSelection(layer);
  setupOCRSelection(layer);
  const span = currentSpans(doc).find((s) => s.textContent === '精确选择')!;
  const range = textRange(span);
  range.setStart(span.firstChild!, 1);
  range.setEnd(span.firstChild!, 3);
  const box = range.getBoundingClientRect();
  const host = frame.getBoundingClientRect();
  await commands.dragPDFText(
    { x: host.left + box.left + 0.5, y: host.top + box.top + box.height / 2 },
    { x: host.left + box.right - 0.5, y: host.top + box.top + box.height / 2 },
  );
  expect(doc.getSelection()!.toString()).toBe('确选');
  expect(document.activeElement).toBe(frame);
  // The public browser Selection remains usable by keyboard extension, copy,
  // annotations and the existing selection toolbar.
  await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
  expect(doc.getSelection()!.toString()).toBe('确');
  doc.getSelection()!.removeAllRanges();
  await commands.doubleClickPDFText(point(span));
  expect(doc.getSelection()!.toString().length).toBeGreaterThan(0);
  const disabled = doc.createElement('style');
  disabled.textContent =
    '* { user-select: none !important; -webkit-user-select: none !important; }';
  doc.head.append(disabled);
  doc.getSelection()!.removeAllRanges();
  await commands.dragPDFText(point(span), point(span, true));
  expect(doc.getSelection()!.toString()).toBe('');
});

it('cancels pending endpoint work when a released page is initialized again', async () => {
  const doc = await open();
  const layer = doc.querySelector('.textLayer')!;
  setupOCRSelection(layer);
  const box = textRange(currentSpans(doc)[0]!).getBoundingClientRect();
  getPDFSelectionCaret(doc, box.left, box.top);
  // Page retirement can win the race against a late PDF render calling setup.
  frame.remove();
  expect(doc.defaultView).toBeNull();
  const failures: unknown[] = [];
  const report = (event: ErrorEvent) => {
    failures.push(event.error);
    event.preventDefault();
  };
  window.addEventListener('error', report);
  try {
    setupOCRSelection(layer);
    expect(getPDFSelectionCaret(doc, box.left, box.top)).toBeNull();
    expect(failures).toEqual([]);
  } finally {
    window.removeEventListener('error', report);
  }
});

it('keeps the visible bitmap and OCR targets together during superseded page renders', async () => {
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-ocr-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  book = (
    await new DocumentLoader(new File([bytes], 'original.pdf'), {
      pdfOCR: async (index) => parseOCRPage(recognized[index], index),
    }).open()
  ).book;
  const entry = await (
    book.sections[1] as unknown as {
      load: () => Promise<{
        data: string;
        onZoom: (options: { doc: Document; scale: number }) => Promise<void>;
      }>;
    }
  ).load();
  frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:0;top:0;width:1000px;height:1500px;border:0';
  const ready = new Promise<void>((resolve) => {
    frame.onload = () => resolve();
  });
  frame.srcdoc = entry.data;
  document.body.append(frame);
  await ready;
  const doc = frame.contentDocument!;
  await entry.onZoom({ doc, scale: 1 });
  const originalWidth = doc.querySelector('canvas')!.getBoundingClientRect().width;
  const ratio = () => {
    const span = currentSpans(doc).find((s) => s.textContent === 'Copper ')!;
    return (
      textRange(span).getBoundingClientRect().width /
      doc.querySelector('canvas')!.getBoundingClientRect().width
    );
  };
  const originalRatio = ratio();
  const seen: number[] = [];
  const observer = new MutationObserver(() => seen.push(ratio()));
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true });
  try {
    const first = entry.onZoom({ doc, scale: 1.25 });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const second = entry.onZoom({ doc, scale: 0.75 });
    const final = entry.onZoom({ doc, scale: 1.5 });
    await Promise.all([first, second, final]);
    expect(doc.querySelector('canvas')!.getBoundingClientRect().width).toBeCloseTo(
      originalWidth * 1.5,
    );
    expect(doc.querySelectorAll('.textLayer')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-pdf-ocr-text]')).toHaveLength(1);
    expect(seen.length).toBeGreaterThan(0);
    for (const value of seen) expect(value).toBeCloseTo(originalRatio, 3);
  } finally {
    observer.disconnect();
  }
});
