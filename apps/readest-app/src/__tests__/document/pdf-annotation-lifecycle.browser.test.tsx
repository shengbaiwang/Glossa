import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import 'foliate-js/view.js';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import { wrappedFoliateView, type FoliateView } from '@/types/view';
import type { BookConfig, BookNote, ViewSettings } from '@/types/book';
import { DEFAULT_READSETTINGS } from '@/services/constants';
import { parseOCRPage } from '@/services/pdfEnhancement';
import recognized from '@/__tests__/fixtures/data/glossa-ocr-pages.json';
import Annotator from '@/app/reader/components/annotator/Annotator';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';

type PDFView = FoliateView & {
  getPDFSelection(): { index: number; range: Range }[] | null;
  history: FoliateView['history'] & { pushState(target: number): void };
};
let view: PDFView;
let book: BookDoc;
let showAnnotator: (visible: boolean) => void;
const config: BookConfig = { updatedAt: 0, booknotes: [] };
const viewSettings = {
  scrolled: true,
  defaultFontSize: 16,
  lineHeight: 1.5,
  annotationToolbarItems: ['copy', 'highlight', 'annotate'],
  enableAnnotationQuickActions: false,
} as ViewSettings;
const dataState = {
  getBookData: () => ({ book: { format: 'PDF' }, isFixedLayout: true, bookDoc: book }),
  getConfig: () => config,
  setConfig: vi.fn(),
  saveConfig: vi.fn(async () => {}),
  updateBooknotes: vi.fn((_key: string, notes: BookNote[]) => {
    config.booknotes = notes;
    return config;
  }),
};
const readerState = {
  getView: () => view,
  getViewsById: () => [view],
  getViewSettings: () => viewSettings,
  getProgress: () => ({ page: 1 }),
};
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false, isAndroidApp: false } }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select?: (state: typeof dataState) => unknown) =>
    select ? select(dataState) : dataState,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select?: (state: typeof readerState) => unknown) =>
    select ? select(readerState) : readerState,
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: DEFAULT_READSETTINGS, globalViewSettings: {} },
  }),
}));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ isDarkMode: false }) }));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => undefined,
  getBookProgress: () => ({ page: 1 }),
}));
vi.mock('@/app/reader/hooks/useNotesSync', () => ({ useNotesSync: () => {} }));

afterEach(async () => {
  cleanup();
  view?.close();
  view?.remove();
  await book?.destroy?.();
  config.booknotes = [];
  vi.clearAllMocks();
});

async function open(ocr = true) {
  await page.viewport(1000, 1100);
  const bytes = await fetch(
    `/src/__tests__/fixtures/data/glossa-${ocr ? 'ocr' : 'reading'}-sample.pdf`,
  ).then((r) => r.arrayBuffer());
  book = (
    await new DocumentLoader(new File([bytes], 'original.pdf'), {
      pdfOCR: ocr ? async (index) => parseOCRPage(recognized[index], index) : undefined,
    }).open()
  ).book;
  view = wrappedFoliateView(document.createElement('foliate-view') as FoliateView) as PDFView;
  view.style.cssText = 'display:block;width:600px;height:1000px';
  document.body.append(view);
  await view.open(book);
  const attachView = (element: HTMLDivElement | null) => {
    if (element) element.append(view);
  };
  const readingPane = (visible: boolean) => (
    <div id='gridcell-original' style={{ width: 600, height: 1000, position: 'relative' }}>
      <div ref={attachView} />
      {visible && (
        <Annotator bookKey='original' contentInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />
      )}
    </div>
  );
  const mounted = render(readingPane(true));
  showAnnotator = (visible) => mounted.rerender(readingPane(visible));
  view.renderer.setAttribute('spread', 'none');
  view.renderer.setAttribute('zoom', 'original-size');
  view.renderer.setAttribute('scale-factor', '40');
  view.renderer.setAttribute('flow', 'scrolled');
  await view.goTo(0);
  await expect
    .poll(
      () =>
        view.renderer
          .getContents()
          .filter(
            (c) =>
              (c.index ?? -1) < 2 &&
              c.doc.querySelector('.textLayer span') &&
              c.overlayer &&
              getComputedStyle(c.doc.defaultView!.frameElement!).pointerEvents === 'auto',
          ).length,
    )
    .toBe(2);
  return [0, 1].map((index) => view.renderer.getContents().find((c) => c.index === index)!.doc);
}

