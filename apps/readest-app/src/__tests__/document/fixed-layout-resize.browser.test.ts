import { afterEach, describe, expect, it, vi } from 'vitest';
import 'foliate-js/view.js';
import type { FoliateView } from '@/types/view';
import type { BookDoc } from '@/libs/document';

let view: FoliateView | undefined;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount(
  scrolled: boolean,
  options: { pages?: number; rtl?: boolean; horizontal?: boolean } = {},
) {
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
    dir: options.rtl ? 'rtl' : 'ltr',
    rendition: {
      layout: 'pre-paginated',
      spread: 'none',
      viewport: { width: 600, height: 800 },
    },
    sections: Array.from({ length: options.pages ?? 1 }, (_, index) => ({
      id: index,
      size: 1000,
      linear: 'yes',
      load: async () => ({
        src: 'srcdoc',
        data: '<meta name="viewport" content="width=600,height=800"><div class="textLayer">Precise selection stays in this document.</div>',
        onZoom: draw,
      }),
    })),
    toc: [],
    splitTOCHref: () => [null, null],
    getTOCFragment: (doc: Document) => doc.body,
  } as unknown as BookDoc);
  view.renderer.setAttribute('zoom', 'fit-width');
  if (options.horizontal) view.renderer.setAttribute('scroll-direction', 'horizontal');
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

for (const scrolled of [false, true]) {
  it(`keeps the published bitmap at the preview size while annotations are pending (${scrolled})`, async () => {
    const { v, draw } = await mount(scrolled);
    const r = v.renderer;
    const iframe = r.getContents()[0]!.doc.defaultView!.frameElement as HTMLIFrameElement;
    let finish!: () => void;
    const annotations = new Promise<void>((resolve) => {
      finish = resolve;
    });
    draw.mockImplementationOnce(async (options) => {
      const { doc, scale, onCommit } = options as typeof options & { onCommit?: () => void };
      const surface = doc.createElement('div');
      surface.id = 'published-bitmap';
      surface.style.width = `${600 * scale}px`;
      doc.body.append(surface);
      onCommit?.();
      await annotations;
    });
    r.setZoom?.('original-size', 200, true);
    const preview = iframe.getBoundingClientRect();
    r.setZoom?.('original-size', 200);
    try {
      for (let n = 0; n < 4; n++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const visibleWidth =
          (iframe.contentDocument!.getElementById('published-bitmap')!.getBoundingClientRect()
            .width *
            iframe.getBoundingClientRect().width) /
          iframe.clientWidth;
        expect(visibleWidth).toBeCloseTo(preview.width, 0);
      }
    } finally {
      finish();
    }
  });
}

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

