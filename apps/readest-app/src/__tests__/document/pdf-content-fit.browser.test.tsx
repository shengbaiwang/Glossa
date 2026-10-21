import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import 'foliate-js/view.js';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import type { ViewSettings } from '@/types/book';
import { parseOCRPage } from '@/services/pdfEnhancement';
import recognized from '@/__tests__/fixtures/data/glossa-ocr-pages.json';
import PDFScaleControls from '@/app/reader/components/footerbar/PDFScaleControls';
import useShortcuts from '@/hooks/useShortcuts';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';

let view: FoliateView;
let book: BookDoc;
let settings: ViewSettings;
let readerRoot: HTMLElement | undefined;
const save = vi.fn(async (..._args: unknown[]) => {});
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: (...args: unknown[]) => save(...args) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ book: { format: 'PDF' }, bookDoc: book }) }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => view,
    getViewSettings: () => settings,
    setViewSettings: (_key: string, next: ViewSettings) => {
      settings = next;
    },
  }),
}));
afterEach(async () => {
  cleanup();
  view?.close();
  view?.remove();
  readerRoot?.remove();
  readerRoot = undefined;
  await book?.destroy?.();
  vi.restoreAllMocks();
  save.mockClear();
});

function Controls() {
  useShortcuts({ onGoRight: () => void view.next() });
  return <PDFScaleControls bookKey='original' />;
}

async function open(ocr = false, scrolled = true, bars?: { hidden: boolean }) {
  await page.viewport(1000, 900);
  const bytes = ocr
    ? await fetch('/src/__tests__/fixtures/data/glossa-ocr-sample.pdf').then((r) => r.arrayBuffer())
    : originalPDF();
  book = (
    await new DocumentLoader(new File([bytes], 'original.pdf'), {
      pdfOCR: ocr ? async (index) => parseOCRPage(recognized[index], index) : undefined,
    }).open()
  ).book;
  settings = { zoomMode: 'fit-page', zoomLevel: 100 } as ViewSettings;
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:700px;height:700px';
  if (bars) {
    readerRoot = document.createElement('div');
    readerRoot.id = 'gridcell-original';
    readerRoot.style.cssText = 'position:relative;width:700px;height:700px';
    document.body.append(readerRoot);
  }
  (readerRoot ?? document.body).append(view);
  await view.open(book);
  view.renderer.setAttribute('spread', 'none');
  view.renderer.setAttribute('zoom', 'fit-page');
  if (scrolled) view.renderer.setAttribute('flow', 'scrolled');
  await view.goTo(0);
  await expect
    .poll(
      () =>
        !!view.renderer
          .getContents()
          .find((c) => c.index === 0)
          ?.doc.querySelector('.textLayer span'),
    )
    .toBe(true);
  const controls = (
    <div
      className='glossa-reader-chrome'
      style={{
        width: 700,
        padding: 8,
        background: 'var(--glossa-surface)',
        color: 'var(--glossa-ink)',
      }}
    >
      <Controls />
    </div>
  );
  if (bars) {
    const container = document.createElement('div');
    readerRoot!.append(container);
    render(
      <>
        <div
          className='glossa-reader-header'
          style={{
            position: 'absolute',
            inset: '0 0 auto',
            height: 180,
            opacity: bars.hidden ? 0 : 1,
            pointerEvents: 'none',
          }}
        />
        <div
          className='glossa-reader-footer'
          style={{
            position: 'absolute',
            bottom: 12,
            width: 700,
            height: 240,
            background: 'white',
            transform: `translateY(${bars.hidden ? '100%' : '0'})`,
            opacity: bars.hidden ? 0 : 1,
          }}
        >
          {controls}
        </div>
      </>,
      { container },
    );
  } else render(controls);
}

// Original native pages with large margins, a vector illustration and a faint
// footnote. No source/OCR text is invented to stand in for the rendered PDF.
function originalPDF() {
  const ink =
    'q 0.2 0.4 0.6 rg 400 800 35 80 re f Q\nBT /F1 18 Tf 150 1000 Td (Original content sample) Tj 0 -40 Td (Keep every visible mark.) Tj /F1 10 Tf 0 -150 Td 0.8 g (Faint footnote stays visible.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    ...[0, 1, 2].flatMap((i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 1400] /Resources << /Font << /F1 9 0 R >> >> /Contents ${4 + i * 2} 0 R >>`,
      `<< /Length ${ink.length} >>\nstream\n${ink}\nendstream`,
    ]),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

async function fitContent() {
  await page.getByRole('button', { name: /^Zoom \d+%$/ }).click();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Fit Content' }));
}

