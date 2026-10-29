import { detectLanguage } from '@/utils/lang';
// `mammoth` (DOCX → HTML) and `TxtToEpubConverter` are dynamically imported
// inside their respective `case` bodies in `convertToEpub`. They're heavy
// (≈500 KB combined) and only needed for the docx/txt input kinds — the
// browser extension imports `convertPageToEpub` and never reaches those
// branches, so dynamic imports let webpack code-split them out of the
// extension bundle entirely.
import { sanitizeHtml, sanitizeArticleHtml, sanitizeForParsing } from '@/utils/sanitize';
import { buildEpub } from './buildEpub';
import { bundleAssets } from './assetBundler';
import { generateCoverSvg } from './coverGenerator';
import { fetchAuthorImage, fetchBestFavicon } from './faviconFetcher';
import { findSiteRule, META_FALLBACK, type SiteRule } from './siteRules';
import { extractHeadings } from './toc';
import { extractWebArticle, safeSourceUrl } from './extractWebArticle';
import { ConversionError } from './types';
import type {
  ConvertibleMime,
  ConvertedBook,
  EpubChapter,
  EpubImage,
  TocEntry,
  WebArticleOptions,
  WebArticleSource,
  ConversionWarning,
} from './types';

/** Discriminated input — the caller resolves the kind from the MIME type. */
export type ConvertInput =
  | { kind: 'docx'; bytes: ArrayBuffer; fileName?: string }
  | { kind: 'rtf'; bytes: ArrayBuffer; fileName?: string }
  | { kind: 'html'; bytes: ArrayBuffer; fileName?: string }
  | { kind: 'txt'; file: File }
  | ({ kind: 'article'; html: string; url: string } & WebArticleOptions)
  /** Self-contained page clip: like `article` but fetches every referenced
   *  image and embeds it in the EPUB. Only safe from a CORS-free context
   *  (Tauri webview, browser-extension content script). */
  | ({ kind: 'page'; html: string; url: string; signal?: AbortSignal } & WebArticleOptions);

const MIME_TO_KIND: Record<ConvertibleMime, ConvertInput['kind']> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/plain': 'txt',
  'text/uri-list': 'article',
};

/** Whether a MIME type needs conversion before the normal import pipeline. */
export function isConvertible(mime: string): mime is ConvertibleMime {
  return mime in MIME_TO_KIND;
}

export function mimeToKind(mime: ConvertibleMime): ConvertInput['kind'] {
  return MIME_TO_KIND[mime];
}

// djb2 — a deterministic content hash so re-converting the same source yields
// the same EPUB identifier (and, with zeroed zip timestamps, identical bytes).
export function stableIdentifier(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h + content.charCodeAt(i)) >>> 0;
  }
  return `readest:${h.toString(16)}`;
}

export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function safeFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
  return base.slice(0, 120);
}

/** Escape text content for inline insertion into HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Prepend the article title (as `<h1>`) and the byline (as `<p>`) to the
 * extracted body. Readability and the per-site rules give us title and
 * byline as separate fields — they're stripped out of the body content
 * during extraction, so the EPUB chapter would otherwise open with the
 * first body paragraph and the user wouldn't see who wrote it or what
 * it's called inside the book. The `<h1>` also becomes the top-level
 * navMap entry (via `extractHeadings`) so the TOC sidebar shows the
 * article title.
 */
function composeArticleContent(title: string, byline: string, body: string): string {
  const parts = [`<h1>${escapeHtml(title)}</h1>`];
  const trimmedByline = byline.trim();
  if (trimmedByline) {
    parts.push(`<p>${escapeHtml(trimmedByline)}</p>`);
  }
  parts.push(body);
  return parts.join('\n');
}

/** Assemble deterministic bytes. The EPUB identifier describes a work;
 * the import pipeline separately verifies complete file bytes for identity. */