function words(doc: Document) {
  const root = doc.querySelector('[data-pdf-ocr-text]') ?? doc.querySelector('.textLayer')!;
  return [...root.querySelectorAll<HTMLElement>('span')].filter(
    (s) => s.firstChild?.nodeType === 3 && s.textContent?.trim(),
  );
}
function point(span: HTMLElement, end: boolean) {
  const range = span.ownerDocument.createRange();
  range.selectNodeContents(span);
  const box = range.getBoundingClientRect();
  const frame = span.ownerDocument.defaultView!.frameElement!.getBoundingClientRect();
  return {
    x: frame.left + (end ? box.right - 0.1 : box.left + 0.1),
    y: frame.top + box.top + box.height / 2,
  };
}
const popup = () => document.querySelector('.selection-popup');
const hasPopup = () => expect.poll(() => !!popup()).toBe(true);
const noPopup = () => expect.poll(() => !!popup()).toBe(false);

it('reconnects selection tools to already-loaded pages after the annotator remounts', async () => {
  const [a] = await open();
  showAnnotator(false);
  showAnnotator(true);
  const word = words(a!)[2]!;
  await commands.dragPDFText(point(word, false), point(word, true));
  expect(a!.getSelection()?.toString().trim()).toBe(word.textContent!.trim());
  await hasPopup();
  await commands.pressPDFSelectionKey('Escape');
  await noPopup();
});

it.each([
  true,
  false,
])('removes the actual toolbar when a cross-page selection is cleared (OCR: %s)', async (ocr) => {
  const [a, b] = await open(ocr);
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  await hasPopup();
  expect(view.getPDFSelection()?.length).toBe(2);
  if (ocr)
    await page.screenshot({
      path: '/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-selection-toolbar-active.png',
    });
  view.deselect();
  await noPopup();
  if (ocr)
    await page.screenshot({
      path: '/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-selection-toolbar-cleared.png',
    });
});

it.each([
  'jump',
  'next',
  'previous',
  'fraction',
  'history',
  'search',
  'zoom',
  'layout',
  'resize',
  'escape',
] as const)('clears ordinary single-page text and its toolbar on %s', async (action) => {
  const [a, b] = await open();
  const word = words(a!)[2]!;
  await commands.dragPDFText(point(word, false), point(word, true));
  await hasPopup();
  expect(a!.getSelection()?.toString().trim()).toBe(word.textContent!.trim());
  switch (action) {
    case 'jump':
      await view.goTo(1);
      break;
    case 'next':
      await view.next();
      break;
    case 'previous':
      await view.prev();
      break;
    case 'fraction':
      await view.goToFraction(0.5);
      break;
    case 'history':
      view.history.pushState(1);
      view.history.back();
      break;
    case 'search': {
      const range = b!.createRange();
      range.selectNodeContents(words(b!)[0]!);
      await view.select(view.getCFI(1, range));
      break;
    }
    case 'zoom':
      view.renderer.setAttribute('scale-factor', '45');
      break;
    case 'layout':
      view.renderer.setAttribute('flow', 'paginated');
      break;
    case 'resize':
      view.style.width = '550px';
      break;
    case 'escape':
      await commands.pressPDFSelectionKey('Escape');
      break;
  }
  await noPopup();
  expect(a!.getSelection()?.toString() ?? '').toBe('');
});

it('releases a detached page document without throwing during selection cleanup', async () => {
  const [a, b] = await open();
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  await hasPopup();
  // React can detach the reading pane before the reader's close effect runs.
  view.remove();
  expect(() => view.deselect()).not.toThrow();
  await noPopup();
});

it('keeps a fresh selection open after quick consecutive dismissals', async () => {
  const [a, b] = await open();
  const drag = () =>
    commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  await drag();
  await hasPopup();
  await commands.pressPDFSelectionKey('Escape');
  await noPopup();
  await drag();
  await hasPopup();
  await commands.pressPDFSelectionKey('Escape');
  await noPopup();
  await drag();
  await hasPopup();
  await new Promise((done) => setTimeout(done, 650));
  expect(popup()).not.toBeNull();
});

