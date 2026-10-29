import Defuddle from 'defuddle';
import { Readability } from '@mozilla/readability';
import { sanitizeForParsing } from '@/utils/sanitize';
import { findSiteRule } from './siteRules';
import { ConversionError, type WebArticleOptions, type WebArticleSource } from './types';

export const WEB_EXTRACTOR_VERSION = '2';

export interface ExtractedWebArticle {
  content: string;
  title: string;
  author: string;
  source: WebArticleSource;
  imageOnly: boolean;
  baseUrl: string;
}

interface Candidate {
  content: string;
  title?: string | null;
  author?: string | null;
  extractor: string;
  semantic?: boolean;
  element?: Element;
}

const SELECTORS = [
  '[itemprop="articleBody"]',
  '#js_content',
  '.article-body',
  'article',
  '[role="article"]',
  '.post-content',
  '.entry-content',
  '.article-content',
  '.post-body',
  '.markdown-body',
  '[role="main"]',
  'main',
  '#content',
];
const normalizedText = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

function meta(doc: Document, ...names: string[]): string {
  for (const name of names) {
    const result = Array.from(doc.querySelectorAll('meta')).find((item) =>
      [item.getAttribute('name'), item.getAttribute('property')].some(
        (value) => value?.toLowerCase() === name.toLowerCase(),
      ),
    );
    const value = normalizedText(result?.getAttribute('content'));
    if (value) return value;
  }
  return '';
}

function httpUrl(value: string | null | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** JSON-LD is parsed as bounded inert data. No external contexts or code run. */
function schemaArticle(doc: Document): Record<string, unknown> | undefined {
  let visited = 0;
  function visit(value: unknown, depth = 0): Record<string, unknown> | undefined {
    if (depth > 6 || ++visited > 200 || !value || typeof value !== 'object') return undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
    if (
      types.some(
        (type) =>
          typeof type === 'string' &&
          /^(?:Article|NewsArticle|BlogPosting|ScholarlyArticle|TechArticle)$/.test(type),
      )
    )
      return record;
    return visit(record['@graph'], depth + 1);
  }
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).slice(
    0,
    10,
  )) {
    const text = script.textContent ?? '';
    if (text.length > 128_000) continue;
    try {
      const found = visit(JSON.parse(text) as unknown);
      if (found) return found;
    } catch {
      /* malformed metadata is optional */
    }
  }
  return undefined;
}

function schemaString(value: unknown): string {
  return typeof value === 'string' ? normalizedText(value) : '';
}

function schemaAuthor(value: unknown): string {
  if (Array.isArray(value)) return value.map(schemaAuthor).filter(Boolean).join(', ');
  if (value && typeof value === 'object')
    return schemaString((value as Record<string, unknown>)['name']);
  return schemaString(value);
}

function fallbackTitle(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:')
      return (
        decodeURIComponent(parsed.pathname.split('/').pop() ?? '').replace(/\.[^.]+$/, '') ||
        'Document'
      );
  } catch {
    /* caller supplied URL remains the last resort */
  }
  return url;
}

/** Preserve a local filename without serializing the user's home directory. */
export function safeSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:')
      return `urn:glossa:local-page:${url.pathname.split('/').pop() || 'document'}`;
  } catch {
    /* non-URL identifiers pass through */
  }
  return value;
}

function extractionDocument(raw: string, baseUrl: string): Document {
  const doc = new DOMParser().parseFromString(sanitizeForParsing(raw), 'text/html');
  doc.querySelectorAll('base').forEach((node) => node.remove());
  const base = doc.createElement('base');
  base.href = baseUrl;
  doc.head.prepend(base);
  return doc;
}

function readable(candidate: Candidate): boolean {
  const root =
    candidate.element ?? new DOMParser().parseFromString(candidate.content, 'text/html').body;
  const text = normalizedText(root.textContent);
  const linked = Array.from(root.querySelectorAll('a')).reduce(
    (sum, link) => sum + normalizedText(link.textContent).length,
    0,
  );
  if (text && linked / text.length > 0.6) return false;
  const paragraphs = root.querySelectorAll('p,pre,blockquote,td,li').length;
  const images = Array.from(
    root.querySelectorAll('img[src],img[data-src],img[data-original],picture source[srcset]'),
  ).filter((node) => !(node.getAttribute('width') === '1' && node.getAttribute('height') === '1'));
  if (
    candidate.semantic &&
    images.length &&
    (root.querySelector('h1,h2,figcaption') || images.length > 1)
  )
    return true;
  // Semantic short pieces are complete documents too. Length only supplements
  // structural evidence; it never distinguishes an article from an access wall.
  return candidate.semantic
    ? text.length >= 20 && paragraphs > 0
    : text.length >= 80 && paragraphs > 0;
}

