import './readingTimeSurface.browser.test';
import { expect, it } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { commands, page } from 'vitest/browser';
import { DocumentLoader } from '@/libs/document';
import { observeReadingSurface } from '@/glossa/plugins/readingActivity';
import type { ReadingActivity } from '@/glossa/plugins/readingTime';
import type { FoliateView } from '@/types/view';

const send = (activity: Record<string, unknown>) =>
  invoke<{
    activeSessionId: string | null;
    intervals: { id: string; sessionId: string; durationMs: number }[];
  }>('reading_time', { activity });

it('settles a minimized Mac window and waits for new activity after restore', async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
  const window = getCurrentWindow();
  const session = { bookHash: 'reading-time-test-minimize', sessionId: crypto.randomUUID() };
  expect((await send({ type: 'signal', session, kind: 'turn' })).activeSessionId).toBe(
    session.sessionId,
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await window.minimize();
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } finally {
    await window.unminimize();
  }
  const restored = await send({ type: 'status' });
  expect(restored.activeSessionId).toBeNull();
  const rows = restored.intervals.filter(({ sessionId }) => sessionId === session.sessionId);
  const total = rows.reduce((ms, row) => ms + row.durationMs, 0);
  expect(total).toBeGreaterThan(0);
  expect(total).toBeLessThan(1500);
  await send({ type: 'ack', ids: rows.map(({ id }) => id) });
});

it('recognizes native PDF panning and text selection on the document surface', async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
  await page.viewport(1000, 900);
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-reading-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  const { book } = await new DocumentLoader(new File([bytes], 'reading-sample.pdf')).open();
  const view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;position:fixed;left:40px;top:40px;width:600px;height:400px';
  document.body.append(view);
  let detach: (() => void) | undefined;
  try {
    await view.open(book);
    const renderer = view.renderer;
    renderer.setAttribute('spread', 'none');
    renderer.setAttribute('zoom', 'original-size');
    renderer.setAttribute('scale-factor', '200');
    await view.goTo(1);
    const documentForPage = () => renderer.getContents().find(({ index }) => index === 1)?.doc;
    const firstSpan = () => documentForPage()?.querySelector('.textLayer span');
    await expect.poll(firstSpan).toBeTruthy();
    const midpoint = (range: Range) => {
      const rect = range.getBoundingClientRect();
      const bounds = documentForPage()!.defaultView!.frameElement!.getBoundingClientRect();
      return {
        x: bounds.left + rect.left + rect.width / 2,
        y: bounds.top + rect.top + rect.height / 2,
      };
    };
    const waitForPointerSurface = async () => {
      await expect
        .poll(() => getComputedStyle(documentForPage()!.defaultView!.frameElement!).pointerEvents)
        .toBe('auto');
    };
    await waitForPointerSurface();
    const seen: ReadingActivity[] = [];
    detach = observeReadingSurface(
      view,
      'pdf-gesture-test',
      () => true,
      null,
      (kind) => seen.push(kind),
    );
    const span = firstSpan()!;
    const whole = documentForPage()!.createRange();
    whole.selectNodeContents(span);
    const start = midpoint(whole);
    const before = { x: renderer.scrollLeft, y: renderer.scrollTop };
    await commands.nativePanPDFText(start, { x: start.x - 45, y: start.y - 30 });
    await expect.poll(() => renderer.scrollTop - before.y).toBeGreaterThan(20);
    await expect.poll(() => seen.includes('scroll')).toBe(true);
    expect(renderer.index).toBe(1);
    expect(documentForPage()!.getSelection()?.isCollapsed).toBe(true);

    detach();
    view.style.height = '760px';
    renderer.setAttribute('scale-factor', '85');
    await view.goTo(1);
    await expect.poll(() => renderer.scale).toBeCloseTo(0.85);
    const copper = () =>
      [...(documentForPage()?.querySelectorAll('.textLayer span') ?? [])].find((span) =>
        span.textContent?.startsWith('Copper'),
      );
    await expect.poll(() => copper()?.textContent).toContain('Copper');
    await waitForPointerSurface();
    const position = (offset: number) => {
      const node = copper()!.firstChild!;
      const range = documentForPage()!.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      return midpoint(range);
    };
    seen.length = 0;
    detach = observeReadingSurface(
      view,
      'pdf-gesture-test',
      () => true,
      null,
      (kind) => seen.push(kind),
    );
    const from = position(0);
    const to = position(5);
    await commands.nativeDragPDFText(from, to, { x: (from.x + to.x) / 2, y: from.y });
    await expect.poll(() => seen.includes('selection')).toBe(true);
    expect(documentForPage()!.getSelection()?.isCollapsed).toBe(false);
  } finally {
    detach?.();
    view.close();
    view.remove();
    await book.destroy?.();
  }
}, 30_000);
