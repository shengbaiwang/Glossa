import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import {
  openPDFCache,
  getPDFOCRStatus,
  supportsLocalPDF,
  readOCRPage,
  OCRContentsLines,
  type OCRPage,
} from '@/services/pdfEnhancement';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import type { Book } from '@/types/book';
import type { FoliateView } from '@/types/view';
import type { SystemSettings } from '@/types/settings';
import PDFContentsPanel from '@/glossa/plugins/PDFContentsPanel';
import type { PDFContentsReport } from '@/services/pdfAutoContents';
import { preparePDFContents } from '@/services/pdfAutoContents';
import TOCView from '@/app/reader/components/sidebar/TOCView';
import 'foliate-js/view.js';

// The document-access host points only at an original fixture in this test's
// sandbox. PDF commands, Vision, sidecars and the WKWebView remain real.
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: host }) }));
const diagnostics = vi.hoisted(() => ({
  outcome: undefined as { result: string; report?: PDFContentsReport } | undefined,
}));
vi.mock('@/glossa/plugins/pdfAutoContents', async (original) => {
  const actual = await original<typeof import('@/glossa/plugins/pdfAutoContents')>();
  return {
    ...actual,
    prepareContents: async (...args: Parameters<typeof actual.prepareContents>) => {
      const outcome = await actual.prepareContents(...args);
      diagnostics.outcome = outcome;
      return outcome;
    },
  };
});
let source = '';
let file: File;
const host = {
  resolveNativeBookFilePath: async () => source,
  loadBookContent: async () => ({ file }),
};
let documentBook: BookDoc | undefined;
let view: FoliateView | undefined;
let sandbox = '';
let cacheSandbox = '';
afterEach(async () => {
  cleanup();
  view?.close();
  view?.remove();
  await documentBook?.destroy?.();
  view = undefined;
  documentBook = undefined;
  useBookDataStore.setState({ booksData: {} });
  useReaderStore.setState({
    getViewsById: useReaderStore.getInitialState().getViewsById,
    getView: useReaderStore.getInitialState().getView,
  });
  if (sandbox) await remove(sandbox, { recursive: true });
  if (cacheSandbox) await remove(cacheSandbox, { recursive: true });
  sandbox = '';
  cacheSandbox = '';
});

it('cancels real OCR from the panel, explicitly retries, saves and reopens native navigation', async () => {
  expect(supportsLocalPDF()).toBe(true);
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-ocr-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  // A trailing PDF comment keeps the original printed fixture unchanged while
  // giving this invocation its own fingerprint and genuinely cold sidecars.
  const id = crypto.randomUUID();
  file = new File([bytes, `\n% isolated original fixture ${id}\n`], 'original.pdf', {
    type: 'application/pdf',
  });
  const before = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  sandbox = await join(await appLocalDataDir(), 'Readest', `pdf-contents-${id}`);
  source = `${sandbox}/original.pdf`;
  await mkdir(sandbox, { recursive: true });
  await writeFile(source, new Uint8Array(await file.arrayBuffer()));
  const initial = await openPDFCache(source, true);
  expect(initial).not.toBeNull();
  expect(initial!.pages).toEqual([]);
  expect(initial!.outline).toBeNull();
  const bookID = initial!.id;
  documentBook = (await new DocumentLoader(file).open()).book;
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:500px;height:600px';
  document.body.append(view);
  await view.open(documentBook);
  const renderer = view.renderer;
  const reading = { hash: bookID, format: 'PDF', title: 'Original OCR fixture' } as Book;
  useSettingsStore.setState({ settings: {} as SystemSettings });
  useBookDataStore.setState({
    booksData: {
      [bookID]: {
        id: bookID,
        book: reading,
        bookDoc: documentBook,
        file,
        config: null,
        isFixedLayout: true,
      },
    },
  });
  useReaderStore.setState({ getViewsById: () => [view!] });
  const panel = render(
    <PDFContentsPanel book={reading} bookDoc={documentBook} bookKey={`${bookID}-0`} />,
  );
  const generate = await screen.findByRole('button', { name: 'Generate contents' });
  await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
  expect((await getPDFOCRStatus(initial!.id))?.state).not.toBe('running');
  await userEvent.click(generate);
  await expect
    .poll(async () => (await getPDFOCRStatus(initial!.id))?.state, { timeout: 15000 })
    .toBe('running');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByText('Generation stopped. Saved progress is available for retry.');
  await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false), {
    timeout: 10000,
  });
  await expect.poll(async () => (await getPDFOCRStatus(initial!.id))?.state).not.toBe('running');
  expect((await openPDFCache(source))?.outline).toBeNull();
  expect(view.renderer).toBe(renderer);
  diagnostics.outcome = undefined;
  await userEvent.click(generate);
  await expect.poll(() => diagnostics.outcome, { timeout: 90000 }).toBeDefined();
  expect(diagnostics.outcome, JSON.stringify(diagnostics.outcome)).toMatchObject({
    result: 'generated',
    report: { state: 'completed' },
  });
  await screen.findByText('Contents are ready.', {}, { timeout: 90000 });
  const saved = await openPDFCache(source);
  expect(saved?.outline?.map((entry) => entry.pageIndex)).toEqual([1, 2]);
  expect(saved?.generator).toBe('glossa-contents-3');
  expect(view.renderer).toBe(renderer);
  expect(documentBook.toc?.map((entry) => entry.label)).toEqual(
    saved?.outline?.map((entry) => entry.title),
  );
  panel.unmount();
  view.close();
  view.remove();
  await documentBook.destroy?.();
  const persisted = await readFile(source);
  file = new File([persisted], 'original.pdf', { type: 'application/pdf' });
  documentBook = (await new DocumentLoader(file, { nativeFilePath: source }).open()).book;
  expect(documentBook.toc?.map((entry) => entry.label)).toEqual(
    saved?.outline?.map((entry) => entry.title),
  );
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:500px;height:600px';
  document.body.append(view);
  await view.open(documentBook);
  for (const entry of documentBook.toc ?? []) {
    await view.goTo(entry.href);
    expect(view.lastLocation?.tocItem?.label).toBe(entry.label);
  }
  expect(await crypto.subtle.digest('SHA-256', persisted)).toEqual(before);
}, 120000);

