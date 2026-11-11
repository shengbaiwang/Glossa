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

async function fitPage() {
  await userEvent.click(screen.getByRole('button', { name: 'Fit Page' }));
}

it('opens the two-action zoom menu with Space without turning the PDF page', async () => {
  await open();
  const next = vi.spyOn(view, 'next');
  screen.getByRole('button', { name: /^Zoom [\d.]+%$/ }).focus();
  await userEvent.keyboard(' ');
  expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  expect(screen.queryByRole('menuitem', { name: 'Fit Content' })).toBeNull();
  expect(next).not.toHaveBeenCalled();
  await expect
    .poll(() => document.activeElement)
    .toBe(screen.getByRole('menuitem', { name: 'Fit Page' }));
  await userEvent.keyboard('{ArrowDown}');
  await expect
    .poll(() => document.activeElement)
    .toBe(screen.getByRole('menuitem', { name: 'Fit Width' }));
  await userEvent.keyboard('{ArrowUp}{Enter}');
  await expect.poll(() => save.mock.calls.length).toBe(2);
  expect(view.renderer.index).toBe(0);
});

for (const hidden of [false, true]) {
  for (const scrolled of [false, true]) {
    it(`fits the entire page between stable reader bars (${hidden}/${scrolled})`, async () => {
      await open(false, scrolled, { hidden });
      const doc = view.renderer.getContents().find((c) => c.index === 0)!.doc;
      screen.getByRole('button', { name: /^Zoom [\d.]+%$/ }).focus();
      await userEvent.keyboard(' ');
      await userEvent.click(screen.getByRole('menuitem', { name: 'Fit Page' }));
      await expect
        .poll(() => {
          const frame = doc.defaultView!.frameElement!.getBoundingClientRect();
          const root = readerRoot!.getBoundingClientRect();
          return frame.top >= root.top + 180 + 15 && frame.bottom <= root.bottom - 12 - 240 - 15;
        })
        .toBe(true);
      expect(view.renderer.index).toBe(0);
    });
  }
}

for (const ocr of [false, true]) {
  for (const scrolled of [false, true]) {
    it(`fits the whole page without image analysis or changing CFI and selection (${ocr}/${scrolled})`, async () => {
      await open(ocr, scrolled);
      const doc = view.renderer.getContents().find((c) => c.index === 0)!.doc;
      const word = [...doc.querySelectorAll<HTMLElement>('.textLayer span')].find(
        (span) => span.firstChild?.nodeType === 3 && span.textContent!.trim().length > 5,
      )!;
      const range = doc.createRange();
      range.setStart(word.firstChild!, 0);
      range.setEnd(word.firstChild!, word.textContent!.length);
      const cfi = view.getCFI(0, range),
        text = range.toString();
      const image = vi.spyOn(book, 'getPDFImage');
      view.renderer.setZoom?.('original-size', 137);
      await fitPage();
      await expect.poll(() => save.mock.calls.length).toBe(2);
      const frameElement = doc.defaultView!.frameElement!;
      await expect.poll(() => frameElement.getBoundingClientRect().height).toBeLessThanOrEqual(700);
      const frame = frameElement.getBoundingClientRect(),
        host = view.renderer.getBoundingClientRect();
      expect(frame.left).toBeGreaterThanOrEqual(host.left - 1);
      expect(frame.right).toBeLessThanOrEqual(host.right + 1);
      expect(frame.top).toBeGreaterThanOrEqual(host.top - 1);
      expect(frame.bottom).toBeLessThanOrEqual(host.bottom + 1);
      expect(image).not.toHaveBeenCalled();
      await expect.poll(() => view.resolveCFI(cfi).anchor(doc).toString()).toBe(text);
      await expect.poll(() => getComputedStyle(frameElement).pointerEvents).toBe('auto');
      const box = view.resolveCFI(cfi).anchor(doc).getBoundingClientRect();
      await commands.dragPDFText(
        { x: frame.left + box.left + 1, y: frame.top + box.top + box.height / 2 },
        { x: frame.left + box.right - 1, y: frame.top + box.top + box.height / 2 },
      );
      await expect.poll(() => doc.getSelection()?.toString().trim()).toBe(text.trim());
      expect(view.renderer.index).toBe(0);
    });
  }
}
