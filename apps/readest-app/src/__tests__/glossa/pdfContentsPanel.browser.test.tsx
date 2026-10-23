import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { PDFCache, PDFOutlineEntry } from '@/services/pdfEnhancement';
import type { Book } from '@/types/book';
import type { FoliateView } from '@/types/view';
import type { SystemSettings } from '@/types/settings';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import OfficialModulePanel from '@/glossa/modules/OfficialModulePanel';
import 'foliate-js/view.js';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const f = vi.hoisted(() => ({
  cache: { id: 'c'.repeat(32), pages: [], revision: 0, outline: null } as PDFCache,
  file: null as File | null,
  saves: 0,
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: host }) }));
vi.mock('@/services/pdfEnhancement', async (original) => ({
  ...(await original<typeof import('@/services/pdfEnhancement')>()),
  supportsLocalPDF: () => true,
  openPDFCache: async () => structuredClone(f.cache),
  readOCRPage: async () => null,
  startPDFOCR: async () => {
    throw new Error('Original native-text fixture requires no OCR');
  },
  savePDFOutline: async (
    _source: string,
    cache: PDFCache,
    outline: PDFOutlineEntry[] | null,
    _count: number,
    generator?: string,
  ) => {
    if (cache.revision !== f.cache.revision) throw new Error('outline_changed');
    f.saves++;
    f.cache = { ...f.cache, outline, generator, revision: cache.revision + 1 };
    return structuredClone(f.cache);
  },
}));
const host = {
  resolveNativeBookFilePath: async () => '/original.pdf',
  loadBookContent: async () => ({ file: f.file }),
};
const book = { hash: 'pdfpluginfixture', format: 'PDF', title: 'Original PDF' } as Book;
let bookDoc: BookDoc;
let readingView: FoliateView;
beforeEach(async () => {
  f.cache = { id: 'c'.repeat(32), pages: [], revision: 0, outline: null };
  f.saves = 0;
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-auto-toc-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  f.file = new File([bytes], 'original.pdf', { type: 'application/pdf' });
  bookDoc = (await new DocumentLoader(f.file).open()).book;
  readingView = document.createElement('foliate-view') as FoliateView;
  readingView.style.cssText = 'display:block;width:500px;height:600px';
  document.body.append(readingView);
  await readingView.open(bookDoc);
  await readingView.goTo(4);
  useSettingsStore.setState({ settings: {} as SystemSettings });
  useBookDataStore.setState({
    booksData: {
      pdfpluginfixture: {
        id: 'pdfpluginfixture',
        book,
        bookDoc,
        file: f.file,
        config: null,
        isFixedLayout: true,
      },
    },
  });
  useReaderStore.setState({ getViewsById: () => [readingView] });
});
afterEach(async () => {
  cleanup();
  readingView?.close();
  readingView?.remove();
  await bookDoc?.destroy?.();
  useBookDataStore.setState({ booksData: {} });
  useReaderStore.setState({ getViewsById: useReaderStore.getInitialState().getViewsById });
  for (const attr of ['data-theme', 'dir', 'data-eink'])
    document.documentElement.removeAttribute(attr);
});
it('generates from a real click, updates live chapter navigation, regenerates and restores without reopening the reader', async () => {
  await page.viewport(980, 720);
  const renderer = readingView.renderer;
  const location = readingView.lastLocation?.cfi;
  const panel = render(
    <aside className='bg-base-200 text-base-content w-80' style={{ height: 430 }}>
      <OfficialModulePanel
        moduleId='pdfAutoContents'
        book={book}
        bookDoc={bookDoc}
        bookKey='pdfpluginfixture-0'
      />
    </aside>,
  );
  const generate = await screen.findByRole('button', { name: 'Generate contents' });
  await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
  expect(f.saves).toBe(0);
  await userEvent.click(generate);
  await screen.findByText('Contents are ready.');
  expect(f.cache.outline?.map((entry) => entry.pageIndex)).toEqual([4, 8, 12]);
  expect(bookDoc.toc?.map((entry) => entry.label)).toEqual([
    'Chapter 1 Copper',
    'Chapter 2 Amber',
    'Chapter 3 Silver',
  ]);
  expect(readingView.renderer).toBe(renderer);
  expect(readingView.lastLocation?.cfi).toBe(location);
  for (const entry of bookDoc.toc!) {
    await readingView.goTo(entry.href);
    expect(readingView.lastLocation?.tocItem?.label).toBe(entry.label);
  }
  const cancelled = new AbortController();
  cancelled.abort();
  const tocBefore = bookDoc.toc;
  await readingView.updateTOC!(
    [{ id: 0, label: 'Cancelled update', index: 4, href: bookDoc.toc![0]!.href }],
    cancelled.signal,
  );
  expect(bookDoc.toc).toBe(tocBefore);
  expect(readingView.lastLocation?.tocItem?.label).toBe('Chapter 3 Silver');
  await userEvent.click(screen.getByRole('button', { name: 'Regenerate contents' }));
  await screen.findByRole('button', { name: 'Restore previous contents' });
  await userEvent.click(screen.getByRole('button', { name: 'Restore previous contents' }));
  await screen.findByText('Previous contents restored.');
  expect(f.saves).toBe(3);
  expect(readingView.renderer).toBe(renderer);
  panel.unmount();
  const reopened = (await new DocumentLoader(f.file!, { nativeFilePath: '/original.pdf' }).open())
    .book;
  expect(reopened.toc?.map((entry) => entry.label)).toEqual(
    bookDoc.toc?.map((entry) => entry.label),
  );
  await reopened.destroy?.();
}, 30000);

it.each([
  { theme: 'default-light', width: 760, dir: 'ltr', eink: false },
  { theme: 'default-dark', width: 390, dir: 'rtl', eink: false },
  { theme: 'default-light', width: 390, dir: 'ltr', eink: true },
])('keeps generation controls usable in $theme / $width / $dir / $eink', async (fixture) => {
  readingView.style.display = 'none';
  await page.viewport(fixture.width, 600);
  document.documentElement.setAttribute('data-theme', fixture.theme);
  document.documentElement.dir = fixture.dir;
  document.documentElement.setAttribute('data-eink', String(fixture.eink));
  render(
    <aside
      className='bg-base-200 text-base-content'
      style={{ width: 'min(100vw, 360px)', height: 400 }}
    >
      <OfficialModulePanel
        moduleId='pdfAutoContents'
        book={book}
        bookDoc={bookDoc}
        bookKey='pdfpluginfixture-0'
      />
    </aside>,
  );
  const generate = await screen.findByRole('button', { name: 'Generate contents' });
  await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
  generate.focus();
  await userEvent.keyboard('{Enter}');
  await screen.findByText('Contents are ready.');
  expect(generate.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await page.screenshot({
    path: `../../../../../.glossa-dev/qa/pdf-plugin-${fixture.theme}-${fixture.dir}-${fixture.eink}.png`,
  });
}, 20000);