async function htmlToBook(
  rawHtml: string,
  title: string,
  author: string,
  identityKey: string,
  images: EpubImage[] = [],
  coverImage?: EpubImage,
  source?: WebArticleSource,
  warnings?: ConversionWarning[],
): Promise<ConvertedBook> {
  // Assign stable ids to headings BEFORE sanitization so the strict
  // `sanitizeHtml` step (which now allows `id`) preserves them — those
  // ids are what `toc.ncx` links to.
  const { html: withIds, headings } = extractHeadings(rawHtml);
  const html = source ? sanitizeArticleHtml(withIds) : sanitizeHtml(withIds);
  const text = stripTags(html);
  if (!text) {
    throw new ConversionError('Document has no readable content', 'empty_input');
  }
  const language = detectLanguage(text.slice(0, 2048)) || 'en';
  const chapter: EpubChapter = { title, html };
  const toc: TocEntry[] | undefined = headings.length > 0 ? headings : undefined;
  if (toc) {
    console.log('[clip/toc] headings', {
      count: toc.length,
      levels: toc.map((h) => h.level),
    });
  }
  const blob = await buildEpub(
    [chapter],
    {
      title,
      author,
      language,
      identifier: stableIdentifier(identityKey),
      toc,
      source,
      warnings,
    },
    images,
    coverImage,
  );
  const fileBytes = new Uint8Array(await blob.arrayBuffer());
  const file = new File([fileBytes], `${safeFileName(title)}.epub`, {
    type: 'application/epub+zip',
  });
  return { file, title, author, ...(source ? { source, warnings } : {}) };
}

function pickMetaContent(doc: Document, selectors: readonly string[]): string | null {
  for (const sel of selectors) {
    const value = doc.querySelector(sel)?.getAttribute('content')?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Variant of `pickMetaContent` that resolves the picked URL against the
 * page URL — meta `og:image` values are often root-relative. Returns
 * null if nothing matched or the URL was unparseable.
 */
function resolveMetaImage(
  doc: Document,
  selectors: readonly string[],
  pageUrl: string,
): string | null {
  const raw = pickMetaContent(doc, selectors);
  if (!raw) return null;
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return null;
  }
}

function extractSiteName(doc: Document, pageUrl: string): string {
  const metaSelectors = [
    'meta[property="og:site_name"]',
    'meta[name="og:site_name"]',
    'meta[name="application-name"]',
    'meta[name="apple-mobile-web-app-title"]',
    'meta[property="twitter:site"]',
  ];
  for (const sel of metaSelectors) {
    const value = doc.querySelector(sel)?.getAttribute('content')?.trim();
    if (value) return value;
  }
  return hostnameFallback(pageUrl);
}

/** Decoded file name (no extension) of a `file://` URL — what stands in for
 *  the hostname when the "page" came off the user's own disk. */
function fileNameFromUrl(pageUrl: string): string {
  try {
    const last = new URL(pageUrl).pathname.split('/').pop() ?? '';
    return decodeURIComponent(last)
      .replace(/\.[^.]+$/, '')
      .trim();
  } catch {
    return '';
  }
}

/**
 * Build a synthetic cover for a clipped article. Parses the page HTML once
 * to find the site name and favicon, then hands those off to
 * `generateCoverSvg`. Returns `undefined` only when the cover can't be
 * generated at all (e.g. the parser threw) — the favicon-fetch failing is
 * already handled by the cover generator's initial-letter fallback.
 */
async function buildArticleCover(
  pageHtml: string,
  pageUrl: string,
  title: string,
  author: string,
  rule: SiteRule | null,
  signal?: AbortSignal,
): Promise<EpubImage | undefined> {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(sanitizeForParsing(pageHtml), 'text/html');
  } catch {
    return generateCoverSvg({ title, author, siteName: hostnameFallback(pageUrl) });
  }
  const siteName = extractSiteName(doc, pageUrl);

  // Prefer an author profile image (richer than a site-wide favicon).
  // Three layers, in order of richness:
  //   1. The site rule's `authorImage` selector — handcrafted, e.g. the
  //      WeChat account avatar or the X profile picture.
  //   2. OpenGraph / Twitter Card `og:image` — every publisher sets this
  //      for link unfurlers. Works when no rule matched, AND when the
  //      rule's selector missed because the site reshuffled its DOM.
  //   3. Favicon (handled below).
  // Site-rule miss is silent — `pickImageUrlFromSelector` returns null,
  // we fall through to the meta layer.
  let authorImage: { bytes: ArrayBuffer; mime: string } | undefined;
  const ruleImageUrl = rule?.authorImage
    ? pickImageUrlFromSelector(doc, rule.authorImage, pageUrl)
    : null;
  const metaImageUrl = ruleImageUrl
    ? null
    : resolveMetaImage(doc, META_FALLBACK.authorImage, pageUrl);
  // Only http(s) is reachable — on a page clipped from disk both of these
  // resolve to unfetchable `file://` siblings.
  const candidateImageUrl = [ruleImageUrl, metaImageUrl].find((u) => u && /^https?:/i.test(u));
  if (candidateImageUrl) {
    authorImage =
      (await fetchAuthorImage(candidateImageUrl, pageUrl, signal).catch(() => null)) ?? undefined;
  }

  // Favicon is only fetched when we don't already have an author image —
  // saves a wasted HTTP round-trip on WeChat (and any other rule that
  // sets `authorImage`).
  const favicon = authorImage
    ? undefined
    : ((await fetchBestFavicon(doc, pageUrl, signal).catch(() => null)) ?? undefined);

  return generateCoverSvg({ title, author, siteName, authorImage, favicon });
}

