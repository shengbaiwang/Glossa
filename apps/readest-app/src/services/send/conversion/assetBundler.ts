import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';
import { imageFetchHeaders } from './httpHeaders';
import { awaitResource, readBoundedResponse } from './boundedResponse';
import type { EpubImage } from './types';

// On Tauri we go through the Rust HTTP client (no browser-CORS); on web
// we use the native fetch — the bundler is only ever invoked from a
// CORS-free caller there (the browser extension's service worker, which
// has broad `host_permissions`). In the non-Tauri path we set
// `credentials: 'include'` so the browser sends the user's cookies for
// paywalled / member-only CDN hosts — without that, an authenticated
// Substack image returns a placeholder. In Tauri we also fold in the
// resource Accept and page Referer headers without impersonating a browser.
const httpFetch = (url: string, referer: string | null, init?: RequestInit): Promise<Response> => {
  if (!isTauriAppPlatform()) {
    return globalThis.fetch(url, { credentials: 'include', ...init });
  }
  const baseHeaders = imageFetchHeaders(referer);
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(baseHeaders)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return tauriFetch(url, { ...init, headers });
};

/** Per-asset limits picked to keep clipped articles light. */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ASSET_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_CONCURRENCY = 4;
const RESOURCE_PHASE_TIMEOUT_MS = 40_000;

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

/** Attributes that aren't useful in the bundled EPUB. Removed AFTER the URL
 *  has been picked — `srcset` and the `data-*` variants can be the source. */
const STRIP_ATTRS = [
  'loading',
  'decoding',
  'fetchpriority',
  'crossorigin',
  'srcset',
  'data-src',
  'data-original',
  'data-lazy',
  'data-actualsrc',
  'data-srcset',
];

/**
 * Pick the highest-resolution candidate from a `srcset` value. Medium,
 * Substack, NYT and other modern publishers set `src` to a ~60px LQIP
 * placeholder for lazy-loading and put the real image — along with its
 * other responsive variants — in `srcset` with width (`Nw`) or density
 * (`Nx`) descriptors. Picking the largest variant gives the EPUB
 * full-quality images, not blurry placeholders.
 */
function pickLargestFromSrcset(srcset: string): string | null {
  let bestUrl: string | null = null;
  let bestScore = -1;
  for (const entry of srcset.split(',')) {
    const parts = entry.trim().split(/\s+/);
    let url = parts[0] || '';
    if (!url) continue;
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:/i.test(url) && !url.startsWith('/')) continue;
    // No descriptor → score 1 (treat as 1x). Width descriptors (`1280w`)
    // and density descriptors (`2x`) sort naturally on the numeric prefix.
    let score = 1;
    const desc = parts[1];
    if (desc) {
      const m = desc.match(/^(\d+(?:\.\d+)?)([wx])$/i);
      if (m) score = parseFloat(m[1]!);
    }
    if (score > bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }
  return bestUrl;
}

/**
 * Resolve an `<img>` to a fetchable URL, preferring high-resolution
 * variants in `srcset` over what `src` likely contains (a tiny
 * placeholder on lazy-loading sites). Falls back through the common
 * `data-*` lazy-load attribute conventions before giving up.
 */
function pickImgUrl(img: Element): string | null {
  // Prefer srcset — most likely the real, high-res image.
  const srcset = img.getAttribute('srcset');
  if (srcset) {
    const picked = pickLargestFromSrcset(srcset);
    if (picked) return picked;
  }
  const dataSrcset = img.getAttribute('data-srcset');
  if (dataSrcset) {
    const picked = pickLargestFromSrcset(dataSrcset);
    if (picked) return picked;
  }
  // Lazy-load `data-*` attributes (older lazy-loaders / non-srcset CMSes).
  const lazy =
    img.getAttribute('data-src') ||
    img.getAttribute('data-original') ||
    img.getAttribute('data-lazy') ||
    img.getAttribute('data-actualsrc');
  if (lazy && lazy.trim()) return lazy;
  // Fall back to `src` last — on a lazy-loading site this is the LQIP,
  // but on a vanilla site it's the only thing set.
  const direct = img.getAttribute('src');
  if (direct && direct.trim()) return direct;
  return null;
}

