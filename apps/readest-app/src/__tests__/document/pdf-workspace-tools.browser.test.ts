import { afterEach, expect, it } from 'vitest';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { PDFRegionText, selectPDFRegion } from '@/services/pdfWorkspace';
import 'foliate-js/view.js';

let book: BookDoc | undefined;
let view: FoliateView | undefined;
afterEach(async () => {
  view?.close();
  view?.remove();
  await book?.destroy?.();
  document.body.replaceChildren();
});
it('renders bounded thumbnails and crops without changing reading position, and resolves exact annotation geometry', async () => {
  const bytes = await fetch('/src/__tests__/fixtures/data/glossa-reading-sample.pdf').then((r) =>
    r.arrayBuffer(),
  );
  book = (await new DocumentLoader(new File([bytes], 'original.pdf')).open()).book;
  view = document.createElement('foliate-view') as FoliateView;
  view.style.cssText = 'display:block;width:600px;height:500px';
  document.body.append(view);
  await view.open(book);
  view.renderer.setAttribute('spread', 'none');
  view.renderer.setAttribute('zoom', 'fit-width');
  await view.goTo(1);
  await expect
    .poll(
      () =>
        view!.renderer
          .getContents()
          .find((c) => c.index === 1)
          ?.doc.querySelector('.textLayer')?.textContent,
    )
    .toContain('Copper marker');
  const origin = view.lastLocation?.cfi;
  const blob = await book.getPDFImage!(2, 180);
  const bitmap = await createImageBitmap(blob);
  expect(bitmap.width).toBe(180);
  bitmap.close();
  const cropped = await createImageBitmap(
    await book.getPDFImage!(1, 300, { x: 0.1, y: 0.1, width: 0.5, height: 0.2 }),
  );
  expect(cropped.width).toBe(300);
  expect(cropped.height).toBeGreaterThan(0);
  cropped.close();
  expect(view.lastLocation?.cfi).toBe(origin);
  const doc = view.renderer.getContents().find((c) => c.index === 1)!.doc;
  const span = [...doc.querySelectorAll('.textLayer span')].find((s) =>
    s.textContent?.startsWith('Copper marker'),
  )!;
  const range = doc.createRange();
  range.setStart(span.firstChild!, 0);
  range.setEnd(span.firstChild!, span.textContent!.length);
  const rect = range.getBoundingClientRect();
  const layer = doc.querySelector('.textLayer')!.getBoundingClientRect();
  const expected = {
    x: rect.x / layer.width,
    y: rect.y / layer.height,
    width: rect.width / layer.width,
    height: rect.height / layer.height,
  };
  expect(PDFRegionText(doc, expected)).toContain('Copper marker');
  const location = await book.getPDFAnnotationRects!(view.getCFI(1, range));
  expect(location.index).toBe(1);
  expect(location.rects.length).toBeGreaterThan(0);
  expect(Math.abs(location.rects[0]!.x - expected.x)).toBeLessThan(0.005);
  expect(Math.abs(location.rects[0]!.y - expected.y)).toBeLessThan(0.005);
  expect(view.lastLocation?.cfi).toBe(origin);
});
it('selects a column by character positions and disposes area overlays on Escape', () => {
  const host = document.createElement('div');
  host.innerHTML =
    '<div class="textLayer" style="position:relative;width:600px;height:300px"><span style="position:absolute;left:10px;top:20px">Left column evidence</span><span style="position:absolute;left:350px;top:20px">Right column distraction</span><span style="position:absolute;left:10px;top:60px">Second left row</span></div>';
  document.body.append(host);
  expect(PDFRegionText(document, { x: 0, y: 0, width: 0.5, height: 1 })).toBe(
    'Left column evidence\nSecond left row',
  );
  let cancelled = false;
  const dispose = selectPDFRegion(
    { getContents: () => [{ doc: document, index: 0 }] } as unknown as FoliateView['renderer'],
    () => {},
    () => {
      cancelled = true;
    },
  );
  expect(document.querySelector('[aria-label="Select PDF area"]')).toBeTruthy();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(cancelled).toBe(true);
  expect(document.querySelector('[aria-label="Select PDF area"]')).toBeNull();
  dispose();
});