/** Walk the rule's `authorImage` selector list and return the first usable
 *  `src` or `data-src` URL, resolved against the page URL. */
function pickImageUrlFromSelector(doc: Document, selector: string, pageUrl: string): string | null {
  let els: NodeListOf<Element>;
  try {
    els = doc.querySelectorAll(selector);
  } catch {
    return null;
  }
  for (const el of Array.from(els)) {
    const raw =
      el.getAttribute('src') ||
      el.getAttribute('data-src') ||
      el.getAttribute('data-original') ||
      el.getAttribute('href');
    if (!raw) continue;
    try {
      return new URL(raw, pageUrl).toString();
    } catch {
      // unparseable href — try the next element
    }
  }
  return null;
}

function hostnameFallback(pageUrl: string): string {
  try {
    const parsed = new URL(pageUrl);
    // A page opened from disk has no hostname — label the cover with the
    // file name instead, or the avatar degrades to a "·" placeholder.
    if (parsed.protocol === 'file:') return fileNameFromUrl(pageUrl);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Pull a title from the document, in declining order of trust:
 *  OpenGraph / Twitter Card title → `<title>` → first `<h1>` → fallback. */
function extractHtmlTitle(html: string, fallback: string): string {
  try {
    const doc = new DOMParser().parseFromString(sanitizeForParsing(html), 'text/html');
    const meta = pickMetaContent(doc, META_FALLBACK.title);
    if (meta) return meta;
    const t = doc.querySelector('title')?.textContent?.trim();
    if (t) return t;
    const h1 = doc.querySelector('h1')?.textContent?.trim();
    if (h1) return h1;
  } catch {
    /* fall through */
  }
  return fallback;
}

// Best-effort RTF → plain text: drop control words, unescape hex, strip groups.
function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\r/g, '')
    .trim();
}

function baseName(fileName: string | undefined, fallback: string): string {
  if (!fileName) return fallback;
  return fileName.replace(/\.[^.]+$/, '').trim() || fallback;
}