it('opens a saved annotation without requiring a native DOM selection', async () => {
  const [a] = await open();
  const range = a!.createRange();
  range.selectNodeContents(words(a!)[2]!);
  const cfi = view.getCFI(0, range);
  config.booknotes = [
    {
      id: 'saved',
      type: 'annotation',
      cfi,
      text: range.toString(),
      style: 'highlight',
      color: 'yellow',
      page: 1,
      note: '',
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  view.dispatchEvent(
    new CustomEvent('show-annotation', { detail: { value: cfi, index: 0, range } }),
  );
  await waitFor(() => expect(popup()).not.toBeNull());
  expect(a!.getSelection()?.toString() ?? '').toBe('');
});

it('creates a cross-page highlight with the actual toolbar and restores it after reopening', async () => {
  const [a, b] = await open();
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  await hasPopup();
  const text = view
    .getPDFSelection()!
    .map((fragment) => fragment.range.toString())
    .join('\n');
  await userEvent.click(screen.getByRole('button', { name: 'Highlight' }));
  await waitFor(() => expect(config.booknotes).toHaveLength(1));
  const saved = structuredClone(config.booknotes![0]!);
  expect(saved.pdfRanges).toHaveLength(2);
  expect(saved.text).toBe(text);
  expect(dataState.saveConfig).toHaveBeenCalled();
  const painted = () =>
    view.renderer.getContents().filter((content) => {
      const element = (content.overlayer as { element: SVGElement }).element;
      return (content.index ?? -1) < 2 && !!element.querySelector('g[fill] path');
    }).length;
  await expect.poll(painted).toBe(2);
  view.deselect();
  await noPopup();
  cleanup();
  view.close();
  view.remove();
  await book.destroy?.();
  await open();
  await expect.poll(painted).toBe(2);
  expect(config.booknotes).toEqual([saved]);
  for (const [index, cfi] of saved.pdfRanges!.entries()) {
    const doc = view.renderer.getContents().find((content) => content.index === index)!.doc;
    const range = view.resolveCFI(cfi)!.anchor(doc) as Range;
    expect(range.toString().trim()).toBe(text.split('\n')[index]!.trim());
  }
  await noPopup();
});

async function savedCrossPage() {
  const [a, b] = await open();
  await commands.dragPDFText(point(words(a!).at(-1)!, false), point(words(b!)[0]!, true));
  await hasPopup();
  await userEvent.click(screen.getByRole('button', { name: 'Highlight' }));
  await waitFor(() => expect(config.booknotes).toHaveLength(1));
  const saved = config.booknotes![0]!;
  saved.note = 'Personal note to retain';
  view.deselect();
  await noPopup();
  const range = view.resolveCFI(saved.pdfRanges![1]!)!.anchor(b!) as Range;
  view.dispatchEvent(
    new CustomEvent('show-annotation', { detail: { value: saved.cfi, index: 1, range } }),
  );
  await hasPopup();
  return { a: a!, b: b!, saved: structuredClone(saved) };
}

it.each([
  'start',
  'end',
] as const)('adjusts a saved cross-page %s endpoint without losing the note or other page', async (side) => {
  const { a, b, saved } = await savedCrossPage();
  const handle = await screen.findByRole('button', { name: `Adjust selection ${side}` });
  const box = handle.getBoundingClientRect();
  const target = side === 'start' ? words(a).at(-2)! : words(b)[1]!;
  await commands.dragPDFText(
    { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    point(target, side === 'end'),
  );
  await expect.poll(() => config.booknotes![0]!.updatedAt).not.toBe(saved.updatedAt);
  const edited = config.booknotes![0]!;
  expect(edited.id).toBe(saved.id);
  expect(edited.note).toBe(saved.note);
  expect(edited.pdfRanges).toHaveLength(2);
  expect(edited.pdfRanges![side === 'start' ? 1 : 0]).toBe(
    saved.pdfRanges![side === 'start' ? 1 : 0],
  );
  expect(edited.text).toContain(target.textContent!.trim());
  view.deselect();
  await noPopup();
  cleanup();
  view.close();
  view.remove();
  await book.destroy?.();
  await open();
  for (const cfi of edited.pdfRanges!) {
    const resolved = view.resolveCFI(cfi)!;
    const doc = view.renderer.getContents().find((c) => c.index === resolved.index)!.doc;
    expect((resolved.anchor(doc) as Range).toString()).not.toBe('');
  }
});

it('shrinks a saved cross-page highlight into one page with the end handle', async () => {
  const { a, saved } = await savedCrossPage();
  const handle = await screen.findByRole('button', { name: 'Adjust selection end' });
  const box = handle.getBoundingClientRect();
  await commands.dragPDFText(
    { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    point(words(a).at(-1)!, true),
  );
  await expect.poll(() => config.booknotes![0]!.pdfRanges).toBeUndefined();
  expect(config.booknotes![0]!.id).toBe(saved.id);
  expect(config.booknotes![0]!.note).toBe(saved.note);
  expect(config.booknotes![0]!.text!.trim()).toBe(words(a).at(-1)!.textContent!.trim());
});

it('adjusts a saved PDF endpoint by one character with the keyboard', async () => {
  const { saved } = await savedCrossPage();
  const handle = await screen.findByRole('button', { name: 'Adjust selection end' });
  handle.focus();
  await commands.pressPDFSelectionKey('ArrowLeft');
  await expect.poll(() => config.booknotes![0]!.text).toBe(saved.text!.slice(0, -1));
  const nextHandle = await screen.findByRole('button', { name: 'Adjust selection end' });
  nextHandle.focus();
  await commands.pressPDFSelectionKey('ArrowLeft');
  await expect.poll(() => config.booknotes![0]!.text).toBe(saved.text!.slice(0, -2));
  expect(config.booknotes![0]!.note).toBe(saved.note);
});

it.each([
  false,
  true,
])('moves a cross-page endpoint with touch and safely handles cancellation (%s)', async (cancel) => {
  const { a, saved } = await savedCrossPage();
  const handle = await screen.findByRole('button', { name: 'Adjust selection end' });
  const box = handle.getBoundingClientRect();
  await commands.dragPDFHandle(
    { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    point(words(a).at(-1)!, true),
    cancel,
  );
  if (cancel) {
    await noPopup();
    expect(config.booknotes).toEqual([saved]);
  } else {
    await expect.poll(() => config.booknotes![0]!.pdfRanges).toBeUndefined();
    expect(config.booknotes![0]!.note).toBe(saved.note);
  }
});

it('keeps every saved fragment when endpoint persistence fails', async () => {
  const { a, saved } = await savedCrossPage();
  dataState.saveConfig.mockRejectedValueOnce(new Error('Disk unavailable'));
  const handle = await screen.findByRole('button', { name: 'Adjust selection end' });
  const box = handle.getBoundingClientRect();
  await commands.dragPDFText(
    { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    point(words(a).at(-1)!, true),
  );
  await noPopup();
  expect(config.booknotes).toEqual([saved]);
  expect(
    view.renderer
      .getContents()
      .filter(
        (content) =>
          (content.index ?? -1) < 2 &&
          (content.overlayer as { element: SVGElement }).element.querySelector('g[fill] path'),
      ).length,
  ).toBe(2);
});

it('keeps the primary endpoint drag when a second finger touches and releases the same handle', async () => {
  const { a, saved } = await savedCrossPage();
  const handle = await screen.findByRole('button', { name: 'Adjust selection end' });
  const box = handle.getBoundingClientRect();
  await commands.dragPDFHandle(
    { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    point(words(a).at(-1)!, true),
    false,
    true,
  );
  await expect.poll(() => config.booknotes![0]!.pdfRanges).toBeUndefined();
  expect(config.booknotes![0]!.note).toBe(saved.note);
  expect(config.booknotes![0]!.text).toBe(saved.text!.split('\n')[0]);
});

it('extends a saved endpoint by touch into the second visible page of a spread', async () => {
  const { saved } = await savedCrossPage();
  view.deselect();
  await noPopup();
  view.renderer.setAttribute('flow', 'paginated');
  await expect
    .poll(() => view.renderer.getContents().some((c) => c.doc.querySelector('.textLayer span')))
    .toBe(true);
  view.renderer.setAttribute('spread', 'both');
  await expect
    .poll(() => view.renderer.getContents().some((c) => c.doc.querySelector('.textLayer span')))
    .toBe(true);
  await view.goTo(1);
  const b = view.renderer.getContents().find((c) => c.index === 1)!.doc;
  const c = view.renderer.getContents().find((c) => c.index === 2)!.doc;
  const range = view.resolveCFI(saved.pdfRanges![1]!)!.anchor(b) as Range;
  view.dispatchEvent(
    new CustomEvent('show-annotation', { detail: { value: saved.cfi, index: 1, range } }),
  );
  const handle = await screen.findByRole('button', { name: 'Adjust selection end' });
  const box = handle.getBoundingClientRect();
  await commands.dragPDFHandle(
    { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    point(words(c)[0]!, true),
  );
  await expect.poll(() => config.booknotes![0]!.pdfRanges?.length).toBe(3);
  expect(config.booknotes![0]!.note).toBe(saved.note);
  expect(config.booknotes![0]!.pdfRanges![0]).toBe(saved.pdfRanges![0]);
});
