import { Marked } from 'marked';
import markedFootnote from 'marked-footnote';

import type { BookDoc, SectionItem } from '@/libs/document';
import { CFI } from '@/libs/document';
import {
  FOOTNOTE_PREFIX_ID,
  buildChapterFootnotes,
  expandInlineFootnotes,
  extractFootnoteDefs,
} from './mdFootnotes';
import { frontmatterToMetadata, parseFrontmatter } from './mdFrontmatter';
import { markdownMath, renderMarkdownMath } from './mdMath';
import { sanitizeMarkdownHtml } from './sanitize';
import { readMarkdownInput, resolveMarkdownImages } from './mdResources';

// Render a standalone Markdown (.md) file into an in-memory foliate-js book at
// runtime (no EPUB conversion). The document is split into one section per
// top-level heading so reading progress, the cross-device location cursor and
// TTS section tracking all work per chapter — the same contract fb2.js gives a
// single-file format. Layout/font/theme styling applies for free because the
// reader styles whatever HTML the view renders.

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

// A scoped parser: `marked` itself is a shared singleton also imported by the
// annotation note renderer and the export dialog, and must not gain footnote
// parsing as a side effect.
const markdown = new Marked({ gfm: true }).use(
  markedFootnote({ prefixId: FOOTNOTE_PREFIX_ID }),
  markdownMath,
  {
    hooks: { preprocess: expandInlineFootnotes },
    renderer: {
      checkbox: ({ checked }) => `<span class="md-task-marker">${checked ? '☑' : '☐'}</span> `,
    },
  },
);

// Keep the shared reader's fonts, theme and Aa preferences. Scope structural
// defaults to Markdown so imported books retain their publisher styles.
const MD_STYLE = `
.glossa-markdown img { max-width: 100%; height: auto; }
.glossa-markdown :is(h1,h2,h3,h4,h5,h6) { line-height: 1.35; margin-block: 1.6em 0.65em; break-after: avoid; }
.glossa-markdown h1 { font-size: 1.8em; }
.glossa-markdown h2 { font-size: 1.45em; }
.glossa-markdown h3 { font-size: 1.2em; }
.glossa-markdown :is(h4,h5,h6) { font-size: 1em; }
.glossa-markdown pre, .glossa-markdown pre code { white-space: pre !important; overflow-wrap: normal; word-break: normal; }
.glossa-markdown pre { box-sizing: border-box; overflow: auto; max-width: 100%; max-height: min(65vh, calc(var(--available-height, 600) * 0.8px)); padding: 0.85em 1em; border: 1px solid color-mix(in srgb, currentColor 16%, transparent); background: color-mix(in srgb, currentColor 4%, transparent); scrollbar-width: thin; touch-action: pan-x pan-y; }
.glossa-markdown code { font-family: var(--monospace, monospace); font-size: 0.9em; }
.glossa-markdown :not(pre) > code { padding: 0.1em 0.25em; background: color-mix(in srgb, currentColor 5%, transparent); }
.glossa-markdown table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
.glossa-markdown th, .glossa-markdown td { border: 1px solid color-mix(in srgb, currentColor 24%, transparent); padding: 0.45em 0.65em; min-inline-size: 4em; text-align: start; }
.glossa-markdown th { font-weight: 600; }
.glossa-markdown blockquote { margin-inline: 0; padding-inline-start: 1em; border-inline-start: 2px solid color-mix(in srgb, currentColor 24%, transparent); }
.md-missing-image { display: block; margin-block: 0.75em; padding: 0.65em; border: 1px dashed currentColor; font-size: 0.85em; opacity: 0.7; }
.md-footnotes { margin-block-start: 2em; font-size: 0.9em; }
.md-footnotes hr { width: 30%; margin-inline-start: 0; border: 0; border-top: 1px solid currentColor; opacity: 0.4; }
sup a, .footnote-backref { text-decoration: none; }
.footnote-backref { margin-inline-start: 0.4em; }
`;