for (const scrolled of [false, true]) {
  it(`keeps a page point stationary through slider zoom and commit (${scrolled})`, async () => {
    const { v } = await mount(scrolled);
    const r = v.renderer;
    r.setAttribute('zoom', 'original-size');
    r.setAttribute('scale-factor', '200');
    r.scrollTop = 350;
    r.scrollLeft = 160;
    await pause(180);
    const frame = r.getContents()[0]!.doc.defaultView!.frameElement!;
    const host = r.getBoundingClientRect();
    const x = host.left + r.clientWidth / 2;
    const y = host.top + r.clientHeight / 2;
    const rect = frame.getBoundingClientRect();
    const u = (x - rect.left) / rect.width;
    const w = (y - rect.top) / rect.height;
    r.setAttribute('zoom-preview', '');
    for (const level of [215, 243, 270]) {
      r.setAttribute('scale-factor', String(level));
      const b = frame.getBoundingClientRect();
      expect(Math.abs(b.left + b.width * u - x)).toBeLessThan(2);
      expect(Math.abs(b.top + b.height * w - y)).toBeLessThan(2);
    }
    r.removeAttribute('zoom-preview');
    await pause(180);
    const end = frame.getBoundingClientRect();
    expect(Math.abs(end.left + end.width * u - x)).toBeLessThan(2);
    expect(Math.abs(end.top + end.height * w - y)).toBeLessThan(2);
  });

  it(`coalesces ctrl-wheel at the pointer and commits once (${scrolled})`, async () => {
    const { v, draw } = await mount(scrolled);
    const r = v.renderer;
    const doc = r.getContents()[0]!.doc;
    const frame = doc.defaultView!.frameElement!;
    const before = frame.getBoundingClientRect();
    const x = before.left + 210,
      y = before.top + 170;
    const commit = vi.fn();
    r.addEventListener('pdf-zoom-commit', commit);
    for (let i = 0; i < 8; i++) {
      const b = frame.getBoundingClientRect();
      doc.dispatchEvent(
        new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: -10,
          clientX: ((x - b.left) * 600) / b.width,
          clientY: ((y - b.top) * 800) / b.height,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    await pause(40);
    expect(r.scale).toBeGreaterThan(1.1);
    expect(draw).not.toHaveBeenCalled();
    await expect.poll(() => commit.mock.calls.length).toBe(1);
    await expect.poll(() => draw.mock.calls.length).toBe(1);
    const b = frame.getBoundingClientRect();
    expect(Math.abs(b.left + (b.width * 210) / before.width - x)).toBeLessThan(2);
    expect(Math.abs(b.top + (b.height * 170) / before.height - y)).toBeLessThan(2);
    expect(Number.isInteger(Number(r.getAttribute('scale-factor')))).toBe(true);
  });
}

for (const scrolled of [false, true]) {
  it(`anchors WebKit gestures and touch preview through release (${scrolled})`, async () => {
    const { v, draw } = await mount(scrolled);
    const r = v.renderer;
    const doc = r.getContents()[0]!.doc;
    const frame = doc.defaultView!.frameElement!;
    const send = (name: string, scale: number) =>
      doc.dispatchEvent(
        Object.assign(new Event(name, { bubbles: true, cancelable: true }), {
          scale,
          clientX: 220,
          clientY: 180,
        }),
      );
    send('gesturestart', 1);
    send('gesturechange', 1.2);
    send('gesturechange', 1.6);
    await pause(30);
    const preview = frame.getBoundingClientRect();
    expect(draw).not.toHaveBeenCalled();
    send('gestureend', 1.6);
    await expect.poll(() => draw.mock.calls.length).toBe(1);
    expect(r.scale).toBe(1.6);
    const after = frame.getBoundingClientRect();
    expect(Math.abs(after.left - preview.left)).toBeLessThan(2);
    expect(Math.abs(after.top - preview.top)).toBeLessThan(2);
    draw.mockClear();
    r.pinchZoom?.(1.25);
    await pause(30);
    const touch = frame.getBoundingClientRect();
    expect(r.pinchEnd?.()).toBe(200);
    await expect.poll(() => draw.mock.calls.length).toBe(1);
    expect(Math.abs(frame.getBoundingClientRect().left - touch.left)).toBeLessThan(2);
    expect(Math.abs(frame.getBoundingClientRect().top - touch.top)).toBeLessThan(2);
  });
}

it('cancels a pending trackpad commit on close', async () => {
  const { v, draw } = await mount(false);
  const commit = vi.fn();
  v.renderer.addEventListener('pdf-zoom-commit', commit);
  v.renderer.getContents()[0]!.doc.dispatchEvent(
    new WheelEvent('wheel', {
      ctrlKey: true,
      deltaY: -40,
      clientX: 200,
      clientY: 150,
      cancelable: true,
    }),
  );
  v.close();
  await pause(220);
  expect(commit).not.toHaveBeenCalled();
  expect(draw).not.toHaveBeenCalled();
});

for (const horizontal of [false, true])
  for (const rtl of [false, true]) {
    it(`keeps the same page point on long strips (horizontal=${horizontal}, rtl=${rtl})`, async () => {
      const { v } = await mount(true, { pages: 6, horizontal, rtl });
      const r = v.renderer;
      await v.goTo(3);
      r.setZoom?.('original-size', 200);
      await pause(200);
      const iframe = r.getContents().find((c) => c.index === 3)!.doc.defaultView!.frameElement!;
      const host = r.getBoundingClientRect();
      const x = host.left + r.clientWidth / 2,
        y = host.top + r.clientHeight / 2;
      const before = iframe.getBoundingClientRect();
      const u = (x - before.left) / before.width,
        w = (y - before.top) / before.height;
      for (const level of [223, 250, 200]) {
        r.setZoom?.('original-size', level, true);
        const box = iframe.getBoundingClientRect();
        expect(Math.abs(box.left + box.width * u - x)).toBeLessThan(2);
        expect(Math.abs(box.top + box.height * w - y)).toBeLessThan(2);
      }
      r.removeAttribute('zoom-preview');
      await pause(180);
      expect(r.index).toBe(3);
    });
  }

it('changes fit mode and level together without an intermediate clamp', async () => {
  const { v } = await mount(false);
  const r = v.renderer;
  r.setZoom?.('fit-width', 250);
  r.scrollLeft = 400;
  r.scrollTop = 500;
  const iframe = r.getContents()[0]!.doc.defaultView!.frameElement!;
  const host = r.getBoundingClientRect();
  const x = host.left + r.clientWidth / 2,
    y = host.top + r.clientHeight / 2;
  const before = iframe.getBoundingClientRect();
  r.setZoom?.('original-size', 260, true);
  const after = iframe.getBoundingClientRect();
  expect(Math.abs(after.left + ((x - before.left) * after.width) / before.width - x)).toBeLessThan(
    2,
  );
  expect(Math.abs(after.top + ((y - before.top) * after.height) / before.height - y)).toBeLessThan(
    2,
  );
});

it('restores a cancelled touch preview and keeps a plain Space tap available to shortcuts', async () => {
  const { v } = await mount(false);
  const r = v.renderer;
  const commit = vi.fn();
  r.addEventListener('pdf-zoom-commit', commit);
  r.pinchZoom?.(1.7);
  await pause(30);
  expect(r.scale).toBe(1.7);
  r.pinchEnd?.(true);
  expect(r.scale).toBe(1);
  expect(commit).not.toHaveBeenCalled();
  await pause(180);
  const doc = r.getContents()[0]!.doc;
  const shortcut = vi.fn();
  doc.addEventListener('keydown', shortcut);
  doc.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
  );
  expect(shortcut).not.toHaveBeenCalled();
  doc.body.dispatchEvent(
    new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
  );
  expect(shortcut).toHaveBeenCalledOnce();
  const hostShortcut = vi.fn();
  r.addEventListener('keydown', hostShortcut);
  r.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true }));
  expect(r.style.cursor).toBe('grab');
  r.ownerDocument.defaultView!.dispatchEvent(new Event('blur'));
  expect(r.style.cursor).toBe('');
  r.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', cancelable: true }));
  expect(hostShortcut).not.toHaveBeenCalled();
});

