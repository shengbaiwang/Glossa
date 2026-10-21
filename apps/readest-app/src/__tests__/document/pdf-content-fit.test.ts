import { expect, it, vi } from 'vitest';
import { PDFContentBounds, PDFReadingViewport } from '@/services/pdfWorkspace';

function pixels(width = 100, height = 120) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const mark = (x: number, y: number, color = [0, 0, 0, 255]) => {
    data.set(color, (y * width + x) * 4);
  };
  return { data, width, height, mark };
}

it('fits visible ink with a safety margin, including images outside the text area', () => {
  const image = pixels();
  image.mark(20, 40);
  image.mark(79, 99);
  image.mark(90, 20, [240, 80, 80, 255]);
  expect(PDFContentBounds(image)).toEqual({ x: 0.18, y: 0.15, width: 0.75, height: 84 / 120 });
});

it('keeps faint marks and content at the edge rather than guessing the main text column', () => {
  const image = pixels();
  image.mark(0, 0, [249, 249, 249, 255]);
  image.mark(99, 119);
  expect(PDFContentBounds(image)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
});

it('leaves non-white paper conservative and reports a genuinely blank page', () => {
  const blank = pixels();
  expect(PDFContentBounds(blank)).toBeNull();
  for (let i = 0; i < blank.data.length; i += 4) blank.data.set([245, 245, 235, 255], i);
  expect(PDFContentBounds(blank)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
});

it('composites transparent pixels over white before looking for visible marks', () => {
  const image = pixels();
  image.mark(0, 0, [0, 0, 0, 0]);
  expect(PDFContentBounds(image)).toBeNull();
});

it('reserves the actual header and footer bands even when the footer is hidden by translation', () => {
  const root = document.createElement('div');
  root.innerHTML =
    '<div class="glossa-reader-header"></div><div class="glossa-reader-footer" style="position:absolute;bottom:12px;transform:translateY(100%);opacity:0"></div>';
  const renderer = document.createElement('div');
  root.append(renderer);
  const bounds = (x: number, y: number, width: number, height: number) =>
    new DOMRect(x, y, width, height);
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(bounds(200, 50, 700, 800));
  vi.spyOn(renderer, 'getBoundingClientRect').mockReturnValue(bounds(200, 50, 700, 800));
  vi.spyOn(root.firstElementChild!, 'getBoundingClientRect').mockReturnValue(
    bounds(200, 70, 700, 44),
  );
  vi.spyOn(root.children[1]!, 'getBoundingClientRect').mockReturnValue(bounds(200, 838, 700, 52));
  expect(PDFReadingViewport(renderer, root)).toEqual({ x: 0, y: 0.08, width: 1, height: 0.84 });
});