it('persists part ownership through real native save and reopen, with folding and every destination clickable', async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-part-toc-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  const id = crypto.randomUUID();
  file = new File([bytes, `\n% isolated part fixture ${id}\n`], 'original.pdf', {
    type: 'application/pdf',
  });
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  sandbox = await join(await appLocalDataDir(), 'Readest', `pdf-parts-${id}`);
  source = `${sandbox}/original.pdf`;
  await mkdir(sandbox, { recursive: true });
  await writeFile(source, new Uint8Array(await file.arrayBuffer()));
  documentBook = (await new DocumentLoader(file, { nativeFilePath: source }).open()).book;
  expect(await preparePDFContents(source, documentBook)).toBe('generated');
  const saved = await openPDFCache(source);
  expect(saved?.outline).toEqual([
    { title: 'Preface', pageIndex: 3, level: 0 },
    { title: 'Part I Hills', pageIndex: 4, level: 0 },
    { title: 'Copper observations', pageIndex: 5, level: 1 },
    { title: 'Amber experiments', pageIndex: 7, level: 1 },
    { title: 'Part II Cities', pageIndex: 9, level: 0 },
    { title: 'Silver results', pageIndex: 10, level: 1 },
    { title: 'Afterword', pageIndex: 13, level: 0 },
    { title: 'Appendix 1: Materials', pageIndex: 14, level: 0 },
  ]);
  await documentBook.destroy?.();
  const persisted = await readFile(source);
  file = new File([persisted], 'original.pdf', { type: 'application/pdf' });
  documentBook = (await new DocumentLoader(file, { nativeFilePath: source }).open()).book;
  expect(documentBook.toc?.[1]?.subitems?.map((item) => item.label)).toEqual([
    'Copper observations',
    'Amber experiments',
  ]);
  expect(documentBook.toc?.[2]?.subitems?.map((item) => item.label)).toEqual(['Silver results']);
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:500px;height:600px;margin-left:330px';
  document.body.append(view);
  await view.open(documentBook);
  useReaderStore.setState({ getView: () => view ?? null });
  render(
    <aside style={{ position: 'absolute', left: 0, top: 0, width: 320, height: 650 }}>
      <TOCView bookKey={`parts-${id}-0`} toc={documentBook.toc!} />
    </aside>,
  );
  expect(screen.queryByText('Copper observations')).toBeNull();
  await userEvent.click(await screen.findByRole('button', { name: 'Expand Part I Hills' }));
  await screen.findByText('Amber experiments');
  await userEvent.click(screen.getByRole('button', { name: 'Collapse Part I Hills' }));
  await waitFor(() => expect(screen.queryByText('Copper observations')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Expand Part I Hills' }));
  await userEvent.click(screen.getByRole('button', { name: 'Expand Part II Cities' }));
  const flatten = (items: NonNullable<BookDoc['toc']>): NonNullable<BookDoc['toc']> =>
    items.flatMap((item) => [item, ...flatten(item.subitems ?? [])]);
  for (const [index, entry] of flatten(documentBook.toc!).entries()) {
    await userEvent.click(await screen.findByText(entry.label));
    await expect.poll(() => view?.lastLocation?.tocItem?.label).toBe(entry.label);
    await expect
      .poll(
        () =>
          view?.renderer
            .getContents()
            .find((content) => content.index === saved!.outline![index]!.pageIndex)
            ?.doc.querySelector('.textLayer')?.textContent,
      )
      .toContain(entry.label);
  }
  expect(await crypto.subtle.digest('SHA-256', persisted)).toEqual(digest);
}, 60000);

it('preserves small parents through real Rust JSON IPC and rejects an incomplete native regeneration', async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-part-toc-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  const id = crypto.randomUUID();
  file = new File([bytes, `\n% isolated IPC fixture ${id}\n`], 'original.pdf', {
    type: 'application/pdf',
  });
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const root = await appLocalDataDir();
  sandbox = await join(root, 'Readest', `pdf-ipc-${id}`);
  source = `${sandbox}/original.pdf`;
  await mkdir(sandbox, { recursive: true });
  await writeFile(source, new Uint8Array(await file.arrayBuffer()));
  const cache = await openPDFCache(source, true);
  expect(cache).toBeTruthy();
  cacheSandbox = await join(root, 'pdf-local-v1', cache!.id);
  const row = (text: string, y: number, height = 0.025, x = 0.15) => ({
    text,
    x,
    y,
    height,
    width: 0.7,
    endLine: true,
  });
  const scans: OCRPage[] = [
    {
      index: 0,
      native: false,
      lines: [
        row('Contents', 0.04, 0.04),
        row('Preface .... 4', 0.15),
        row('Part I Hills', 0.3, 0.012),
        row('Copper observations .... 6', 0.45),
      ],
    },
    {
      index: 1,
      native: false,
      lines: [
        row('Amber experiments .... 8', 0.10999999999999999),
        row('Part II Cities', 0.3, 0.0197),
        row('Silver results .... 11', 0.45),
        row('Afterword .... 14', 0.65),
        row('Appendix 1: Materials .... 15', 0.8),
      ],
    },
  ];
  const persistScan = async (scan: OCRPage) => {
    for (const version of ['vision-pdf-1', 'vision-contents-1']) {
      const directory = await join(cacheSandbox, version);
      await mkdir(directory, { recursive: true });
      await writeFile(
        `${directory}/page-${scan.index}.json`,
        new TextEncoder().encode(JSON.stringify(scan)),
      );
    }
  };
  for (const scan of scans) await persistScan(scan);
  const transmitted = await readOCRPage(cache!.id, 1);
  expect(transmitted).toBeTruthy();
  expect(OCRContentsLines(transmitted!, true)).toContain('Part II Cities');
  documentBook = (await new DocumentLoader(file, { nativeFilePath: source }).open()).book;
  expect(await preparePDFContents(source, documentBook)).toBe('generated');
  const saved = await openPDFCache(source);
  expect(saved!.outline?.map((entry) => [entry.title, entry.level])).toEqual([
    ['Preface', 0],
    ['Part I Hills', 0],
    ['Copper observations', 1],
    ['Amber experiments', 1],
    ['Part II Cities', 0],
    ['Silver results', 1],
    ['Afterword', 0],
    ['Appendix 1: Materials', 0],
  ]);
  scans[1]!.lines[1]!.text = 'Part III Cities';
  await persistScan(scans[1]!);
  const reports: PDFContentsReport[] = [];
  expect(
    await preparePDFContents(source, documentBook, undefined, (r) => reports.push(r), {
      regenerate: true,
    }),
  ).toBe('unavailable');
  expect(reports.at(-1)?.code).toBe('pdf_contents_structure_incomplete');
  const retained = await openPDFCache(source);
  expect(retained!.outline).toEqual(saved!.outline);
  expect(retained!.revision).toBe(saved!.revision);
  expect(await crypto.subtle.digest('SHA-256', await readFile(source))).toEqual(digest);
}, 60000);
