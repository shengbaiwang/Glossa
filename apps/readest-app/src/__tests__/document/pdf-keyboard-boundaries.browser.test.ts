import { afterEach, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import 'foliate-js/view.js';
import type { BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';

type PDFView = FoliateView & { getPDFSelection(): { index: number; range: Range }[] | null };
let view: PDFView | undefined;
afterEach(() => {
  view?.close();
  view?.remove();
});

// Original fixed-page documents exercise the same renderer/selection lifecycle
// with a controllable late page. Real scanned/native PDFs are tested separately.
async function open(contents: string[], waitForPage?: Promise<void>) {
  await page.viewport(900, 700);
  view = document.createElement('foliate-view') as PDFView;
  view.style.cssText = 'display:block;width:600px;height:400px';
  document.body.append(view);
  const book = {
    metadata: { title: 'Original keyboard boundary fixture', language: 'en' },
    rendition: { layout: 'pre-paginated', spread: 'none', viewport: { width: 600, height: 300 } },
    sections: contents.map((content, index) => ({
      id: index,
      size: 1000,
      linear: 'yes',
      load: async () => {
        if (index === 1) await waitForPage;
        return {
          src: 'srcdoc',
          data: `<!doctype html><meta name="viewport" content="width=600,height=300"><style>html,body{margin:0;width:600px;height:300px}.textLayer{position:absolute;top:100px;left:50px;font:24px serif}</style><div class="textLayer">${content}</div>`,
        };
      },
    })),
    getPDFAnnotationRects: () => [],
    toc: [],
    splitTOCHref: () => [null, null],
    getTOCFragment: (doc: Document) => doc.body,
  } as unknown as BookDoc;
  await view.open(book);
  view.renderer.setAttribute('spread', 'none');
  view.renderer.setAttribute('zoom', 'original-size');
  view.renderer.setAttribute('scale-factor', '100');
  view.renderer.setAttribute('flow', 'scrolled');
  await view.goTo(0);
  await expect
    .poll(() => view!.renderer.getContents().find((c) => c.index === 0)?.overlayer)
    .toBeTruthy();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const doc = view.renderer.getContents().find((c) => c.index === 0)!.doc;
  await expect
    .poll(() => getComputedStyle(doc.defaultView!.frameElement!).pointerEvents)
    .toBe('auto');
  const range = doc.createRange();
  range.selectNodeContents(doc.querySelector('span')!);
  const box = range.getBoundingClientRect();
  const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
  await commands.doubleClickPDFText({
    x: frame.left + box.left + box.width / 2,
    y: frame.top + box.top + box.height / 2,
  });
  expect(doc.getSelection()?.toString()).toBe('Alpha');
  return view;
}

it('keeps the current page while a keyboard extension waits, and cancels late selection after navigation', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const v = await open(
    ['<span>Alpha</span>', '<span>Bravo</span>', '<span>Charlie</span>'],
    pending,
  );
  const position = v.renderer.scrollTop;
  try {
    await commands.pressPDFSelectionKey('Shift+ArrowRight');
    expect(v.renderer.scrollTop).toBe(position);
    await commands.pressPDFSelectionKey('Escape');
    const relocated = new Promise<void>((resolve) => {
      const listener = (event: Event) => {
        if ((event as CustomEvent).detail.reason !== 'scroll') return;
        v.renderer.removeEventListener('relocate', listener);
        resolve();
      };
      v.renderer.addEventListener('relocate', listener);
    });
    await v.goTo(2);
    await relocated;
    const navigated = v.renderer.scrollTop;
    const navigatedIndex = v.renderer.index;
    release();
    await expect
      .poll(() => v.renderer.getContents().find((c) => c.index === 1)?.overlayer)
      .toBeTruthy();
    expect(v.getPDFSelection()).toBeNull();
    expect(v.renderer.scrollTop).toBe(navigated);
    expect(v.renderer.index).toBe(navigatedIndex);
  } finally {
    release();
  }
});

it('skips a verified blank page while retaining a continuous physical page span', async () => {
  const v = await open(['<span>Alpha</span>', '', '<span>Bravo</span>']);
  await commands.pressPDFSelectionKey('Shift+ArrowRight');
  await expect.poll(() => v.getPDFSelection()?.map((f) => f.index)).toEqual([0, 2]);
  expect(v.getPDFSelection()?.map((f) => f.range.toString())).toEqual(['Alpha', 'B']);
});

it.each([
  'pending',
  'failed',
])('does not skip an OCR %s page and resumes after text becomes available', async (status) => {
  const v = await open([
    '<span>Alpha</span>',
    `<i data-pdf-ocr-status="${status}">Recognizing</i>`,
    '<span>Charlie</span>',
  ]);
  await expect
    .poll(() =>
      v.renderer
        .getContents()
        .find((c) => c.index === 1)
        ?.doc.querySelector('[data-pdf-ocr-status]'),
    )
    .toBeTruthy();
  await commands.pressPDFSelectionKey('Shift+ArrowRight');
  expect(v.getPDFSelection()?.map((f) => f.index)).toEqual([0]);
  expect(v.getPDFSelection()?.[0]?.range.toString()).toBe('Alpha');
  const root = v.renderer
    .getContents()
    .find((c) => c.index === 1)!
    .doc.querySelector('.textLayer')!;
  root.innerHTML = '<span>Bravo</span>';
  await commands.pressPDFSelectionKey('Shift+ArrowRight');
  expect(v.getPDFSelection()?.map((f) => f.range.toString())).toEqual(['Alpha', 'B']);
});

it('keeps the full verified range and reports the physical 24-page limit', async () => {
  const v = await open(
    Array.from({ length: 26 }, (_, i) => `<span>${i ? 'Bravo' : 'Alpha'}</span>`),
  );
  let limited = 0;
  v.addEventListener('pdf-selection-limit', () => {
    limited++;
  });
  for (let count = 2; count <= 24; count++) {
    await commands.pressPDFSelectionKey('Control+Shift+End');
    await expect.poll(() => v.getPDFSelection()?.length).toBe(count);
  }
  await commands.pressPDFSelectionKey('Control+Shift+End');
  expect(limited).toBe(1);
  expect(v.getPDFSelection()?.map((f) => f.index)).toEqual(Array.from({ length: 24 }, (_, i) => i));
});