const wrapXhtml = (inner: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  `<html xmlns="${XHTML_NS}" class="glossa-markdown"><head><meta charset="utf-8"/>` +
  `<style>${MD_STYLE}</style></head><body>${inner}</body></html>`;

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';

const isExternalUri = (uri: string): boolean => /^(?:https?|mailto|tel):/i.test(uri);

interface TocNode {
  label: string;
  href: string;
  subitems?: TocNode[];
}

type MarkdownSection = SectionItem & {
  load: () => string;
  loadContent: () => Promise<string>;
  unload: () => void;
};

export async function makeMarkdownBook(file: File): Promise<BookDoc> {
  const input = await readMarkdownInput(file);
  const text = new TextDecoder().decode(input.original);
  // The frontmatter block is stripped before rendering so it does not show up
  // as a stray `<hr>` + text; its keys become the book's metadata (issue #5279).
  const { body, fields } = parseFrontmatter(text);
  const { metadata: frontmatter, coverBlob } = frontmatterToMetadata(fields);
  // Library cover consumers may fetch this URL later. Markdown remains local
  // even when frontmatter advertises a remote cover; original bytes are kept.
  delete frontmatter.coverImageUrl;
  const rawHtml = await markdown.parse(body);
  const fragment = sanitizeMarkdownHtml(rawHtml);
  const docBody = new DOMParser().parseFromString(
    '<!doctype html><html><body></body></html>',
    'text/html',
  ).body;
  docBody.append(fragment);
  resolveMarkdownImages(docBody, input.resources);

  renderMarkdownMath(docBody);

  // Lift the collected footnote definitions out before anything else looks at
  // the document: they are re-emitted per chapter below, and taking them out
  // here also keeps the generated "Footnotes" heading out of the TOC.
  const footnoteDefs = extractFootnoteDefs(docBody);

  // Ensure every id is unique (including author-provided ids on raw HTML /
  // footnotes), then give each heading a stable slug id for TOC anchors and
  // internal-link resolution.
  const usedIds = new Set<string>();
  for (const el of Array.from(docBody.querySelectorAll('[id]'))) {
    if (el.id) usedIds.add(el.id);
  }
  const uniqueId = (base: string): string => {
    let id = base;
    let n = 1;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  };
  // All six Markdown heading levels, so the TOC mirrors the document outline in
  // full and deep headings stay linkable by anchor (issue #5357).
  const headingEls = Array.from(docBody.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  for (const h of headingEls) {
    if (!h.id) h.id = uniqueId(slugify(h.textContent ?? ''));
  }

  // Split the top-level nodes into sections at <h1> boundaries. Content before
  // the first <h1> becomes a leading preamble section (only when it has real
  // content). A document with no <h1> stays a single section.
  const hasContent = (nodes: ChildNode[]): boolean =>
    nodes.some(
      (n) =>
        n.nodeType === Node.ELEMENT_NODE ||
        (n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim()),
    );
  const groups: ChildNode[][] = [];
  let current: ChildNode[] = [];
  for (const node of Array.from(docBody.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'H1') {
      if (hasContent(current)) groups.push(current);
      current = [node];
    } else {
      current.push(node);
    }
  }
  if (hasContent(current)) groups.push(current);
  if (groups.length === 0) groups.push([]);

  // Give each chapter its own endnote list, numbered from 1, so a reference in
  // chapter 2 resolves within chapter 2 instead of jumping to the end of the
  // book. Must run before the ids below are mapped to sections.
  groups.forEach((nodes, index) => {
    const notes = buildChapterFootnotes(nodes, index, footnoteDefs, uniqueId);
    if (notes) nodes.push(notes);
  });

  // Serialize each section to well-formed XHTML. Marked emits HTML5 void tags
  // (<br>, <hr>, <img>) that are parse errors under application/xhtml+xml, so
  // XMLSerializer (not innerHTML) is required. Map every id to its section.
  const serializer = new XMLSerializer();
  const idMap = new Map<string, number>();
  const xhtml = groups.map((nodes, index) => {
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      if (el.id) idMap.set(el.id, index);
      for (const child of Array.from(el.querySelectorAll('[id]'))) {
        if (child.id) idMap.set(child.id, index);
      }
    }
    return wrapXhtml(nodes.map((n) => serializer.serializeToString(n)).join(''));
  });

  // Build a nested heading outline as the TOC, each entry linking to its
  // section index plus heading anchor.
  const root: TocNode[] = [];
  const stack: { level: number; subitems: TocNode[] }[] = [{ level: 0, subitems: root }];
  for (const h of headingEls) {
    const label = (h.textContent ?? '').trim();
    if (!label) continue;
    const level = Number(h.tagName.slice(1));
    const item: TocNode = { label, href: `${idMap.get(h.id) ?? 0}#${h.id}`, subitems: [] };
    while (stack[stack.length - 1]!.level >= level) stack.pop();
    stack[stack.length - 1]!.subitems.push(item);
    stack.push({ level, subitems: item.subitems! });
  }
  const prune = (items: TocNode[]): TocNode[] =>
    items.map(({ label, href, subitems }) => ({
      label,
      href,
      subitems: subitems && subitems.length ? prune(subitems) : undefined,
    }));
  const toc = prune(root);

  // The same transform pipeline EPUB/MOBI content goes through: the reader
  // attaches its content transformers (proofread, simplecc, punctuation, ...)
  // to `book.transformTarget`, and the paginator renders `loadContent()` via
  // srcdoc when it is defined. Transformed content is cached per section and
  // invalidated by unload() (the paginator unloads a section whenever its view
  // is destroyed, e.g. on the viewer recreation a proofread rule change
  // triggers), so rule changes show up on the next load. createDocument()
  // stays raw, mirroring EPUB: TTS replays this same pipeline itself, and a
  // pre-transformed document would double-apply the transformers.
  const transformTarget = new EventTarget();
  const transformed: (string | undefined)[] = new Array(xhtml.length).fill(undefined);
  const transformSection = async (index: number): Promise<string> => {
    const cached = transformed[index];
    if (cached !== undefined) return cached;
    const str = xhtml[index]!;
    let result = str;
    try {
      const detail: { data: string | Promise<string>; type: string } = {
        data: str,
        type: 'application/xhtml+xml',
      };
      // Readonly, mirroring foliate's Loader.createURL dispatch. Selection
      // scoped proofread rules compare their TOC-style sectionHref
      // ("<index>#<anchor>") against this name via split('#')[0].
      Object.defineProperty(detail, 'name', { value: String(index) });
      transformTarget.dispatchEvent(new CustomEvent('data', { detail }));
      const out = await detail.data;
      // '' is the reader transform handler's error fallback.
      if (typeof out === 'string' && out) result = out;
    } catch {
      // Keep the raw section on any transform failure.
    }
    transformed[index] = result;
    return result;
  };

  const urls: (string | undefined)[] = new Array(xhtml.length).fill(undefined);
  const sections: MarkdownSection[] = xhtml.map((str, index) => ({
    id: String(index),
    // A per-section spine CFI base. foliate-js builds location CFIs as
    // `section.cfi ?? CFI.fake.fromIndex(index)`; an empty string defeats that
    // `??` fallback, so every saved position would collapse to a section-less
    // CFI and reopening would resume from the start. Set the same fake spine
    // CFI foliate would synthesize so positions round-trip across reopens.
    cfi: CFI.fake.fromIndex(index),
    size: new TextEncoder().encode(str).length,
    linear: 'yes',
    load: () => {
      if (urls[index] === undefined) {
        urls[index] = URL.createObjectURL(new Blob([str], { type: 'application/xhtml+xml' }));
      }
      return urls[index]!;
    },
    loadContent: () => transformSection(index),
    unload: () => {
      transformed[index] = undefined;
    },
    loadText: async () => str,
    createDocument: async () => new DOMParser().parseFromString(str, 'application/xhtml+xml'),
  }));

  const title =
    frontmatter.title ||
    (headingEls.find((h) => h.tagName === 'H1')?.textContent ?? '').trim() ||
    file.name.replace(/\.(?:md|markdown)$/i, '');

  const book = {
    metadata: {
      author: '',
      language: 'en',
      ...frontmatter,
      title,
      // A frontmatter identifier — an explicit one, else the ISBN — makes the
      // same book import to the same `metaHash` from any copy of the file. With
      // neither, the filename stays the identifier, so books already in the
      // library keep the hash they were imported under.
      identifier: frontmatter.identifier || frontmatter.isbn || file.name,
    },
    rendition: { layout: 'reflowable' as const },
    dir: 'ltr',
    toc,
    sections,
    transformTarget,
    splitTOCHref: (href: string): string[] => (href ? href.split('#') : []),
    getTOCFragment: (doc: Document, id: string): Element | null => doc.getElementById(id),
    resolveHref: (href: string) => {
      const [a, b] = href.split('#');
      if (a) {
        const index = Number(a);
        if (!Number.isInteger(index) || index < 0 || index >= sections.length) return null;
        return { index, anchor: (doc: Document) => (b ? doc.getElementById(b) : null) };
      }
      if (!b) return null;
      const index = idMap.get(b);
      if (index === undefined) return null;
      return { index, anchor: (doc: Document) => doc.getElementById(b) };
    },
    isExternal: (uri: string): boolean => isExternalUri(uri),
    getCover: async (): Promise<Blob | null> => coverBlob,
    destroy: () => {
      for (const url of urls) if (url) URL.revokeObjectURL(url);
    },
  };

  return book as unknown as BookDoc;
}