/** Resolve a `<picture>`/`<source>` to its highest-resolution image URL.
 *  Takes the first `<source>` that yields a usable URL — `<picture>`
 *  authors order sources by preference, with the largest variant inside
 *  each source's srcset. */
function pickPictureUrl(picture: Element): string | null {
  for (const source of picture.querySelectorAll('source')) {
    const srcset = source.getAttribute('srcset');
    if (srcset) {
      const picked = pickLargestFromSrcset(srcset);
      if (picked) return picked;
    }
    const src = source.getAttribute('src');
    if (src) return src;
  }
  const fallback = picture.querySelector('img');
  return fallback ? pickImgUrl(fallback) : null;
}

function dropElement(el: Element): void {
  el.parentNode?.removeChild(el);
}

/** Hex-encode a `Uint8Array`. ~10× faster than `Array.prototype.map(toString(16))`. */
function hex(bytes: Uint8Array, max = 16): string {
  const out = new Array<string>(max);
  for (let i = 0; i < max && i < bytes.length; i++) {
    out[i] = bytes[i]!.toString(16).padStart(2, '0');
  }
  return out.join('');
}

async function sha256(bytes: ArrayBuffer): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return new Uint8Array(digest);
}

function extFromMime(mime: string, fallbackUrl: string): string {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  if (MIME_TO_EXT[base]) return MIME_TO_EXT[base]!;
  const m = fallbackUrl.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
  return m ? m[1]!.toLowerCase() : 'bin';
}