/** Compare source blocks, not total length: a long candidate can still omit an
 * entire section, a short linked appendix, or the text of a bibliography. */
function omitsSemanticBlocks(candidate: Candidate, source: Candidate): boolean {
  if (!source.element) return false;
  const root =
    candidate.element ?? new DOMParser().parseFromString(candidate.content, 'text/html').body;
  candidate.element = root;
  const compact = (value: string | null) => (value ?? '').replace(/\s+/g, '');
  const extracted = compact(root.textContent);
  const blocks = source.element.querySelectorAll(
    'h2,h3,h4,h5,h6,p,pre,li,dt,dd,figcaption,blockquote',
  );
  // Rich scientific sources use the semantic fast path. This bounded guard is
  // for ordinary engine output and never starts another extraction engine.
  for (const block of Array.from(blocks).slice(0, 2_000)) {
    const text = compact(block.textContent);
    if (text.length < (block.matches('h2,h3,h4,h5,h6,pre') ? 2 : 12)) continue;
    if (!extracted.includes(text)) return true;
  }
  return false;
}

function fixLinks(content: string, url: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(content, 'text/html');
  const ids = new Set(Array.from(doc.querySelectorAll('[id]')).map((item) => item.id));
  doc.querySelectorAll('a[href]').forEach((link) => {
    const raw = link.getAttribute('href') ?? '';
    try {
      const resolved = new URL(raw, baseUrl);
      const current = new URL(url);
      const target = decodeURIComponent(resolved.hash.slice(1));
      if (
        ids.has(target) &&
        (raw.startsWith('#') ||
          (resolved.origin === current.origin && resolved.pathname === current.pathname))
      ) {
        link.setAttribute('href', `#${resolved.hash.slice(1)}`);
      } else if (/^https?:$/.test(resolved.protocol)) link.setAttribute('href', resolved.href);
    } catch {
      /* final sanitizer removes unsafe schemes */
    }
  });
  return doc.body.innerHTML;
}

function restoreLinkedNotes(content: string, doc: Document): string {
  const fragment = new DOMParser().parseFromString(content, 'text/html');
  const notes = fragment.createElement('section');
  notes.className = 'footnotes';
  const ids = new Set(Array.from(fragment.querySelectorAll('[id]')).map((node) => node.id));
  for (const link of Array.from(fragment.querySelectorAll('a[href]')).slice(0, 200)) {
    let id: string;
    try {
      id = decodeURIComponent(new URL(link.getAttribute('href') ?? '', doc.baseURI).hash.slice(1));
    } catch {
      continue;
    }
    if (!id || ids.has(id) || notes.childElementCount >= 50) continue;
    const target = doc.getElementById(id);
    if (
      !target ||
      (!/^(?:fn|footnote|note|ref)[-_\d]/i.test(id) &&
        !target.matches(
          '[role="doc-footnote"],[role="doc-endnote"],.footnote,.footnotes *,.endnote,.endnotes *',
        ))
    )
      continue;
    if ((target.textContent?.length ?? 0) > 10_000) continue;
    notes.append(target.cloneNode(true));
    ids.add(id);
  }
  if (notes.childElementCount) fragment.body.append(notes);
  return fragment.body.innerHTML;
}

/** Local-only extraction. Every engine gets its own document because both
 * Defuddle and Readability mutate it. No external extractor/API is permitted. */