it('opens the zoom menu with Space without turning the PDF page', async () => {
  await open();
  const next = vi.spyOn(view, 'next');
  screen.getByRole('button', { name: /^Zoom \d+%$/ }).focus();
  await userEvent.keyboard(' ');
  expect(screen.getByRole('menuitem', { name: 'Fit Content' })).toBeTruthy();
  expect(next).not.toHaveBeenCalled();
  expect(view.renderer.index).toBe(0);
  await expect
    .poll(() => document.activeElement)
    .toBe(screen.getByRole('menuitem', { name: 'Fit Page' }));
  await userEvent.keyboard('{ArrowDown}');
  await expect
    .poll(() => document.activeElement)
    .toBe(screen.getByRole('menuitem', { name: 'Fit Width' }));
  await userEvent.keyboard('{ArrowDown}');
  await expect
    .poll(() => document.activeElement)
    .toBe(screen.getByRole('menuitem', { name: 'Fit Content' }));
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => save.mock.calls.length).toBe(2);
  expect(view.renderer.index).toBe(0);
  expect(screen.queryByRole('menuitem', { name: 'Fit Content' })).toBeNull();
});

for (const hidden of [false, true]) {
  for (const scrolled of [false, true]) {
    it(`fits every content line between the reader bars without changing when they hide (${hidden}/${scrolled})`, async () => {
      await open(false, scrolled, { hidden });
      const doc = view.renderer.getContents().find((c) => c.index === 0)!.doc;
      // Open through the actual keyboard so an auto-hidden bar needs no synthetic click.
      screen.getByRole('button', { name: /^Zoom \d+%$/ }).focus();
      await userEvent.keyboard(' ');
      await userEvent.click(screen.getByRole('menuitem', { name: 'Fit Content' }));
      await expect.poll(() => save.mock.calls.length).toBe(2);
      await expect
        .poll(() => getComputedStyle(doc.defaultView!.frameElement!).pointerEvents)
        .toBe('auto');
      // Settings persistence can finish before the async PDF layout. The old
      // frame is already interactive, so wait for the actual reading geometry.
      await expect
        .poll(() => {
          const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
          const root = readerRoot!.getBoundingClientRect();
          const lines = [...doc.querySelectorAll<HTMLElement>('.textLayer span')].filter((span) =>
            span.textContent?.trim(),
          );
          return (
            lines.length >= 3 &&
            lines.every((line) => {
              const box = line.getBoundingClientRect();
              return (
                frame.top + box.top >= root.top + 180 + 16 &&
                frame.top + box.bottom <= root.bottom - 12 - 240 - 16
              );
            })
          );
        })
        .toBe(true);
      const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
      const root = readerRoot!.getBoundingClientRect();
      const lines = [...doc.querySelectorAll<HTMLElement>('.textLayer span')].filter((span) =>
        span.textContent?.trim(),
      );
      expect(lines.length).toBeGreaterThanOrEqual(3);
      for (const line of lines) {
        const box = line.getBoundingClientRect();
        expect(frame.top + box.top).toBeGreaterThanOrEqual(root.top + 180 + 16);
        expect(frame.top + box.bottom).toBeLessThanOrEqual(root.bottom - 12 - 240 - 16);
      }
      expect(view.renderer.index).toBe(0);
    });
  }
}

it('discards pending analysis when a reader bar changes the available area', async () => {
  await open(false, true, { hidden: false });
  const image = await book.getPDFImage!(0, 300);
  let finish!: (blob: Blob) => void;
  vi.spyOn(book, 'getPDFImage').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await fitContent();
  readerRoot!.querySelector<HTMLElement>('.glossa-reader-header')!.style.height = '200px';
  finish(image);
  await expect
    .poll(() => screen.getByRole('group', { name: 'Zoom' }).getAttribute('aria-busy'))
    .toBe('false');
  expect(save).not.toHaveBeenCalled();
  expect(view.renderer.getAttribute('zoom')).toBe('fit-page');
});