function mimeFromContentType(contentType: string | null, url: string): string {
  if (contentType) {
    const base = contentType.split(';')[0]!.trim().toLowerCase();
    if (base.startsWith('image/')) return base;
  }
  // Fall back to the URL extension — some CDNs return `application/octet-stream`.
  const m = url.match(/\.(jpe?g|png|gif|webp|svg|avif|bmp)(?:\?|#|$)/i);
  if (m) {
    const e = m[1]!.toLowerCase();
    if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
    if (e === 'svg') return 'image/svg+xml';
    return `image/${e}`;
  }
  return 'application/octet-stream';
}

/**
 * Whether an asset URL is worth a fetch.
 *
 * `http(s):` and `data:` always are. `file:` is the interesting case: an
 * extension page holding "Allow access to file URLs" *can* read local
 * files, which is what lets a page saved with a `<name>_files/` folder keep
 * its images instead of degrading to alt text. That capability is also a
 * disclosure risk, since the EPUB we build gets uploaded, so it is fenced
 * twice:
 *
 *   1. The page being clipped must itself be local. A remote page pointing
 *      an `<img>` at `file:///…` must never cause a disk read.
 *   2. The asset must live under the page's own directory. `new URL` has
 *      already normalized away any `..`, so a prefix test is sufficient to
 *      keep a crafted local page from harvesting the rest of the disk. A
 *      page sitting at the filesystem root gets nothing — its "directory"
 *      is `/`, which would otherwise mean everything.
 */
function isFetchableAssetUrl(url: string, pageUrl: string): boolean {
  if (/^(https?|data):/i.test(url)) return true;
  if (!/^file:/i.test(url)) return false;
  let page: URL;
  let asset: URL;
  try {
    page = new URL(pageUrl);
    asset = new URL(url);
  } catch {
    return false;
  }
  if (page.protocol !== 'file:' || asset.protocol !== 'file:') return false;
  const dir = page.pathname.slice(0, page.pathname.lastIndexOf('/') + 1);
  return dir.length > 1 && asset.pathname.startsWith(dir);
}

interface FetchedAsset {
  url: string;
  path: string;
  bytes: ArrayBuffer;
  mime: string;
}

async function fetchAsset(
  url: string,
  referer: string | null,
  signal?: AbortSignal,
): Promise<FetchedAsset | null> {
  signal?.throwIfAborted();
  const ac = new AbortController();
  const abort = () => ac.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await awaitResource(
      httpFetch(url, referer, { signal: ac.signal, redirect: 'follow' }),
      ac.signal,
    );
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined);
      return null;
    }
    const bytes = await readBoundedResponse(res, MAX_ASSET_BYTES, ac.signal);
    if (bytes.byteLength === 0) return null;
    if (bytes.byteLength > MAX_ASSET_BYTES) return null;
    const mime = mimeFromContentType(res.headers.get('content-type'), url);
    if (!mime.startsWith('image/')) return null;
    const digest = await sha256(bytes);
    const ext = extFromMime(mime, url);
    const path = `images/${hex(digest, 16)}.${ext}`;
    return { url, path, bytes, mime };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export interface BundleAssetsResult {
  /** Rewritten HTML with `<img src>` pointing at the inlined paths. */
  html: string;
  /** Image resources to embed in the EPUB. */
  images: EpubImage[];
  /** Number of references that could not be fetched (404, timeout, oversize). */
  missing: number;
  /** Original resource URLs retained only in the generated article/source metadata. */
  missingResources: string[];
}

/**
 * Walk an extracted-article HTML fragment, fetch every referenced image under
 * the page's own session (cookies, real UA — only safe to call from a context
 * with CORS bypassed, i.e. Tauri webview or browser-extension content script),
 * and return a rewritten HTML fragment plus the inlined image resources.
 *
 * Honours lazy-load attribute conventions (`data-src`, `data-original`,
 * `data-srcset`, `srcset`). Drops `<iframe>`/`<video>`/`<audio>`/`<embed>`/
 * `<object>` entirely. Keeps inline `<svg>` as-is. A failed fetch becomes an
 * alt-text placeholder so the EPUB still builds.
 */
export async function bundleAssets(
  contentHtml: string,
  pageUrl: string,
  signal?: AbortSignal,
  resourceSignal?: AbortSignal,
  assetBaseUrl: string = pageUrl,
): Promise<BundleAssetsResult> {
  const doc = new DOMParser().parseFromString(`<div id="root">${contentHtml}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return { html: contentHtml, images: [], missing: 0, missingResources: [] };

  // Drop unrenderable / blocking media before walking.
  for (const el of Array.from(root.querySelectorAll('iframe, video, audio, embed, object'))) {
    dropElement(el);
  }

  // Pick every fetchable image URL.
  const targets: { el: Element; url: string }[] = [];
  for (const picture of Array.from(root.querySelectorAll('picture'))) {
    const url = pickPictureUrl(picture);
    if (!url) {
      dropElement(picture);
      continue;
    }
    // Flatten <picture> to a plain <img> so the rewritten HTML resolves
    // against the in-EPUB path without needing <source> entries the EPUB
    // reader probably doesn't honour.
    const img = doc.createElement('img');
    const alt = picture.querySelector('img')?.getAttribute('alt') ?? '';
    if (alt) img.setAttribute('alt', alt);
    picture.replaceWith(img);
    let abs: string;
    try {
      abs = new URL(url, assetBaseUrl).toString();
    } catch {
      dropElement(img);
      continue;
    }
    targets.push({ el: img, url: abs });
  }
  for (const img of Array.from(root.querySelectorAll('img'))) {
    if (targets.some((t) => t.el === img)) {
      // Already queued via <picture>. Just clean up noise attrs.
      for (const attr of STRIP_ATTRS) img.removeAttribute(attr);
      continue;
    }
    const url = pickImgUrl(img);
    // Strip noise attrs AFTER picking — srcset / data-* may be the source.
    for (const attr of STRIP_ATTRS) img.removeAttribute(attr);
    if (!url) {
      dropElement(img);
      continue;
    }
    let abs: string;
    try {
      abs = new URL(url, assetBaseUrl).toString();
    } catch {
      dropElement(img);
      continue;
    }
    // Tiny tracking pixels: cheap to spot ahead of the fetch.
    if (img.getAttribute('width') === '1' && img.getAttribute('height') === '1') {
      dropElement(img);
      continue;
    }
    targets.push({ el: img, url: abs });
  }

  // Dedupe by URL so a hero shared by `<picture>` and `<img>` only fetches once.
  const urlToTargets = new Map<string, Element[]>();
  for (const { el, url } of targets) {
    const list = urlToTargets.get(url) ?? [];
    list.push(el);
    urlToTargets.set(url, list);
  }

  const uniqueUrls = Array.from(urlToTargets.keys());
  console.log('[clip/bundle] start', {
    unique_urls: uniqueUrls.length,
  });
  const fetched = new Map<string, FetchedAsset>();
  let totalBytes = 0;
  let missing = 0;
  const missingResources: string[] = [];
  const phase = new AbortController();
  const abortPhase = (): void => phase.abort(signal?.reason);
  signal?.addEventListener('abort', abortPhase, { once: true });
  const deadlineReached = (): void => phase.abort();
  resourceSignal?.addEventListener('abort', deadlineReached, { once: true });
  if (resourceSignal?.aborted) deadlineReached();
  const phaseTimer = setTimeout(() => phase.abort(), RESOURCE_PHASE_TIMEOUT_MS);

  // At most four unresolved or uncommitted assets exist at once. Advancing
  // this window only after the oldest result is committed keeps a slow first
  // image from accumulating every later response. Budget decisions remain in
  // document order, independent of network completion order.
  const pending = new Map<number, Promise<FetchedAsset | null>>();
  let nextIndex = 0;
  const fillWindow = (): void => {
    while (
      pending.size < MAX_CONCURRENCY &&
      nextIndex < uniqueUrls.length &&
      totalBytes < MAX_TOTAL_ASSET_BYTES &&
      !phase.signal.aborted
    ) {
      const index = nextIndex++;
      const url = uniqueUrls[index]!;
      const operation = (async (): Promise<FetchedAsset | null> => {
        signal?.throwIfAborted();
        if (!isFetchableAssetUrl(url, pageUrl)) return null;
        try {
          return await fetchAsset(url, pageUrl, phase.signal);
        } catch {
          signal?.throwIfAborted();
          // URLs can contain private paths or signed query strings, and
          // upstream exception messages may echo them or response content.
          console.warn('[clip/bundle] image fetch failed');
          return null;
        }
      })();
      void operation.catch(() => undefined);
      pending.set(index, operation);
    }
  };
  try {
    fillWindow();
    for (let i = 0; i < uniqueUrls.length; i++) {
      signal?.throwIfAborted();
      const asset = await pending.get(i);
      pending.delete(i);
      if (!asset || totalBytes + asset.bytes.byteLength > MAX_TOTAL_ASSET_BYTES) {
        missing++;
        missingResources.push(uniqueUrls[i]!);
      } else {
        fetched.set(uniqueUrls[i]!, asset);
        totalBytes += asset.bytes.byteLength;
      }
      fillWindow();
    }
    signal?.throwIfAborted();
  } finally {
    clearTimeout(phaseTimer);
    signal?.removeEventListener('abort', abortPhase);
    resourceSignal?.removeEventListener('abort', deadlineReached);
    phase.abort();
  }
  console.log('[clip/bundle] done', {
    fetched: fetched.size,
    missing,
    total_bytes: totalBytes,
  });

  // Rewrite successful resources and retain a source link in each missing image position.
  const images: EpubImage[] = [];
  const seenPaths = new Set<string>();
  for (const [url, els] of urlToTargets) {
    const asset = fetched.get(url);
    if (!asset) {
      for (const el of els) {
        const link = doc.createElement('a');
        if (/^https?:/i.test(url)) link.href = url;
        link.textContent = el.getAttribute('alt') || 'Image unavailable';
        link.className = 'missing-image';
        el.replaceWith(link);
      }
      continue;
    }
    if (!seenPaths.has(asset.path)) {
      images.push({ path: asset.path, bytes: asset.bytes, mime: asset.mime });
      seenPaths.add(asset.path);
    }
    for (const el of els) {
      el.setAttribute('src', asset.path);
    }
  }

  return { html: root.innerHTML, images, missing, missingResources };
}
