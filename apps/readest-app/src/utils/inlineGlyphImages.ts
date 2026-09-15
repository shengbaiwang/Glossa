// Keep the original image/DOM intact: EPUB CFIs and the image viewer still use
// the original resource. Only small, opaque, monochrome images amid text qualify.
const GLYPH_CLASS = 'glossa-inline-glyph';
const FILTER_ID = 'glossa-inline-glyph-ink';
const scheduled = new WeakMap<HTMLImageElement, string>();

export const inlineGlyphColorStyles = `
  img.${GLYPH_CLASS} {
    filter: var(--glossa-inline-glyph-filter) !important;
    mix-blend-mode: normal !important;
    background: transparent !important;
  }
`;

/** Conservative white-paper/black-ink check, including JPEG edge noise. */
export function isMonochromeGlyph(data: Uint8ClampedArray, width: number, height: number) {
  if (width < 4 || height < 4 || width > 128 || height > 128) return false;
  if (data.length !== width * height * 4) return false;
  let paper = 0;
  let ink = 0;
  let edgePaper = 0;
  let edges = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (data[i + 3]! < 250 || Math.max(r, g, b) - Math.min(r, g, b) > 16) return false;
      const light = (r + g + b) / 3;
      if (light >= 235) paper++;
      if (light <= 80) ink++;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        edges++;
        if (light >= 220) edgePaper++;
      }
    }
  }
  const count = width * height;
  return (
    paper / count >= 0.4 && ink / count >= 0.03 && ink / count <= 0.55 && edgePaper / edges >= 0.6
  );
}

function hasAdjacentText(img: HTMLImageElement) {
  if (img.closest('a, figure, [role="img"], [aria-hidden="true"]')) return false;
  // A single inline wrapper is common; never search an entire section for text.
  let parent = img.parentElement;
  if (
    parent &&
    /^(SPAN|FONT|I|B|EM|STRONG)$/i.test(parent.tagName) &&
    !parent.textContent?.trim()
  ) {
    parent = parent.parentElement;
  }
  if (!parent || !/^(P|DIV|SPAN|FONT|I|B|EM|STRONG)$/i.test(parent.tagName)) return false;
  return Array.from(parent.childNodes).some((node) => {
    if (node.nodeType === 3) return !!node.textContent?.trim();
    return (
      node.nodeType === 1 &&
      /^(SPAN|FONT|I|B|EM|STRONG)$/i.test((node as Element).tagName) &&
      !!node.textContent?.trim()
    );
  });
}

function installInkFilter(doc: Document) {
  if (doc.getElementById(FILTER_ID)) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText =
    'position: absolute; width: 0; height: 0; overflow: hidden; pointer-events: none;';
  const filter = doc.createElementNS(ns, 'filter');
  filter.id = FILTER_ID;
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const alpha = doc.createElementNS(ns, 'feColorMatrix');
  // Alpha = original alpha minus luminance. White becomes transparent; the
  // original antialiasing becomes ink coverage, without OCR or glyph guessing.
  alpha.setAttribute('type', 'matrix');
  alpha.setAttribute('values', '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.2126 -0.7152 -0.0722 1 0');
  alpha.setAttribute('result', 'ink');
  const flood = doc.createElementNS(ns, 'feFlood');
  flood.style.setProperty('flood-color', 'var(--theme-fg-color, currentColor)');
  flood.setAttribute('result', 'color');
  const composite = doc.createElementNS(ns, 'feComposite');
  composite.setAttribute('in', 'color');
  composite.setAttribute('in2', 'ink');
  composite.setAttribute('operator', 'in');
  filter.append(alpha, flood, composite);
  svg.append(filter);
  // Append outside and after the body: preserve all existing CFI indices and
  // text offsets. A filter inside display:none <head> can lose flood styling.
  doc.documentElement.append(svg);
}

export function adaptInlineGlyphImages(doc: Document) {
  const win = doc.defaultView;
  if (!win) return;
  const frame = win.frameElement;
  for (const img of doc.querySelectorAll('img')) {
    if (!hasAdjacentText(img)) continue;
    const source = img.currentSrc || img.src;
    if (!source || scheduled.get(img) === source) continue;
    scheduled.set(img, source);
    const inspect = () => {
      if (
        !img.isConnected ||
        (frame && !frame.isConnected) ||
        (img.currentSrc || img.src) !== source
      )
        return;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w < 4 || h < 4 || w > 128 || h > 128 || w / h < 0.25 || w / h > 2) return;
      const style = win.getComputedStyle(img);
      const fontSize = parseFloat(style.fontSize);
      const rect = img.getBoundingClientRect();
      if (
        !fontSize ||
        !rect.width ||
        !rect.height ||
        rect.width > 2 * fontSize ||
        rect.height > 2 * fontSize
      )
        return;
      if (
        style.display === 'block' ||
        style.float !== 'none' ||
        style.position === 'absolute' ||
        style.position === 'fixed'
      )
        return;
      try {
        const canvas = doc.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(img, 0, 0);
        if (!isMonochromeGlyph(context.getImageData(0, 0, w, h).data, w, h)) return;
        installInkFilter(doc);
        // A bare fragment follows <base href>, which can point outside an EPUB
        // iframe. Bind the filter to this document, never to the book's base URL.
        img.style.setProperty(
          '--glossa-inline-glyph-filter',
          `url(${JSON.stringify(`${doc.URL.split('#')[0]}#${FILTER_ID}`)})`,
        );
        img.classList.add(GLYPH_CLASS);
      } catch {
        // Unreadable/tainted images retain their original rendering. No fetch,
        // resource rewrite, book content logging, or persistent cache is needed.
      }
    };
    // Separate tasks allow the first page to paint; never await pixel analysis.
    const schedule = () => win.setTimeout(inspect, 0);
    if (img.complete) schedule();
    else img.addEventListener('load', schedule, { once: true });
  }
}
