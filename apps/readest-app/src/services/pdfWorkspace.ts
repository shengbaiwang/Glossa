import type { Renderer } from '@/types/view';
import type { BookDoc } from '@/libs/document';
import { MAX_ZOOM_LEVEL } from './constants';
import { getPDFNoteRanges } from './pdfNoteRanges';

export type PDFRegion = { x: number; y: number; width: number; height: number };

/** Reserve reader chrome even while it fades/slides away; fitting must not jump on hover. */
export function PDFReadingViewport(renderer: HTMLElement, root: Element | null): PDFRegion {
  const host = renderer.getBoundingClientRect();
  let top = host.top,
    bottom = host.bottom;
  const header = root?.querySelector('.glossa-reader-header')?.getBoundingClientRect();
  if (header?.height && header.right > host.left && header.left < host.right)
    top = Math.max(top, header.bottom);
  const footer = root?.querySelector('.glossa-reader-footer');
  const footerBox = footer?.getBoundingClientRect();
  if (footer && footerBox?.height && footerBox.right > host.left && footerBox.left < host.right) {
    const style = getComputedStyle(footer);
    // Its transformed rectangle includes the hide animation. Use its actual
    // height and layout bottom so an invisible bar reserves the same band.
    const parentBottom =
      style.position === 'fixed' ? window.innerHeight : root!.getBoundingClientRect().bottom;
    bottom = Math.min(bottom, parentBottom - (parseFloat(style.bottom) || 0) - footerBox.height);
  }
  return {
    x: 0,
    y: (top - host.top) / host.height,
    width: 1,
    height: Math.max(0, bottom - top) / host.height,
  };
}

/** Conservative visible-ink bounds; never infer a text column or discard an illustration. */
export function PDFContentBounds({
  data,
  width,
  height,
}: Pick<ImageData, 'data' | 'width' | 'height'>): PDFRegion | null {
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3]! / 255;
      if (
        Math.min(data[offset]!, data[offset + 1]!, data[offset + 2]!) * alpha + 255 * (1 - alpha) >=
        250
      )
        continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return null;
  const margin = Math.max(2, Math.ceil(Math.min(width, height) * 0.02));
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(width, right + margin + 1);
  bottom = Math.min(height, bottom + margin + 1);
  return {
    x: left / width,
    y: top / height,
    width: (right - left) / width,
    height: (bottom - top) / height,
  };
}

/** One explicitly requested page, independent of OCR, themes, text nodes and old CFI. */
export async function preparePDFContentFit(
  book: BookDoc,
  renderer: Renderer,
  signal: AbortSignal,
  root: Element | null = null,
) {
  const index = renderer.index;
  const doc = renderer.getContents().find((content) => content.index === index)?.doc;
  const iframe = doc?.defaultView?.frameElement;
  const originalScale = renderer.scale;
  if (index === undefined || !iframe || !originalScale || !book.getPDFImage)
    throw new Error('pdf_content_unavailable');
  const frame = iframe.getBoundingClientRect();
  const host = renderer.getBoundingClientRect();
  const viewport = PDFReadingViewport(renderer, root);
  if (host.width <= 32 || host.height * viewport.height <= 32)
    throw new Error('pdf_content_unavailable');
  const scrollTop = renderer.scrollTop,
    scrollLeft = renderer.scrollLeft;
  const zoom = renderer.getAttribute('zoom'),
    factor = renderer.getAttribute('scale-factor');
  const check = () => {
    const current = renderer.getBoundingClientRect();
    const currentViewport = PDFReadingViewport(renderer, root);
    if (
      signal.aborted ||
      renderer.index !== index ||
      !iframe.isConnected ||
      renderer.getContents().find((content) => content.index === index)?.doc !== doc ||
      renderer.scrollTop !== scrollTop ||
      renderer.scrollLeft !== scrollLeft ||
      renderer.getAttribute('zoom') !== zoom ||
      renderer.getAttribute('scale-factor') !== factor ||
      current.width !== host.width ||
      current.height !== host.height ||
      currentViewport.y !== viewport.y ||
      currentViewport.height !== viewport.height
    )
      throw new DOMException('Cancelled', 'AbortError');
  };
  check();
  // Longest preview edge <= 768px; do not scan full-resolution reader canvases.
  const width = Math.max(1, Math.floor(768 * Math.min(1, frame.width / frame.height)));
  const blob = await book.getPDFImage(index, width);
  check();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  try {
    check();
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('pdf_content_unavailable');
    context.drawImage(bitmap, 0, 0);
    const region = PDFContentBounds(context.getImageData(0, 0, canvas.width, canvas.height));
    check();
    if (!region) return null;
    const scale = Math.min(
      (host.width - 32) / ((frame.width / originalScale) * region.width),
      (host.height * viewport.height - 32) / ((frame.height / originalScale) * region.height),
    );
    return {
      index,
      region,
      viewport,
      level: Math.max(1, Math.min(MAX_ZOOM_LEVEL, Math.floor(scale * 100))),
    };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

/** Character geometry keeps a column selection out of adjacent columns. */
export function PDFRegionText(doc: Document, region: PDFRegion): string {
  const layer = doc.querySelector('.textLayer');
  if (!layer) return '';
  const page = layer.getBoundingClientRect();
  const left = page.left + page.width * region.x;
  const top = page.top + page.height * region.y;
  const right = left + page.width * region.width;
  const bottom = top + page.height * region.height;
  const walker = doc.createTreeWalker(
    doc.querySelector('[data-pdf-ocr-text]') ?? layer,
    NodeFilter.SHOW_TEXT,
  );
  const selected: { text: string; x: number; y: number; h: number }[] = [];
  let node: Node | null;
  let count = 0;
  while ((node = walker.nextNode())) {
    const range = doc.createRange();
    const parentBox = node.parentElement?.getBoundingClientRect();
    if (
      !parentBox ||
      parentBox.right < left ||
      parentBox.left > right ||
      parentBox.bottom < top ||
      parentBox.top > bottom
    )
      continue;
    const value = node.textContent ?? '';
    for (let i = 0; i < value.length && count < 100000; i++, count++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const box = range.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (box.height && x >= left && x <= right && y >= top && y <= bottom)
        selected.push({ text: value[i]!, x: box.left, y, h: box.height });
    }
  }
  // Group characters by baseline before horizontal sorting, independent of DOM column order.
  const rows: (typeof selected)[] = [];
  for (const char of selected.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - char.y) < Math.min(row[0]!.h, char.h) * 0.4) row.push(char);
    else rows.push([char]);
  }
  return rows
    .map((row) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((c) => c.text)
        .join('')
        .trim(),
    )
    .join('\n');
}

