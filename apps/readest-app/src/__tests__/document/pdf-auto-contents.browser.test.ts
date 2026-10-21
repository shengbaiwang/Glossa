import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { PDFCache, PDFOutlineEntry } from '@/services/pdfEnhancement';
import { preparePDFContents } from '@/services/pdfAutoContents';
import type { FoliateView } from '@/types/view';
import recognized from '@/__tests__/fixtures/data/glossa-ocr-pages.json';
import 'foliate-js/view.js';

const storage = vi.hoisted(() => ({
  cache: { id: 'a'.repeat(32), pages: [], outline: null, revision: 0 } as PDFCache,
  saves: 0,
}));
vi.mock('@/services/pdfEnhancement', async (original) => ({
  ...(await original<typeof import('@/services/pdfEnhancement')>()),
  supportsLocalPDF: () => true,
  openPDFCache: async () => structuredClone(storage.cache),
  readOCRPage: async (_id: string, index: number) => recognized[index] ?? null,
  startPDFOCR: async () => {
    throw new Error('Native text/cached OCR should need no worker');
  },
  savePDFOutline: async (
    _source: string,
    cache: PDFCache,
    outline: PDFOutlineEntry[] | null,
    _count: number,
    generator: string,
  ) => {
    expect(cache.revision).toBe(storage.cache.revision);
    storage.saves++;
    storage.cache = { ...storage.cache, outline, generator, revision: cache.revision + 1 };
    return structuredClone(storage.cache);
  },
}));

let book: BookDoc | null = null;
let view: FoliateView | null = null;
it('extracts all native pages when WebView streams have no async iterator', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    ReadableStream.prototype,
    Symbol.asyncIterator,
  );
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    value: undefined,
  });
  try {
    const bytes = await fetch('/src/__tests__/fixtures/data/glossa-auto-toc-sample.pdf').then((r) =>
      r.arrayBuffer(),
    );
    book = (await new DocumentLoader(new File([bytes], 'compatibility.pdf')).open()).book;
    for (let index = 0; index < book.sections.length; index++) {
      expect(typeof (await book.getPDFText!(index))).toBe('string');
      expect(Array.isArray(await book.getPDFContentsLines!(index))).toBe(true);
    }
    expect(await preparePDFContents('/original.pdf', book)).toBe('generated');
  } finally {
    if (descriptor)
      Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, descriptor);
    else Reflect.deleteProperty(ReadableStream.prototype, Symbol.asyncIterator);
  }
}, 20000);
beforeEach(() => {
  storage.cache = { id: 'a'.repeat(32), pages: [], outline: null, revision: 0 };
  storage.saves = 0;
});
afterEach(async () => {
  view?.close();
  view?.remove();
  await book?.destroy?.();
  book = null;
  view = null;
});

for (const scanned of [false, true]) {
  it(`automatically prepares, reopens and navigates a real ${scanned ? 'scanned' : 'native-text'} PDF without manual calibration`, async () => {
    if (scanned) storage.cache.pages = [0, 1, 2, 3];
    const filename = scanned ? 'glossa-ocr-sample.pdf' : 'glossa-auto-toc-sample.pdf';
    const bytes = await fetch(`/src/__tests__/fixtures/data/${filename}`).then((r) =>
      r.arrayBuffer(),
    );
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const file = new File([bytes], filename, { type: 'application/pdf' });
    const open = async () =>
      (await new DocumentLoader(file, { nativeFilePath: '/original.pdf' }).open()).book;
    book = await open();
    if (!scanned)
      expect(await book.getPDFContentsLines!(1)).toEqual([
        'Chapter 1 Copper 1',
        'Chapter 2 Amber 5',
        'Chapter 3 Silver 9',
      ]);
    expect(await preparePDFContents('/original.pdf', book)).toBe('generated');
    expect(storage.saves).toBe(1);
    expect(storage.cache.outline?.map((entry) => entry.pageIndex)).toEqual(
      scanned ? [1, 2] : [4, 8, 12],
    );
    await book.destroy?.();
    book = await open();
    expect(book.toc?.map((entry) => entry.label)).toEqual(
      storage.cache.outline?.map((entry) => entry.title),
    );
    view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:600px;height:600px';
    document.body.append(view);
    await view.open(book);
    view.renderer.setAttribute('spread', 'none');
    for (const entry of book.toc!) {
      await view.goTo(entry.href);
      expect(view.lastLocation?.tocItem?.label).toBe(entry.label);
      await expect
        .poll(
          () =>
            view!.renderer
              .getContents()
              .find((page) => page.index === entry.index)
              ?.doc.querySelector('.textLayer')?.textContent,
        )
        .toContain(entry.label);
    }
    expect(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())).toEqual(digest);
  }, 20000);
}

it('keeps rejected embedded destinations replaced by page navigation after reopening', async () => {
  storage.cache.generator = 'glossa-pages-1';
  storage.cache.revision = 1;
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-reading-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  book = (
    await new DocumentLoader(new File([bytes], 'original.pdf'), {
      nativeFilePath: '/original.pdf',
    }).open()
  ).book;
  expect(book.toc).toEqual(book.pageList);
  expect(book.toc).toHaveLength(4);
});
