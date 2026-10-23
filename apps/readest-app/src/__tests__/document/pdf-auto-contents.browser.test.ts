import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { PDFCache, PDFOutlineEntry } from '@/services/pdfEnhancement';
import { preparePDFContents } from '@/services/pdfAutoContents';
import type { FoliateView } from '@/types/view';
import recognized from '@/__tests__/fixtures/data/glossa-ocr-pages.json';
import TOCView from '@/app/reader/components/sidebar/TOCView';
import { useReaderStore } from '@/store/readerStore';
import '@/styles/globals.css';
import '@/styles/glossa.css';
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
    const reports: import('@/services/pdfAutoContents').PDFContentsReport[] = [];
    const result = await preparePDFContents('/original.pdf', book, undefined, (report) =>
      reports.push(report),
    );
    expect(result, JSON.stringify(reports.at(-1))).toBe('generated');
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
  cleanup();
  useReaderStore.setState({ getView: useReaderStore.getInitialState().getView });
  view?.close();
  view?.remove();
  await book?.destroy?.();
  book = null;
  view = null;
});

it('restores unnumbered parts across printed contents pages, then reopens, folds and navigates every entry', async () => {
  await page.viewport(1100, 800);
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-part-toc-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  const file = new File([bytes], 'original-parts.pdf', { type: 'application/pdf' });
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const open = async () =>
    (await new DocumentLoader(file, { nativeFilePath: '/original.pdf' }).open()).book;
  book = await open();
  const expected = [
    { title: 'Preface', pageIndex: 3, level: 0 },
    { title: 'Part I Hills', pageIndex: 4, level: 0 },
    { title: 'Copper observations', pageIndex: 5, level: 1 },
    { title: 'Amber experiments', pageIndex: 7, level: 1 },
    { title: 'Part II Cities', pageIndex: 9, level: 0 },
    { title: 'Silver results', pageIndex: 10, level: 1 },
    { title: 'Afterword', pageIndex: 13, level: 0 },
    { title: 'Appendix 1: Materials', pageIndex: 14, level: 0 },
  ];
  const layout = await book.getPDFContentsLayout!(0);
  expect(layout.find((row) => row.text === 'Part I Hills')!.height).toBeGreaterThan(
    layout.find((row) => row.text.startsWith('Copper observations'))!.height,
  );
  expect(await preparePDFContents('/original.pdf', book)).toBe('generated');
  expect(storage.cache.outline).toEqual(expected);
  expect(storage.saves).toBe(1);
  await book.destroy?.();
  book = await open();
  expect(book.toc?.map((item) => item.label)).toEqual([
    'Preface',
    'Part I Hills',
    'Part II Cities',
    'Afterword',
    'Appendix 1: Materials',
  ]);
  expect(book.toc?.[1]?.subitems?.map((item) => item.label)).toEqual([
    'Copper observations',
    'Amber experiments',
  ]);
  expect(book.toc?.[2]?.subitems?.map((item) => item.label)).toEqual(['Silver results']);
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:600px;height:600px;margin-left:330px';
  document.body.append(view);
  await view.open(book);
  useReaderStore.setState({ getView: () => view });
  const panel = render(
    React.createElement(
      'aside',
      {
        style: { position: 'absolute', left: 0, top: 0, width: 320, height: 650 },
        className: 'bg-base-200 text-base-content',
      },
      React.createElement(TOCView, { bookKey: 'parts-0', toc: book.toc! }),
    ),
  );
  expect(screen.queryByText('Copper observations')).toBeNull();
  await userEvent.click(await screen.findByRole('button', { name: 'Expand Part I Hills' }));
  await screen.findByText('Copper observations');
  await screen.findByText('Amber experiments');
  expect(screen.queryByText('Silver results')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Collapse Part I Hills' }));
  await waitFor(() => expect(screen.queryByText('Copper observations')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Expand Part II Cities' }));
  await screen.findByText('Silver results');
  await userEvent.click(screen.getByRole('button', { name: 'Expand Part I Hills' }));
  const flatten = (items: NonNullable<BookDoc['toc']>): NonNullable<BookDoc['toc']> =>
    items.flatMap((item) => [item, ...flatten(item.subitems ?? [])]);
  for (const [index, entry] of flatten(book.toc!).entries()) {
    await userEvent.click(screen.getByText(entry.label));
    await expect.poll(() => view!.lastLocation?.tocItem?.label).toBe(entry.label);
    await expect
      .poll(
        () =>
          view!.renderer
            .getContents()
            .find((content) => content.index === expected[index]!.pageIndex)
            ?.doc.querySelector('.textLayer')?.textContent,
      )
      .toContain(entry.label);
  }
  await page.screenshot({
    path: '/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-part-hierarchy.png',
  });
  panel.unmount();
  render(React.createElement(TOCView, { bookKey: 'parts-0', toc: book.toc! }));
  await screen.findByRole('button', { name: 'Expand Part I Hills' });
  expect(screen.queryByText('Copper observations')).toBeNull();
  expect(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())).toEqual(digest);
}, 30000);

it('uses every internal link of an unlabelled contents page, then reopens and navigates its hierarchy', async () => {
  const filename = 'glossa-linked-toc-sample.pdf';
  const bytes = await fetch(`/src/__tests__/fixtures/data/${filename}`).then((r) =>
    r.arrayBuffer(),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const file = new File([bytes], filename, { type: 'application/pdf' });
  const open = async () =>
    (await new DocumentLoader(file, { nativeFilePath: '/original.pdf' }).open()).book;
  book = await open();
  const expected = [
    { title: 'Chapter 1 Copper', pageIndex: 1, level: 0 },
    { title: '1.1 Tin', pageIndex: 2, level: 1 },
    { title: 'Chapter 2 Amber', pageIndex: 3, level: 0 },
    { title: 'Chapter 3 Silver', pageIndex: 4, level: 0 },
    { title: 'Appendix Quartz', pageIndex: 5, level: 0 },
  ];
  expect(await book.getPDFContentsLinks!(0)).toEqual(expected);
  expect(await preparePDFContents('/original.pdf', book)).toBe('generated');
  expect(storage.cache.outline).toEqual(expected);
  expect(storage.saves).toBe(1);
  await book.destroy?.();
  book = await open();
  const flatten = (items: NonNullable<BookDoc['toc']>): NonNullable<BookDoc['toc']> =>
    items.flatMap((item) => [item, ...flatten(item.subitems ?? [])]);
  const entries = flatten(book.toc ?? []);
  expect(entries.map((entry) => entry.label)).toEqual(expected.map((entry) => entry.title));
  expect(book.toc?.[0]?.subitems?.[0]?.label).toBe('1.1 Tin');
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:600px;height:600px';
  document.body.append(view);
  await view.open(book);
  view.renderer.setAttribute('spread', 'none');
  for (const [index, entry] of entries.entries()) {
    await view.goTo(entry.href);
    await expect
      .poll(
        () =>
          view!.renderer
            .getContents()
            .find((page) => page.index === expected[index]!.pageIndex)
            ?.doc.querySelector('.textLayer')?.textContent,
      )
      .toContain(entry.label);
  }
  expect(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())).toEqual(digest);
}, 20000);

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