export function extractWebArticle(
  html: string,
  url: string,
  options: WebArticleOptions & { preferredExtractor?: 'defuddle' | 'readability' } = {},
): ExtractedWebArticle {
  if (!html.trim()) throw new ConversionError('Page has no readable content', 'empty_input');
  const raw = new DOMParser().parseFromString(html, 'text/html');
  const baseUrl =
    options.baseUrl || httpUrl(raw.querySelector('base[href]')?.getAttribute('href'), url) || url;
  const heading = normalizedText(raw.querySelector('h1')?.textContent);
  const titleText = normalizedText(raw.title);
  const challenge =
    /(?:verify (?:you are|that you are) human|just a moment|security (?:check|verification)|checking your browser|access denied|验证您是人类|安全验证|访问受限)/i;
  const signInHeading = /^(?:sign in|log in|login|登录|请登录|登录后继续|请先登录)(?:\s|$)/i;
  const authForm = Array.from(raw.querySelectorAll('form')).some(
    (form) =>
      /(?:log[-_ ]?in|sign[-_ ]?in|signflow|onboarding)/i.test(
        `${form.className} ${form.getAttribute('action') ?? ''}`,
      ) || Boolean(form.querySelector('input[type="password"]')),
  );
  const semanticProse = Array.from(
    raw.querySelectorAll(
      'article p,[itemprop="articleBody"] p,main p,.post-content p,.entry-content p',
    ),
  )
    .filter((node) => !node.closest('form,nav,footer'))
    .map((node) => normalizedText(node.textContent))
    .join(' ');
  const unavailable =
    /^(?:(?:404|410)(?:\s+(?:error|not found|gone))?|(?:page|article|resource|document) (?:not found|unavailable)|not found|页面不存在|网页不存在|找不到页面)(?:[\s|·—:!.-]|$)/i;
  if (unavailable.test(titleText) && unavailable.test(heading) && semanticProse.length < 240) {
    throw new ConversionError('The requested page is unavailable or was not found', 'parse_failed');
  }
  const articleProse = Array.from(
    raw.querySelectorAll('article p,[itemprop="articleBody"] p,.post-content p,.entry-content p'),
  )
    .filter((node) => !node.closest('form,nav,footer'))
    .map((node) => normalizedText(node.textContent))
    .join(' ');
  if (
    challenge.test(`${titleText}\n${heading}`) ||
    ((authForm || signInHeading.test(heading || titleText)) &&
      articleProse.length < 60 &&
      (signInHeading.test(heading || titleText) || semanticProse.length < 300))
  ) {
    throw new ConversionError(
      'This page is a verification screen or a login wall. Open it in a browser first.',
      'login_wall',
    );
  }
  const schema = schemaArticle(raw);
  const accessNotice = Array.from(
    raw.querySelectorAll('p,button,[class*="paywall"],[id*="paywall"]'),
  ).some((node) => {
    const text = normalizedText(node.textContent);
    return (
      text.length < 180 &&
      /^(?:subscribe to (?:continue|read)|sign in to (?:continue|read)|purchase (?:access|this article)|订阅后阅读|付费阅读|登录后阅读)/i.test(
        text,
      )
    );
  });
  if (accessNotice && !options.scope) {
    const paragraphs = Array.from(raw.querySelectorAll('article p,[itemprop="articleBody"] p'));
    const prose = paragraphs
      .filter(
        (node) =>
          !/^(?:subscribe|sign in|purchase|订阅|付费|登录)/i.test(normalizedText(node.textContent)),
      )
      .map((node) => normalizedText(node.textContent))
      .join(' ');
    if (prose.length < 240)
      throw new ConversionError(
        'This page is a login wall or subscription preview. Open it in a browser first.',
        'login_wall',
      );
  }
  const doc = extractionDocument(html, baseUrl);
  let candidate: Candidate | undefined;
  const rule = findSiteRule(url);
  if (rule) {
    const node = doc.querySelector(rule.content);
    if (node) {
      const clone = node.cloneNode(true) as Element;
      for (const selector of rule.strip ?? [])
        clone.querySelectorAll(selector).forEach((item) => item.remove());
      const result: Candidate = {
        content: clone.innerHTML,
        element: clone,
        title: rule.title ? doc.querySelector(rule.title)?.textContent : '',
        author: rule.byline ? doc.querySelector(rule.byline)?.textContent : '',
        extractor: `site:${rule.name}`,
        semantic: true,
      };
      if (readable(result)) candidate = result;
    }
  }
  const structuredSelector = 'math,svg,table,[role="doc-footnote"],.footnotes';
  function* semanticCandidates(): Generator<Candidate> {
    for (const selector of SELECTORS) {
      for (const node of Array.from(doc.querySelectorAll(selector)).slice(0, 10)) {
        const clone = node.cloneNode(true) as Element;
        clone
          .querySelectorAll(
            'nav,header,footer,form,button,script,style,template,[role="navigation"],[role="doc-toc"],.toc,.advertisement,.cookie-banner',
          )
          .forEach((item) => item.remove());
        // Aside is also used for author explanations, definitions and accuracy
        // cautions. Only discard an aside that actually consists of navigation.
        clone.querySelectorAll('aside').forEach((aside) => {
          const text = normalizedText(aside.textContent);
          const links = Array.from(aside.querySelectorAll('a')).reduce(
            (sum, link) => sum + normalizedText(link.textContent).length,
            0,
          );
          if (text && links / text.length > 0.8 && !aside.matches('[role^="doc-"]')) aside.remove();
        });
        yield {
          content: clone.innerHTML,
          element: clone,
          extractor: `selector:${selector}`,
          semantic: true,
        };
      }
    }
  }
  let semanticSource: Candidate | undefined;
  if (!candidate)
    for (const result of semanticCandidates()) {
      if (readable(result)) {
        semanticSource = result;
        break;
      }
    }
  // Rich semantic source trees preserve equations, tables and linked notes,
  // and avoid running generic scoring over thousands of scientific nodes.
  if (semanticSource?.element?.querySelector(structuredSelector)) candidate = semanticSource;
  const engines =
    options.preferredExtractor === 'readability'
      ? ['readability', 'defuddle']
      : ['defuddle', 'readability'];
  if (!candidate)
    for (const engine of engines) {
      try {
        const cloned = doc.cloneNode(true) as Document;
        let result: Candidate | undefined;
        if (engine === 'defuddle') {
          const parsed = new Defuddle(cloned, {
            url,
            useAsync: false,
            debug: false,
            removeSmallImages: false,
          }).parse();
          result = {
            content: parsed.content,
            title: parsed.title,
            author: parsed.author,
            extractor: 'defuddle@0.19.6',
          };
        } else {
          const parsed = new Readability(cloned, { keepClasses: true }).parse();
          if (parsed?.content)
            result = {
              content: parsed.content,
              title: parsed.title,
              author: parsed.byline,
              extractor: 'readability',
            };
        }
        if (result && readable(result)) {
          candidate =
            semanticSource && omitsSemanticBlocks(result, semanticSource) ? semanticSource : result;
          break;
        }
      } catch {
        /* a failed engine never prevents local alternatives */
      }
    }
  candidate ??= semanticSource;
  if (!candidate)
    throw new ConversionError('No readable article found in this page', 'parse_failed');
  const abstract = raw.querySelector(
    '#abstract,.abstract,[role="doc-abstract"],[itemprop="abstract"],section[aria-label="Abstract"]',
  );
  const container = raw.querySelector('article,main,[role="article"]') || raw.body;
  const outsideAbstract = abstract
    ? Array.from(container.querySelectorAll('p,pre,table'))
        .filter(
          (node) =>
            !abstract.contains(node) &&
            // Repository record tables and research-tool tabs are not paper
            // prose. Do not exclude generic tabpanels: full HTML papers may
            // legitimately place their body sections in one.
            !node.closest(
              'nav,aside,header,footer,[class*="author"],[class*="metadata"],.metatable,.labstabs',
            ),
        )
        .map((node) => normalizedText(node.textContent))
        .join(' ')
    : '';
  const abstractOnly = Boolean(
    abstract &&
      outsideAbstract.length < 160 &&
      (meta(raw, 'citation_title', 'citation_pdf_url') ||
        /ScholarlyArticle/.test(schemaString(schema?.['@type'])) ||
        /abstract/i.test(abstract.textContent ?? '')),
  );
  const scope = options.scope || (abstractOnly ? 'abstract' : accessNotice ? 'excerpt' : 'article');
  const title =
    meta(raw, 'citation_title', 'og:title', 'twitter:title') ||
    schemaString(schema?.['headline']) ||
    normalizedText(candidate.title) ||
    titleText ||
    heading ||
    fallbackTitle(url);
  const authors = Array.from(raw.querySelectorAll('meta[name="citation_author"]'))
    .map((item) => normalizedText(item.getAttribute('content')))
    .filter(Boolean)
    .join(', ');
  const author =
    authors ||
    meta(raw, 'author', 'dc.creator', 'dcterms.creator', 'article:author') ||
    schemaAuthor(schema?.['author']) ||
    normalizedText(candidate.author);
  return {
    // Keep image source and lazy-load attributes until the bundler resolves
    // their bytes. Strict EPUB sanitization runs after packaging; this value
    // must never be mounted as application UI.
    content: fixLinks(restoreLinkedNotes(candidate.content, doc), url, baseUrl),
    title,
    author,
    baseUrl,
    imageOnly: (() => {
      const body = new DOMParser().parseFromString(candidate.content, 'text/html');
      body.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((node) => node.remove());
      return (
        normalizedText(body.body.textContent).length < 20 &&
        Boolean(body.querySelector('img,picture'))
      );
    })(),
    source: {
      originalUrl: safeSourceUrl(options.originalUrl || url),
      url: safeSourceUrl(url),
      canonicalUrl: httpUrl(raw.querySelector('link[rel~="canonical"]')?.getAttribute('href'), url),
      pdfUrl: httpUrl(meta(raw, 'citation_pdf_url'), url),
      site: meta(raw, 'og:site_name', 'application-name') || undefined,
      published:
        meta(
          raw,
          'citation_publication_date',
          'article:published_time',
          'dc.date',
          'dcterms.issued',
        ) ||
        schemaString(schema?.['datePublished']) ||
        undefined,
      extractor: candidate.extractor,
      version: WEB_EXTRACTOR_VERSION,
      scope,
      captureMethod: options.captureMethod,
    },
  };
}
