import DOMPurify, { type Config } from 'dompurify';

export const sanitizeString = (str?: string) => {
  if (!str) return str;
  return str.replace(/\u0000/g, '');
};

/**
 * Strip untrusted HTML (Send-to-Readest email/web/DOCX conversion, OPDS feed
 * descriptions, etc.) down to safe, EPUB-appropriate structural markup. Removes
 * scripts, event handlers, styles, iframes, and form controls; keeps headings,
 * text, lists, tables, links and images.
 *
 * Runs against the real DOM, so callers must be on the client (browser or Tauri
 * webview), both of which provide `window`/`DOMParser`.
 */
const HTML_OPTIONS: Config = {
  ALLOWED_TAGS: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'br',
    'hr',
    'blockquote',
    'pre',
    'code',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'del',
    'ins',
    'sup',
    'sub',
    'span',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
    'img',
    'figure',
    'figcaption',
    // Markdown footnote definitions arrive wrapped in <section class="footnotes">
    // (see utils/mdFootnotes.ts), which must survive to be found and re-emitted.
    'section',
  ],
  // `id` is allowed so heading anchors survive — the EPUB's nested
  // navMap uses `chapter1.xhtml#heading-id` to link the TOC sidebar to
  // each section. Without it readers see one entry per chapter only.
  // `class` is allowed so Markdown code fences keep their `language-*`
  // class for theming (see utils/md.ts).
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'id', 'class'],
  // Drop anything that would load or run remote code.
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
  FORBID_ATTR: ['srcset'],
  ALLOW_DATA_ATTR: false,
};

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, HTML_OPTIONS);
}

/** Web articles need scientific and note structure in addition to the generic
 * file converter's subset. SVG is restricted to inert geometry, never links,
 * external paints, embedded HTML, animation or resource-loading elements. */
export function sanitizeArticleHtml(html: string): string {
  const purify = DOMPurify(window);
  purify.addHook('uponSanitizeAttribute', (node, event) => {
    if (node.namespaceURI !== 'http://www.w3.org/2000/svg') return;
    if (
      ['href', 'xlink:href', 'src'].includes(event.attrName) ||
      /url\s*\(/i.test(event.attrValue)
    ) {
      event.keepAttr = false;
    }
  });
  return purify.sanitize(html, {
    ...HTML_OPTIONS,
    ALLOWED_TAGS: [
      ...(HTML_OPTIONS.ALLOWED_TAGS ?? []),
      'div',
      'article',
      'aside',
      'caption',
      'tfoot',
      'colgroup',
      'col',
      'math',
      'mrow',
      'mi',
      'mn',
      'mo',
      'mtext',
      'mspace',
      'ms',
      'mfrac',
      'msqrt',
      'mroot',
      'msup',
      'msub',
      'msubsup',
      'munder',
      'mover',
      'munderover',
      'mtable',
      'mtr',
      'mtd',
      'menclose',
      'mpadded',
      'mphantom',
      'mmultiscripts',
      'mprescripts',
      'none',
      'semantics',
      'annotation',
      'svg',
      'g',
      'path',
      'rect',
      'circle',
      'ellipse',
      'line',
      'polyline',
      'polygon',
      'text',
      'tspan',
      'title',
      'desc',
    ],
    ALLOWED_ATTR: [
      ...(HTML_OPTIONS.ALLOWED_ATTR ?? []),
      'role',
      'scope',
      'headers',
      'start',
      'value',
      'type',
      'lang',
      'dir',
      'xmlns',
      'display',
      'mathvariant',
      'mathsize',
      'mathcolor',
      'stretchy',
      'fence',
      'separator',
      'accent',
      'accentunder',
      'columnalign',
      'rowalign',
      'columnspan',
      'rowspan',
      'encoding',
      'viewBox',
      'width',
      'height',
      'd',
      'x',
      'y',
      'x1',
      'x2',
      'y1',
      'y2',
      'cx',
      'cy',
      'r',
      'rx',
      'ry',
      'points',
      'fill',
      'stroke',
      'stroke-width',
      'transform',
      'text-anchor',
    ],
    FORBID_TAGS: [
      ...(HTML_OPTIONS.FORBID_TAGS ?? []),
      'foreignObject',
      'annotation-xml',
      'use',
      'image',
      'animate',
      'set',
    ],
  });
}

/** Keep images inert until a Markdown snapshot resolves their permitted bytes. */
export function sanitizeMarkdownHtml(html: string): DocumentFragment {
  const purify = DOMPurify(window);
  purify.addHook('uponSanitizeAttribute', (node, event) => {
    if (node.nodeName.toLowerCase() === 'img' && event.attrName === 'src') {
      node.setAttribute('data-glossa-image', event.attrValue);
      event.keepAttr = false;
    }
  });
  return purify.sanitize(html, {
    ...HTML_OPTIONS,
    ADD_ATTR: ['data-glossa-image'],
    RETURN_DOM_FRAGMENT: true,
  });
}

/**
 * Strip scripts and event handlers from an untrusted *document* before it is
 * handed to `DOMParser`. Unlike `sanitizeHtml`, this keeps the document
 * structure (`<head>`, `<title>`, sectioning elements) so title extraction and
 * Readability still work — it only removes anything executable.
 */
export function sanitizeForParsing(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['meta', 'link'],
    FORBID_TAGS: ['base'],
  });
}