for (const scrolled of [false, true]) {
  it(`allows pinch zoom down to 5% and back up without snapping to 50% (${scrolled})`, async () => {
    const { v } = await mount(scrolled);
    const r = v.renderer;
    r.pinchZoom?.(0.01);
    await expect.poll(() => r.scale).toBeCloseTo(0.05);
    expect(r.pinchEnd?.()).toBe(5);
    await expect.poll(() => r.getAttribute('scale-factor')).toBe('5');
    r.pinchZoom?.(2);
    await expect.poll(() => r.scale).toBeCloseTo(0.1);
    expect(r.pinchEnd?.()).toBe(10);
  });
}

it('keeps the same page and reading point after shrinking to 5% and zooming back', async () => {
  const { v } = await mount(true, { pages: 4 });
  await v.goTo(1);
  const r = v.renderer;
  r.setZoom?.('original-size', 100);
  await pause(200);
  const frame = r.getContents().find((c) => c.index === 1)!.doc.defaultView!.frameElement!;
  const before = frame.getBoundingClientRect();
  r.setZoom?.('original-size', 5);
  await pause(200);
  expect(r.index).toBe(1);
  r.setZoom?.('original-size', 100);
  await pause(200);
  expect(r.index).toBe(1);
  expect(frame.getBoundingClientRect().top).toBeCloseTo(before.top, 0);
});
