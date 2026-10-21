import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import recognized from '@/__tests__/fixtures/data/glossa-ocr-pages.json';
import 'foliate-js/view.js';
const native = vi.hoisted(() => ({
  pages: new Set<number>(),
  empty: new Set<number>(),
  requested: [] as number[],
  release: null as (() => void) | null,
  index: 0,
}));
vi.mock('@/services/pdfEnhancement', async (original) => ({
  ...(await original<typeof import('@/services/pdfEnhancement')>()),
  supportsLocalPDF: () => true,
  openPDFCache: async () => ({
    id: 'a'.repeat(32),
    pages: [...native.pages],
    outline: null,
    revision: 0,
  }),
  readOCRPage: async (_id: string, index: number) =>
    native.empty.has(index)
      ? { index, native: false, lines: [] }
      : native.pages.has(index)
        ? (recognized[index] ?? null)
        : null,
  startPDFOCR: async (_source: string, _id: string, indices: number[]) => {
    native.index = indices[0]!;
    native.requested.push(native.index);
    return { cacheId: 'a'.repeat(32) };
  },
  waitForPDFOCR: async () => {
    const i = native.index;
    if (i === 1 && (!native.pages.has(1) || native.empty.has(1)))
      await new Promise<void>((resolve) => {
        native.release = resolve;
      });
    native.pages.add(i);
    native.empty.delete(i);
    return { state: 'completed' };
  },
  cancelPDFOCR: async () => {},
}));
let book: BookDoc | undefined, view: FoliateView | undefined;
beforeEach(() => {
  native.pages.clear();
  native.empty.clear();
  native.requested = [];
  native.release = null;
  native.index = 0;
});
afterEach(async () => {
  native.release?.();
  view?.close();
  view?.remove();
  await book?.destroy?.();
  book = undefined;
  view = undefined;
});
it.each([
  false,
  true,
])('paints a missing or legacy-empty scan immediately, recovers background text after zoom, and preserves mouse-selected CFIs on reopen (legacy empty: %s)', async (legacyEmpty) => {
  if (legacyEmpty) {
    native.pages.add(1);
    native.empty.add(1);
  }
  await page.viewport(1100, 1000);
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-ocr-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  const file = new File([bytes], 'original.pdf');
  const open = async () => {
    book = (
      await new DocumentLoader(file, { nativeFilePath: '/original.pdf', autoPDFOCR: true }).open()
    ).book;
    view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:600px;height:800px';
    document.body.append(view);
    await view.open(book);
    view.renderer.setAttribute('spread', 'none');
    view.renderer.setAttribute('zoom', 'fit-width');
    await view.goTo(1);
  };
  await open();
  await expect.poll(() => native.release).not.toBeNull();
  let doc = view!.renderer.getContents().find((c) => c.index === 1)!.doc;
  expect(doc.querySelector('canvas')?.width).toBeGreaterThan(0);
  expect(doc.querySelector('[data-pdf-ocr-text]')).toBeNull();
  view!.renderer.setAttribute('scale-factor', '135');
  await expect.poll(() => doc.querySelector('[data-pdf-ocr-status]')).not.toBeNull();
  native.release!();
  await expect
    .poll(
      () =>
        view!.renderer
          .getContents()
          .find((c) => c.index === 1)
          ?.doc.querySelector('[data-pdf-ocr-text]')?.textContent,
    )
    .toContain('Copper');
  doc = view!.renderer.getContents().find((c) => c.index === 1)!.doc;
  expect(native.requested.filter((i) => i === 1)).toHaveLength(1);
  expect(doc.querySelector('[data-pdf-ocr-status]')).toBeNull();
  const span = [...doc.querySelectorAll<HTMLElement>('[data-pdf-ocr-text] span')].find((s) =>
    s.textContent?.startsWith('Copper'),
  )!;
  const probe = doc.createRange();
  probe.setStart(span.firstChild!, 0);
  probe.setEnd(span.firstChild!, 6);
  const box = probe.getBoundingClientRect(),
    host = (doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect();
  await commands.dragPDFText(
    { x: host.x + box.left + 0.5, y: host.y + box.top + box.height / 2 },
    { x: host.x + box.right - 0.5, y: host.y + box.top + box.height / 2 },
  );
  expect(doc.getSelection()!.toString()).toBe('Copper');
  const cfi = view!.getCFI(1, doc.getSelection()!.getRangeAt(0));
  view!.close();
  view!.remove();
  await book!.destroy?.();
  await open();
  await expect
    .poll(
      () =>
        view!.renderer
          .getContents()
          .find((c) => c.index === 1)
          ?.doc.querySelector('[data-pdf-ocr-text]')?.textContent,
    )
    .toContain('Copper');
  doc = view!.renderer.getContents().find((c) => c.index === 1)!.doc;
  expect(view!.resolveCFI(cfi).anchor(doc).toString()).toBe('Copper');
  await view!.goTo(3);
  expect(native.requested).not.toContain(3);
}, 20000);
