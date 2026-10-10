import { afterEach, describe, expect, it } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import 'foliate-js/view.js';
import type { FoliateView } from '@/types/view';
import type { BookDoc } from '@/libs/document';

const html = `<!doctype html><html><head>
<meta name="viewport" content="width=600,height=1400">
<style>html,body{margin:0;width:600px;height:1400px}p{position:absolute;margin:0;font:20px serif}</style>
</head><body><div id="canvas"></div><div class="textLayer">
<p style="top:40px">First line of the page</p>
<p style="top:800px" id="target">Copper marker for search and notes</p>
<p style="top:1100px">Last line of the page</p>
</div><div class="annotationLayer">Embedded popup text</div></body></html>`;

let view: FoliateView | null = null;
const mount = async (scrolled = false) => {
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:600px;height:400px';
  document.body.append(view);
  const book = {
    metadata: { title: 'Original PDF reading fixture', language: 'en' },
    rendition: { layout: 'pre-paginated', spread: 'none', viewport: { width: 600, height: 1400 } },
    sections: Array.from({ length: 3 }, (_, index) => ({
      id: index,
      size: 1000,
      linear: 'yes',
      load: async () => ({ src: 'srcdoc', data: html }),
    })),
    toc: [],
    splitTOCHref: () => [null, null],
    getTOCFragment: (doc: Document) => doc.body,
  } as unknown as BookDoc;
  await view.open(book);
  view.renderer.setAttribute('zoom', 'fit-width');
  if (scrolled) view.renderer.setAttribute('flow', 'scrolled');
  await view.goTo(0);
  await expect
    .poll(() =>
      view!.renderer
        .getContents()
        .some(({ doc, index }) => index === 0 && doc.querySelector('#target')),
    )
    .toBe(true);
  return view;
};

const targetCfi = (v: FoliateView, index = 0) => {
  const doc = v.renderer.getContents().find((content) => content.index === index)!.doc;
  const range = doc.createRange();
  const text = doc.querySelector('#target')!.firstChild!;
  range.setStart(text, 0);
  range.setEnd(text, text.textContent!.length);
  return v.getCFI(index, range);
};

afterEach(() => {
  view?.close();
  view?.remove();
  view = null;
});

describe('fixed-layout reading positions', () => {
  for (const scrolled of [false, true]) {
    it(`brings a search/note range into view and restores it after a jump (${scrolled ? 'scroll' : 'pages'})`, async () => {
      const v = await mount(scrolled);
      const cfi = targetCfi(v);
      await v.goTo(cfi);
      expect(v.renderer.scrollTop).toBeGreaterThan(500);
      const origin = v.lastLocation!.cfi!;
      await v.goTo(2);
      await v.goTo(origin);
      expect(v.renderer.scrollTop).toBeGreaterThan(500);
      expect(CFI.fake.toIndex(CFI.parse(CFI.collapse(v.lastLocation!.cfi))[0])).toBe(0);
    });
  }

  it('reports visible selectable text for bookmarks and keeps embedded annotation text out', async () => {
    const v = await mount();
    expect(v.lastLocation!.range?.toString()).toContain('First line');
    expect(v.lastLocation!.range?.toString()).not.toContain('Embedded popup text');
    await v.goTo(targetCfi(v));
    expect(v.lastLocation!.range?.toString()).toContain('Copper marker');
    expect(v.lastLocation!.cfi).toContain('!');
  });
});
