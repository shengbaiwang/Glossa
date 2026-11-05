import { afterEach, describe, expect, it, vi } from 'vitest';
import 'foliate-js/view.js';
import type { FoliateView } from '@/types/view';
import type { BookDoc } from '@/libs/document';

let view: FoliateView | undefined;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount(scrolled: boolean) {
  const draw = vi.fn(
    async ({ doc, scale }: { doc: Document; scale: number }): Promise<boolean | void> => {
      doc.documentElement.dataset['drawnScale'] = String(scale);
    },
  );
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:600px;height:400px';
  document.body.append(view);
  await view.open({
    metadata: { title: 'Original resize fixture' },
    rendition: {
      layout: 'pre-paginated',
      spread: 'none',
      viewport: { width: 600, height: 800 },
    },
    sections: [
      {
        id: 0,
        size: 1000,
        linear: 'yes',
        load: async () => ({
          src: 'srcdoc',
          data: '<meta name="viewport" content="width=600,height=800"><div class="textLayer">Precise selection stays in this document.</div>',
          onZoom: draw,
        }),
      },
    ],
    toc: [],
    splitTOCHref: () => [null, null],
    getTOCFragment: (doc: Document) => doc.body,
  } as unknown as BookDoc);
  view.renderer.setAttribute('zoom', 'fit-width');
  if (scrolled) view.renderer.setAttribute('flow', 'scrolled');
  await view.goTo(0);
  await expect
    .poll(() => view!.renderer.getContents()[0]?.doc.documentElement.dataset['drawnScale'])
    .toBe('1');
  await pause(180);
  draw.mockClear();
  return { v: view, draw };
}

afterEach(() => {
  view?.close();
  view?.remove();
  view = undefined;
});

describe('fixed-layout live resize', () => {
  for (const scrolled of [false, true]) {
    it(`previews each size and draws once after resize settles (${scrolled ? 'scroll' : 'pages'})`, async () => {
      const { v, draw } = await mount(scrolled);
      const frame = v.renderer.getContents()[0]!.doc.defaultView!.frameElement!;
      for (const width of [580, 560, 540, 520, 500]) {
        v.style.width = `${width}px`;
        // ResizeObserver runs after layout; the preview is then merged into
        // the next animation frame. Wait for those frames, not a wall timer.
        for (let frame = 0; frame < 3; frame++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        expect(Math.abs(frame.getBoundingClientRect().width - width)).toBeLessThan(2);
      }
      // Pointer movement updates layout without starting a bitmap/text rebuild
      // for every intermediate size. The settled size receives a crisp redraw.
      expect(draw.mock.calls.length).toBeLessThanOrEqual(1);
      await expect
        .poll(() => Number(v.renderer.getContents()[0]!.doc.documentElement.dataset['drawnScale']))
        .toBeCloseTo(500 / 600, 5);
      expect(draw).toHaveBeenCalledTimes(1);
      const text = v.renderer.getContents()[0]!.doc.querySelector('.textLayer')!.textContent;
      expect(text).toBe('Precise selection stays in this document.');
    });
  }

  it('does not rebuild unchanged PDF text on height-only resizing at fit width', async () => {
    const { v, draw } = await mount(true);
    v.style.height = '430px';
    await pause(200);
    expect(draw).not.toHaveBeenCalled();
  });

  it('cancels a pending resize redraw on close', async () => {
    const { v, draw } = await mount(false);
    v.style.width = '530px';
    await pause(30);
    draw.mockClear();
    v.close();
    await pause(180);
    expect(draw).not.toHaveBeenCalled();
  });

  it('retries an unsuccessful PDF drawing at the same scale and reuses successful text', async () => {
    const { v, draw } = await mount(false);
    draw.mockResolvedValueOnce(false);
    v.renderer.setAttribute('scale-factor', '140');
    await pause(10);
    v.renderer.setAttribute('scale-factor', '140');
    await expect.poll(() => draw.mock.calls.length).toBe(2);
    v.renderer.setAttribute('scale-factor', '140');
    await pause(20);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('previews a continuous zoom gesture and draws only its committed scale', async () => {
    const { v, draw } = await mount(false);
    const doc = v.renderer.getContents()[0]!.doc;
    const frame = doc.defaultView!.frameElement!;
    const text = doc.querySelector('.textLayer')!.firstChild;
    v.renderer.setAttribute('zoom-preview', '');
    v.renderer.setAttribute('scale-factor', '137.25');
    v.renderer.setAttribute('scale-factor', '141.75');
    expect(draw).not.toHaveBeenCalled();
    expect(doc.querySelector('.textLayer')!.firstChild).toBe(text);
    expect(frame.getBoundingClientRect().width).toBeCloseTo(600 * 1.4175, 0);
    const overlay = () => v.renderer.getContents()[0]!.overlayer as { element: SVGElement };
    expect(overlay().element.getAttribute('viewBox')).toBe('0 0 600 800');
    // Background OCR can publish while a window/slider preview is visible.
    doc.dispatchEvent(new Event('pdf-text-ready'));
    expect(overlay().element.getAttribute('viewBox')).toBe('0 0 600 800');
    v.renderer.removeAttribute('zoom-preview');
    await expect.poll(() => Number(doc.documentElement.dataset['drawnScale'])).toBe(1.4175);
    expect(draw).toHaveBeenCalledOnce();
    expect(overlay().element.hasAttribute('viewBox')).toBe(false);
  });
});
