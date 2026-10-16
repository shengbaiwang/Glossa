import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import 'foliate-js/view.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import * as CFI from 'foliate-js/epubcfi.js';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import type { BookNote } from '@/types/book';
import { parseOCRPage } from '@/services/pdfEnhancement';
import recognized from '@/__tests__/fixtures/data/glossa-ocr-pages.json';
import { DEFAULT_BOOK_SEARCH_CONFIG } from '@/services/constants';

let book: BookDoc | null = null;
let view: FoliateView | null = null;
async function open(withOCR = true) {
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-ocr-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  book = (
    await new DocumentLoader(new File([bytes], 'original-scan.pdf', { type: 'application/pdf' }), {
      pdfOCR: withOCR ? async (index) => parseOCRPage(recognized[index], index) : undefined,
    }).open()
  ).book;
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:600px;height:800px';
  document.body.append(view);
  view.addEventListener('draw-annotation', ((event: CustomEvent) => {
    event.detail.draw(Overlayer.highlight, { color: '#d6c9a8' });
  }) as EventListener);
  await view.open(book);
  view.renderer.setAttribute('spread', 'none');
  view.renderer.setAttribute('zoom', 'fit-width');
  await view.goTo(1);
  return view;
}
afterEach(async () => {
  view?.close();
  view?.remove();
  await book?.destroy?.();
  view = null;
  book = null;
});

describe('real scanned PDF plus local Vision word boxes', () => {
  it('keeps images intact and makes recognized words searchable and selectable at their image positions', async () => {
    const v = await open();
    const doc = v.renderer.getContents().find((item) => item.index === 1)!.doc;
    const word = Array.from(doc.querySelectorAll<HTMLElement>('.textLayer span')).find(
      (s) => s.textContent === 'Copper ',
    )!;
    expect(word).toBeTruthy();
    const box = recognized[1]!.lines.find((w) => w.text === 'Copper ')!;
    const viewport = doc.querySelector('#canvas canvas')!.getBoundingClientRect();
    const range = doc.createRange();
    range.setStart(word.firstChild!, 0);
    range.setEnd(word.firstChild!, word.textContent!.length);
    const rect = range.getBoundingClientRect();
    expect(Math.abs(rect.left - viewport.width * box.x)).toBeLessThan(2);
    expect(Math.abs(rect.top - viewport.height * box.y)).toBeLessThan(6);
    doc.getSelection()!.addRange(range);
    expect(doc.getSelection()!.toString()).toBe('Copper ');
    const searchDoc = await book!.sections[1]!.createDocument();
    expect(searchDoc.querySelector('.textLayer')!.textContent).toContain('Copper marker');
    const matches = [];
    for await (const match of v.search({ ...DEFAULT_BOOK_SEARCH_CONFIG, query: 'Copper marker' })) {
      if (typeof match !== 'string' && 'subitems' in match) matches.push(...match.subitems);
    }
    expect(matches).toHaveLength(1);
    await page.screenshot({
      element: v,
      path: '/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-ocr-selection.png',
    });
  });

  it('restores recognized text ranges and highlights after zoom and reopening, retaining old native offsets', async () => {
    let v = await open();
    let doc = v.renderer.getContents().find((item) => item.index === 1)!.doc;
    const word = Array.from(doc.querySelectorAll('.textLayer span')).find(
      (s) => s.textContent === 'Copper ',
    )!;
    const range = doc.createRange();
    range.setStart(word.firstChild!, 0);
    range.setEnd(word.firstChild!, word.textContent!.length);
    const cfi = v.getCFI(1, range);
    const note: BookNote & { value: string } = {
      id: 'ocr-note',
      type: 'annotation',
      cfi,
      value: cfi,
      text: 'Copper ',
      note: 'Original note',
      createdAt: 1,
      updatedAt: 1,
      color: 'yellow',
      style: 'highlight',
    };
    v.addEventListener('create-overlay', (() => {
      void v.addAnnotation(note);
    }) as EventListener);
    await v.addAnnotation(note);
    expect(
      (
        v.renderer.getContents().find((item) => item.index === 1)!.overlayer as Overlayer
      ).element.querySelectorAll('g[fill="#d6c9a8"] > path, g[fill="#d6c9a8"] > rect').length,
    ).toBeGreaterThan(0);
    v.renderer.setAttribute('scale-factor', '125');
    await expect
      .poll(() => {
        const current = v.renderer.getContents().find((item) => item.index === 1);
        return current ? v.resolveCFI(cfi).anchor(current.doc).toString() : '';
      })
      .toBe('Copper ');
    await expect
      .poll(
        () => {
          const current = v.renderer.getContents().find((item) => item.index === 1);
          return (
            (current?.overlayer as Overlayer | undefined)?.element.querySelectorAll(
              'g[fill="#d6c9a8"] > path, g[fill="#d6c9a8"] > rect',
            ).length ?? 0
          );
        },
        { timeout: 5000 },
      )
      .toBeGreaterThan(0);
    await v.goTo(3);
    doc = v.renderer.getContents().find((item) => item.index === 3)!.doc;
    const nativeNode = doc.querySelector('.textLayer span')!.firstChild!;
    const nativeRange = doc.createRange();
    nativeRange.setStart(nativeNode, 0);
    nativeRange.setEnd(nativeNode, nativeNode.textContent!.length);
    const nativeCFI = v.getCFI(3, nativeRange);
    const nativeText = nativeRange.toString();
    v.close();
    v.remove();
    await book!.destroy?.();
    view = null;
    book = null;
    v = await open();
    await v.goTo(cfi);
    doc = v.renderer.getContents().find((item) => item.index === 1)!.doc;
    expect(v.resolveCFI(cfi).anchor(doc).toString()).toBe('Copper ');
    await v.goTo(CFI.fake.fromIndex(0));
    expect(CFI.fake.toIndex(CFI.parse(CFI.collapse(v.lastLocation!.cfi!))[0])).toBe(0);
    v.close();
    v.remove();
    await book!.destroy?.();
    view = null;
    book = null;
    v = await open(false);
    await v.goTo(nativeCFI);
    doc = v.renderer.getContents().find((item) => item.index === 3)!.doc;
    expect(v.resolveCFI(nativeCFI).anchor(doc).toString()).toBe(nativeText);
  });

  it('uses the same upright page coordinates for a rotated scan', async () => {
    const v = await open();
    await v.goTo(2);
    const doc = v.renderer.getContents().find((item) => item.index === 2)!.doc;
    expect(await book!.getPDFText!(2)).toContain('Source verification');
    const canvas = doc.querySelector('#canvas canvas')!.getBoundingClientRect();
    expect(canvas.width).toBeGreaterThan(canvas.height);
    for (const word of doc.querySelectorAll<HTMLElement>('.textLayer span')) {
      const rect = word.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(-1);
      expect(rect.right).toBeLessThanOrEqual(canvas.width + 2);
      expect(rect.bottom).toBeLessThanOrEqual(canvas.height + 5);
    }
  });
});