export function selectPDFRegion(
  renderer: Renderer,
  complete: (index: number, region: PDFRegion, text: string) => void,
  cancel: () => void,
): () => void {
  const attached = new Map<Document, () => void>();
  const stop = () => {
    clearInterval(timer);
    document.removeEventListener('keydown', cancelOnEscape);
    attached.forEach((dispose) => dispose());
    attached.clear();
  };
  const cancelOnEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      stop();
      cancel();
    }
  };
  const bind = () => {
    const contents = renderer.getContents();
    for (const [doc, dispose] of attached) {
      if (!contents.some((c) => c.doc === doc)) {
        dispose();
        attached.delete(doc);
      }
    }
    for (const { doc, index } of contents) {
      const layer = doc.querySelector('.textLayer');
      if (attached.has(doc) || !layer || index === undefined) continue;
      const mask = doc.createElement('div');
      mask.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none;user-select:none';
      mask.setAttribute('aria-label', 'Select PDF area');
      const box = doc.createElement('div');
      box.style.cssText =
        'position:fixed;border:1px solid #3468ad;background:#3468ad22;pointer-events:none;display:none';
      mask.append(box);
      doc.body.append(mask);
      let start: { x: number; y: number } | null = null;
      const point = (e: PointerEvent) => {
        const rect = layer.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
        };
      };
      const region = (end: { x: number; y: number }): PDFRegion => ({
        x: Math.min(start!.x, end.x),
        y: Math.min(start!.y, end.y),
        width: Math.abs(end.x - start!.x),
        height: Math.abs(end.y - start!.y),
      });
      mask.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        start = point(e);
        mask.setPointerCapture(e.pointerId);
      };
      mask.onpointermove = (e) => {
        if (!start) return;
        const r = region(point(e));
        const p = layer.getBoundingClientRect();
        Object.assign(box.style, {
          display: 'block',
          left: `${p.left + r.x * p.width}px`,
          top: `${p.top + r.y * p.height}px`,
          width: `${r.width * p.width}px`,
          height: `${r.height * p.height}px`,
        });
      };
      mask.onpointerup = (e) => {
        if (!start) return;
        e.preventDefault();
        e.stopPropagation();
        const r = region(point(e));
        start = null;
        if (r.width < 0.003 || r.height < 0.003) {
          box.style.display = 'none';
          return;
        }
        const text = PDFRegionText(doc, r);
        stop();
        complete(index, r, text);
      };
      mask.onpointercancel = () => {
        start = null;
        box.style.display = 'none';
      };
      doc.addEventListener('keydown', cancelOnEscape);
      attached.set(doc, () => {
        mask.remove();
        doc.removeEventListener('keydown', cancelOnEscape);
      });
    }
  };
  const timer = setInterval(bind, 200);
  document.addEventListener('keydown', cancelOnEscape);
  bind();
  return stop;
}

/** Resolve every live annotation against the same text-layer/CFI protocol used for reading. */
export async function preparePDFAnnotations(
  book: import('@/libs/document').BookDoc,
  notes: import('@/types/book').BookNote[],
  signal: AbortSignal,
) {
  const records = notes.filter(
    (n) => n.type === 'annotation' && !n.deletedAt && (n.style || n.note),
  );
  if (records.length > 2000) throw new Error('pdf_annotation_limit');
  const started = Date.now();
  const result = [];
  for (const note of records) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (Date.now() - started > 60000) throw new Error('pdf_processing_limit');
    for (const cfi of getPDFNoteRanges(note)) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (Date.now() - started > 60000 || result.length >= 2000)
        throw new Error('pdf_processing_limit');
      const location = await book.getPDFAnnotationRects!(cfi);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      result.push({
        ...location,
        text: note.note ?? '',
        style: note.style ?? 'text',
        color: note.color ?? 'yellow',
      });
    }
  }
  return result;
}

export async function copyPDFImage(blob: Blob): Promise<void> {
  const { isTauriAppPlatform } = await import('./environment');
  if (isTauriAppPlatform()) {
    const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeImage(await blob.arrayBuffer());
  } else {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }
}
