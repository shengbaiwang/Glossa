import { afterEach, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import { invoke } from '@tauri-apps/api/core';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import 'foliate-js/view.js';

declare module 'vitest/browser' {
  interface BrowserCommands {
    nativePanPDFText(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
    nativeDragPDFText(
      from: { x: number; y: number },
      to: { x: number; y: number },
      via: { x: number; y: number },
    ): Promise<void>;
  }
}

let view: FoliateView | undefined;
let book: BookDoc | undefined;
afterEach(async () => {
  view?.close();
  view?.remove();
  await book?.destroy?.();
  view = undefined;
  book = undefined;
});

it('uses trusted native mouse input to refine a PDF selection after crossing line whitespace', async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
  await page.viewport(1000, 900);
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-reading-sample.pdf').then(
    (response) => response.arrayBuffer(),
  );
  book = (await new DocumentLoader(new File([bytes], 'original.pdf')).open()).book;
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;position:fixed;left:40px;top:40px;width:640px;height:760px';
  document.body.append(view);
  await view.open(book);
  view.renderer.setAttribute('spread', 'none');
  view.renderer.setAttribute('zoom', 'original-size');
  view.renderer.setAttribute('scale-factor', '85');
  await view.goTo(1);
  await expect.poll(() => view!.renderer.scale).toBeCloseTo(0.85);
  await expect
    .poll(
      () =>
        view!.renderer
          .getContents()
          .find((content) => content.index === 1)
          ?.doc.querySelector('.textLayer')?.textContent,
    )
    .toContain('Copper');
  const doc = view.renderer.getContents().find((content) => content.index === 1)!.doc;
  await expect
    .poll(() => getComputedStyle(doc.defaultView!.frameElement!).pointerEvents)
    .toBe('auto');
  const span = [...doc.querySelectorAll<HTMLElement>('.textLayer span')].find((element) =>
    element.textContent?.startsWith('Copper'),
  )!;
  const range = doc.createRange();
  range.setStart(span.firstChild!, 0);
  range.setEnd(span.firstChild!, 6);
  const saved = view.getCFI(1, range);
  const partial = range.getBoundingClientRect();
  const entire = doc.createRange();
  entire.selectNodeContents(span);
  const line = entire.getBoundingClientRect();
  const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
  const events: { type: string; trusted: boolean; x: number; y: number }[] = [];
  const observe = (event: PointerEvent) => {
    events.push({ type: event.type, trusted: event.isTrusted, x: event.clientX, y: event.clientY });
  };
  for (const type of ['pointerdown', 'pointermove', 'pointerup'])
    doc.addEventListener(type, observe as EventListener, { passive: true });
  try {
    await commands.nativeDragPDFText(
      { x: frame.left + partial.left + 0.5, y: frame.top + partial.top + partial.height / 2 },
      { x: frame.left + partial.right - 0.5, y: frame.top + partial.top + partial.height / 2 },
      { x: frame.left + line.right + 12, y: frame.top + line.top + line.height / 2 },
    );
    // Posting Quartz input completes before WebKit necessarily dispatches it.
    await expect
      .poll(() => events.some((event) => event.type === 'pointerup' && event.trusted))
      .toBe(true);
    expect(events.some((event) => event.type === 'pointerdown' && event.trusted)).toBe(true);
    expect(
      events.some(
        (event) => event.type === 'pointermove' && event.trusted && event.x > line.right + 4,
      ),
    ).toBe(true);
    expect(events.every((event) => event.trusted)).toBe(true);
    await commands.recordNativePDFEvidence({
      kind: 'selection-geometry',
      events,
      partial: partial.toJSON(),
      line: line.toJSON(),
      frame: frame.toJSON(),
      finalFrame: doc.defaultView!.frameElement!.getBoundingClientRect().toJSON(),
      transform: getComputedStyle(doc.defaultView!.frameElement!).transform,
      selected: doc.getSelection()!.toString(),
    });
    expect(doc.getSelection()!.toString()).toBe('Copper');
    expect(view.resolveCFI(saved).anchor(doc).toString()).toBe('Copper');
    await commands.recordNativePDFEvidence({
      kind: 'selection',
      trusted: true,
      events: events.length,
      selected: doc.getSelection()!.toString(),
    });
  } finally {
    for (const type of ['pointerdown', 'pointermove', 'pointerup'])
      doc.removeEventListener(type, observe as EventListener);
  }
}, 60000);

for (const scrolled of [false, true]) {
  it(`uses native Space and mouse to pan a zoomed PDF without turning pages (${scrolled})`, async () => {
    expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
    await page.viewport(1000, 900);
    const bytes = await fetch('/src/__tests__/fixtures/data/glossa-reading-sample.pdf').then((r) =>
      r.arrayBuffer(),
    );
    book = (await new DocumentLoader(new File([bytes], 'original.pdf')).open()).book;
    view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;position:fixed;left:40px;top:40px;width:600px;height:400px';
    document.body.append(view);
    await view.open(book);
    const r = view.renderer;
    r.setAttribute('spread', 'none');
    r.setAttribute('zoom', 'original-size');
    r.setAttribute('scale-factor', '200');
    if (scrolled) r.setAttribute('flow', 'scrolled');
    await view.goTo(1);
    await expect
      .poll(() =>
        r
          .getContents()
          .find((c) => c.index === 1)
          ?.doc.querySelector('.textLayer span'),
      )
      .toBeTruthy();
    const doc = r.getContents().find((c) => c.index === 1)!.doc;
    await expect
      .poll(() => getComputedStyle(doc.defaultView!.frameElement!).pointerEvents)
      .toBe('auto');
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('.textLayer span')!);
    const box = range.getBoundingClientRect();
    const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
    const from = {
      x: frame.left + box.left + box.width / 2,
      y: frame.top + box.top + box.height / 2,
    };
    const events: { type: string; trusted: boolean }[] = [];
    const record = (e: Event) => events.push({ type: e.type, trusted: e.isTrusted });
    for (const type of ['keydown', 'pointerdown', 'pointerup'])
      doc.defaultView!.addEventListener(type, record, true);
    const before = { x: r.scrollLeft, y: r.scrollTop };
    await commands.nativePanPDFText(from, { x: from.x - 45, y: from.y - 30 });
    for (const type of ['keydown', 'pointerdown', 'pointerup'])
      doc.defaultView!.removeEventListener(type, record, true);
    expect(events.filter((e) => e.type === 'keydown').length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === 'pointerdown').length).toBeGreaterThan(0);
    expect(events.every((e) => e.trusted)).toBe(true);
    // Native input crosses the scaled WebView's integer screen coordinates.
    // Allow one CSS pixel of rounding, while rejecting scaled/shortened drags.
    expect(Math.abs(r.scrollLeft - before.x - 45)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.scrollTop - before.y - 30)).toBeLessThanOrEqual(1);
    expect(r.index).toBe(1);
    expect(doc.getSelection()?.toString() ?? '').toBe('');
  }, 60000);
}