/** Convert captured HTML locally, then package reachable images and provenance. */
export async function convertPageToEpub(
  html: string,
  url: string,
  signal?: AbortSignal,
  options: WebArticleOptions = {},
): Promise<ConvertedBook> {
  signal?.throwIfAborted();
  const article = extractWebArticle(html, url, options);
  // The body images and generated cover share one resource deadline. Expiry
  // preserves readable text and missing-resource evidence; user cancellation
  // still rejects the entire conversion through the separate caller signal.
  const resources = new AbortController();
  const cancelResources = () => resources.abort(signal?.reason);
  signal?.addEventListener('abort', cancelResources, { once: true });
  const timer = setTimeout(
    () => resources.abort(new Error('Article resource deadline reached')),
    40_000,
  );
  try {
    options.onStage?.('Saving article images…');
    const bundle = await bundleAssets(
      article.content,
      url,
      signal,
      resources.signal,
      article.baseUrl,
    );
    if (bundle.missingResources.length)
      article.source.missingAssets = bundle.missingResources.map(safeSourceUrl);
    if (article.imageOnly && !bundle.images.length) {
      throw new ConversionError(
        'The article images could not be packaged for offline reading',
        'parse_failed',
      );
    }
    options.onStage?.('Preparing article cover…');
    const cover = await buildArticleCover(
      html,
      url,
      article.title,
      article.author,
      findSiteRule(url),
      resources.signal,
    );
    signal?.throwIfAborted();
    const warnings: ConversionWarning[] = [];
    if (bundle.missing) warnings.push({ code: 'missing_assets', count: bundle.missing });
    if (article.source.scope !== 'article') warnings.push({ code: 'partial_content' });
    options.onStage?.('Packaging article…');
    return htmlToBook(
      composeArticleContent(article.title, article.author, bundle.html),
      article.title,
      article.author,
      url,
      bundle.images,
      cover,
      article.source,
      warnings,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancelResources);
  }
}

/**
 * Convert a document Readest cannot open natively into an EPUB. Runs entirely
 * client-side (browser or Tauri webview) — meant to be called inside a Web
 * Worker so the heavy parsing never blocks the UI thread.
 */
export async function convertToEpub(input: ConvertInput): Promise<ConvertedBook> {
  switch (input.kind) {
    case 'txt': {
      const { TxtToEpubConverter } = await import('@/utils/txt');
      const result = await new TxtToEpubConverter().convert({ file: input.file });
      return { file: result.file, title: result.bookTitle, author: '' };
    }
    case 'docx': {
      if (input.bytes.byteLength === 0) {
        throw new ConversionError('Empty .docx file', 'empty_input');
      }
      let html: string;
      try {
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.convertToHtml({ arrayBuffer: input.bytes });
        html = result.value;
      } catch (err) {
        throw new ConversionError(`Could not parse .docx: ${String(err)}`, 'parse_failed');
      }
      // Local files have no URL — hash their content for the identifier.
      return htmlToBook(html, baseName(input.fileName, 'Document'), '', html);
    }
    case 'html': {
      const raw = new TextDecoder('utf-8').decode(input.bytes);
      const title = extractHtmlTitle(raw, baseName(input.fileName, 'Document'));
      return htmlToBook(raw, title, '', raw);
    }
    case 'rtf': {
      const rtf = new TextDecoder('utf-8').decode(input.bytes);
      const text = rtfToText(rtf);
      if (!text) {
        throw new ConversionError('Could not extract text from .rtf', 'parse_failed');
      }
      const html = text
        .split(/\n+/)
        .map((line) => `<p>${line.replace(/[<>&]/g, ' ').trim()}</p>`)
        .join('');
      return htmlToBook(html, baseName(input.fileName, 'Document'), '', html);
    }
    case 'article': {
      const article = extractWebArticle(input.html, input.url, input);
      if (article.imageOnly) {
        throw new ConversionError('Image articles require offline image packaging', 'parse_failed');
      }
      const cover = await buildArticleCover(
        input.html,
        input.url,
        article.title,
        article.author,
        findSiteRule(input.url),
      );
      const warnings: ConversionWarning[] =
        article.source.scope === 'article' ? [] : [{ code: 'partial_content' }];
      return htmlToBook(
        composeArticleContent(article.title, article.author, article.content),
        article.title,
        article.author,
        input.url,
        [],
        cover,
        article.source,
        warnings,
      );
    }
    case 'page': {
      return convertPageToEpub(input.html, input.url, input.signal, input);
    }
    default: {
      throw new ConversionError(
        `Unsupported conversion input: ${(input as { kind: string }).kind}`,
        'unsupported_type',
      );
    }
  }
}
