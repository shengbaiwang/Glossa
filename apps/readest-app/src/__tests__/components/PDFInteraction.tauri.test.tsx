import '../app/reader/components/PDFReadingControls.browser.test';
import '../document/fixed-layout-resize.browser.test';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { commands, page } from 'vitest/browser';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { DocumentLoader } from '@/libs/document';
import type { FoliateView } from '@/types/view';

declare module 'vitest/browser' {
  interface BrowserCommands {
    recordNativePDFEvidence(evidence: Record<string, unknown>): Promise<void>;
  }
}

const nativeInputs: { type: string; trusted: boolean }[] = [];
const recordInput = (event: Event) => {
  nativeInputs.push({ type: event.type, trusted: event.isTrusted });
};

beforeAll(async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
  document.addEventListener('pointerdown', recordInput, true);
  document.addEventListener('keydown', recordInput, true);
});

afterAll(async () => {
  document.removeEventListener('pointerdown', recordInput, true);
  document.removeEventListener('keydown', recordInput, true);
  expect(nativeInputs.filter((event) => event.type === 'pointerdown').length).toBeGreaterThan(3);
  expect(nativeInputs.filter((event) => event.type === 'keydown').length).toBeGreaterThan(3);
  expect(nativeInputs.every((event) => event.trusted)).toBe(true);
  await commands.recordNativePDFEvidence({
    kind: 'controls',
    pointerDowns: nativeInputs.filter((event) => event.type === 'pointerdown').length,
    keyDowns: nativeInputs.filter((event) => event.type === 'keydown').length,
    trusted: nativeInputs.every((event) => event.trusted),
  });
});

it('keeps PDF geometry and frame pacing during actual native window resizing', async () => {
  const nativeWindow = getCurrentWindow();
  const original = (await nativeWindow.innerSize()).toLogical(await nativeWindow.scaleFactor());
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-reading-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  const book = (await new DocumentLoader(new File([bytes], 'original.pdf')).open()).book;
  // Match FoliateViewer: initial spread belongs in the rendition before open.
  // A spread attribute set before the first navigation has no active spread to change.
  book.rendition!.spread = 'none';
  const view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:calc(100vw - 80px);height:700px';
  document.body.append(view);
  let active = false;
  const frames: number[] = [];
  let previous = 0;
  let animation = 0;
  const sample = (now: number) => {
    if (!active) return;
    if (previous) frames.push(now - previous);
    previous = now;
    animation = requestAnimationFrame(sample);
  };
  try {
    await view.open(book);
    view.renderer.setAttribute('zoom', 'fit-width');
    await view.goTo(1);
    expect(view.renderer.getContents().map(({ index }) => index)).toEqual([1]);
    const doc = view.renderer.getContents().find((c) => c.index === 1)!.doc;
    active = true;
    animation = requestAnimationFrame(sample);
    for (const width of [1100, 1040, 980, 920, 860, 800, 740, 900]) {
      await nativeWindow.setSize(new LogicalSize(width, 850));
      const actual = (await nativeWindow.innerSize()).toLogical(await nativeWindow.scaleFactor());
      expect(actual.width).toBeCloseTo(width, 0);
      await expect.poll(() => window.top!.innerWidth).toBeCloseTo(actual.width, 0);
      await expect.poll(() => window.top!.innerHeight).toBeCloseTo(actual.height, 0);
      // Vitest nests the product document in a fixed viewport. Mirror the
      // independently verified system WebView size into that test container.
      await page.viewport(actual.width, actual.height);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      expect(view.renderer.getContents().find((c) => c.index === 1)!.doc).toBe(doc);
    }
    active = false;
    cancelAnimationFrame(animation);
    await expect
      .poll(() => doc.defaultView!.frameElement!.getBoundingClientRect().width)
      .toBeCloseTo(view.renderer.getBoundingClientRect().width, 0);
    await expect
      .poll(() => doc.defaultView!.frameElement!.getAttribute('style'))
      .not.toContain('scale(');
    expect(doc.querySelector('.textLayer')!.textContent).toContain('Copper');
    expect(frames.length).toBeGreaterThan(8);
    const sorted = [...frames].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    await commands.recordNativePDFEvidence({
      kind: 'resize',
      samples: frames.length,
      p95,
      max: sorted.at(-1),
    });
    expect(p95).toBeLessThan(200);
  } finally {
    active = false;
    cancelAnimationFrame(animation);
    view.close();
    view.remove();
    await book.destroy?.();
    await nativeWindow.setSize(new LogicalSize(original.width, original.height));
  }
}, 60000);