for (const ocr of [false, true]) {
  for (const scrolled of [false, true]) {
    it(`enlarges the current content without changing its CFI or mouse selection (${ocr}/${scrolled})`, async () => {
      await open(ocr, scrolled);
      const doc = view.renderer.getContents().find((c) => c.index === 0)!.doc;
      const root = doc.querySelector('[data-pdf-ocr-text]') ?? doc.querySelector('.textLayer')!;
      const spans = [...root.querySelectorAll<HTMLElement>('span')];
      const word = spans.find(
        (span) => span.firstChild?.nodeType === 3 && span.textContent!.trim().length > 5,
      )!;
      const range = doc.createRange();
      range.setStart(word.firstChild!, 0);
      range.setEnd(word.firstChild!, word.textContent!.length);
      const cfi = view.getCFI(0, range),
        text = range.toString();
      const initialScale = view.renderer.scale!;
      const initialFrame = doc.defaultView!.frameElement!.getBoundingClientRect();
      await fitContent();
      await expect.poll(() => view.renderer.scale!).toBeGreaterThan(initialScale * 1.02);
      await expect.poll(() => save.mock.calls.length).toBe(2);
      expect(view.renderer.index).toBe(0);
      await expect
        .poll(() => doc.querySelector('#canvas canvas')?.getBoundingClientRect().width)
        .toBeCloseTo(doc.defaultView!.frameElement!.getBoundingClientRect().width, 1);
      await expect
        .poll(() => getComputedStyle(doc.defaultView!.frameElement!).pointerEvents)
        .toBe('auto');
      await expect.poll(() => view.resolveCFI(cfi).anchor(doc).toString()).toBe(text);
      const restored = view.resolveCFI(cfi).anchor(doc);
      expect(restored.toString()).toBe(text);
      const box = restored.getBoundingClientRect();
      const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
      const host = view.renderer.getBoundingClientRect();
      expect(frame.left + box.left).toBeGreaterThanOrEqual(host.left);
      expect(frame.width).toBeCloseTo(
        (initialFrame.width / initialScale) * view.renderer.scale!,
        1,
      );
      expect(frame.top + box.top).toBeGreaterThanOrEqual(host.top);
      expect(frame.top + box.bottom).toBeLessThanOrEqual(host.bottom);
      if (ocr && scrolled)
        await page.screenshot({
          path: '/Users/nidao./Documents/ChatGPT/Glossa/.glossa-dev/qa/pdf-fit-content-scan.png',
        });
      await commands.dragPDFText(
        { x: frame.left + box.left + 1, y: frame.top + box.top + box.height / 2 },
        { x: frame.left + box.right - 1, y: frame.top + box.top + box.height / 2 },
      );
      await expect.poll(() => doc.getSelection()?.toString().trim()).toBe(text.trim());
      await userEvent.click(screen.getByRole('button', { name: 'Fit Page' }));
      await expect.poll(() => view.renderer.scale).toBeCloseTo(initialScale, 2);
      await expect.poll(() => view.resolveCFI(cfi).anchor(doc).toString()).toBe(text);
    });
  }
}

it('does not apply a late analysis after the reader navigates elsewhere', async () => {
  await open();
  const image = await book.getPDFImage!(0, 300);
  let finish!: (blob: Blob) => void;
  vi.spyOn(book, 'getPDFImage').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await fitContent();
  await view.goTo(2);
  finish(image);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(view.renderer.index).toBe(2);
  expect(view.renderer.getAttribute('zoom')).toBe('fit-page');
  expect(save).not.toHaveBeenCalled();
});

for (const action of ['zoom', 'scroll', 'resize', 'unmount']) {
  it(`discards analysis when ${action} supersedes the request`, async () => {
    await open();
    const image = await book.getPDFImage!(0, 300);
    let finish!: (blob: Blob) => void;
    vi.spyOn(book, 'getPDFImage').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await fitContent();
    if (action === 'zoom') await userEvent.click(screen.getByRole('button', { name: 'Fit Width' }));
    if (action === 'scroll') view.renderer.scrollTop += 50;
    if (action === 'resize') view.style.width = '500px';
    if (action === 'unmount') cleanup();
    const before = save.mock.calls.length;
    finish(image);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(save.mock.calls.length).toBe(before);
    expect(view.renderer.getAttribute('zoom')).toBe(action === 'zoom' ? 'fit-width' : 'fit-page');
  });
}

it('keeps the current view on a blank page and on analysis failure, with retry in the existing control', async () => {
  await open();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 100;
  canvas.getContext('2d')!.fillStyle = 'white';
  canvas.getContext('2d')!.fillRect(0, 0, 100, 100);
  const blank = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)));
  const image = vi.spyOn(book, 'getPDFImage').mockResolvedValueOnce(blank);
  await fitContent();
  await expect.poll(() => screen.getByRole('status').textContent).toContain('No content to fit.');
  expect(save).not.toHaveBeenCalled();
  image.mockRejectedValueOnce(new Error('render_failed'));
  await fitContent();
  await expect
    .poll(() => screen.getByRole('alert').textContent)
    .toContain('Could not fit page content.');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await expect.poll(() => save.mock.calls.length).toBe(2);
  expect(screen.queryByRole('alert')).toBeNull();
});
