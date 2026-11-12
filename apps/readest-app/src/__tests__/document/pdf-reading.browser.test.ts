import { afterEach, describe, expect, it } from 'vitest';
import * as CFI from 'foliate-js/epubcfi.js';
import 'foliate-js/view.js';
import type { FoliateView } from '@/types/view';
import { DocumentLoader, type BookDoc } from '@/libs/document';

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

it('resolves named destinations on a cropped, rotated PDF without inventing text anchors', async () => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R /Names << /Dests << /Names [(One) [3 0 R /XYZ 100 200 null] (Two) [3 0 R /XYZ 350 600 null]] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 1400] /CropBox [20 40 580 1380] /Rotate 90 /Contents 7 0 R >>',
    '<< /Type /Outlines /First 5 0 R /Last 6 0 R /Count 2 >>',
    '<< /Title (First point) /Parent 4 0 R /Dest (One) /Next 6 0 R >>',
    '<< /Title (Second point) /Parent 4 0 R /Dest (Two) /Prev 5 0 R >>',
    '<< /Length 0 >>\nstream\nendstream',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 8\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const file = new File([pdf], 'original-rotated-outline.pdf', { type: 'application/pdf' });
  const { book } = await new DocumentLoader(file).open();
  try {
    view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:600px;height:400px';
    document.body.append(view);
    await view.open(book);
    view.renderer.setAttribute('zoom', 'fit-page');
    const ids = [];
    for (const [position, item] of book.toc!.entries()) {
      const result = await view.navigate!(item.href);
      expect(result.status).toBe('arrived');
      expect(result.resolved?.index).toBe(0);
      const { doc } = view.renderer.getContents()[0]!;
      const rect = result.resolved!.anchor!(doc).getBoundingClientRect();
      // Rotation maps PDF x to viewport y; both coordinates are relative to the crop box.
      expect(rect.y / rect.x).toBeCloseTo(position === 0 ? 80 / 160 : 330 / 560);
      expect(view.lastLocation?.tocItem?.label).toBe(item.label);
      expect(view.lastLocation?.chapterQuality).toBe('resource');
      ids.push(view.lastLocation?.chapterId);
    }
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  } finally {
    view?.close();
    view?.remove();
    view = null;
    await book.destroy?.();
  }
});

describe('fixed-layout reading positions', () => {
  it('keeps navigation usable while a retiring iframe has no document element', async () => {
    const v = await mount(true);
    const doc = v.renderer.getContents().find((content) => content.index === 0)!.doc;
    // During iframe replacement, contentDocument can survive briefly after
    // its root has gone. A late position report must not break navigation.
    doc.documentElement.remove();
    await expect(v.renderer.goTo({ index: 0 })).resolves.toBeUndefined();
    expect(v.lastLocation?.range).toBeNull();
    await v.goTo(1);
    expect(v.renderer.index).toBe(1);
  });

  it('does not restore a stale position when a neighbouring page finishes drawing after a search jump', async () => {
    let finish!: () => void;
    let drawing!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const started = new Promise<void>((resolve) => {
      drawing = resolve;
    });
    view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:600px;height:400px';
    document.body.append(view);
    const book = {
      metadata: { title: 'Original delayed PDF drawing fixture' },
      rendition: {
        layout: 'pre-paginated',
        spread: 'none',
        viewport: { width: 600, height: 1400 },
      },
      sections: Array.from({ length: 3 }, (_, index) => ({
        id: index,
        size: 1000,
        linear: 'yes',
        load: async () => ({
          src: 'srcdoc',
          data: html,
          onZoom:
            index === 0
              ? async () => {
                  drawing();
                  await pending;
                }
              : undefined,
        }),
      })),
      toc: [],
      splitTOCHref: () => [null, null],
      getTOCFragment: (doc: Document) => doc.body,
    } as unknown as BookDoc;
    await view.open(book);
    view.renderer.setAttribute('zoom', 'fit-width');
    view.renderer.setAttribute('flow', 'scrolled');
    await view.goTo(1);
    await started;
    await view.goTo(targetCfi(view, 1));
    const position = view.renderer.scrollTop;
    expect(position).toBeGreaterThan(2000);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(Math.abs(view.renderer.scrollTop - position)).toBeLessThan(2);
  });
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

it('fits a whole page in continuous reading and keeps width fitting distinct after resize', async () => {
  const v = await mount(true);
  v.renderer.setAttribute('zoom', 'fit-page');
  await expect
    .poll(
      () =>
        v.renderer
          .getContents()
          .find((c) => c.index === 0)
          ?.doc.defaultView?.frameElement?.getBoundingClientRect().height,
    )
    .toBeLessThanOrEqual(401);
  const frame = () =>
    v.renderer.getContents().find((c) => c.index === 0)!.doc.defaultView!.frameElement!;
  expect(frame().getBoundingClientRect().width).toBeLessThan(200);
  v.renderer.setAttribute('zoom', 'fit-width');
  await expect.poll(() => frame().getBoundingClientRect().width).toBeCloseTo(600, 0);
  expect(frame().getBoundingClientRect().height).toBeGreaterThan(1000);
  v.style.height = '700px';
  v.renderer.setAttribute('zoom', 'fit-page');
  await expect.poll(() => frame().getBoundingClientRect().height).toBeCloseTo(700, 0);
});
