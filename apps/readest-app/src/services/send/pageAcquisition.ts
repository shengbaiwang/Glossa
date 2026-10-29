import { isTauriAppPlatform } from '@/services/environment';
import { ConversionError } from './conversion/types';

export const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
type PageFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AcquiredPage =
  | { kind: 'page'; html: string; url: string }
  | { kind: 'file'; file: File; title: string; url: string };

export function validatePageUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new ConversionError('Enter a URL starting with http:// or https://', 'unsupported_type');
  return url.href;
}

async function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauriAppPlatform()) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(input, init);
  }
  return fetch(input, init);
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const hasPdfSignature = (bytes: Uint8Array) =>
  PDF_SIGNATURE.every((byte, index) => bytes[index] === byte);

async function readBounded(
  response: Response,
  signal: AbortSignal,
  sniffPdf: boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get('content-length'));
  // Unknown MIME may be a PDF, but must prove its signature before receiving
  // the larger budget. Reject declarations beyond either possible budget now.
  if (declared > (sniffPdf ? MAX_PDF_BYTES : MAX_PAGE_BYTES)) {
    await response.body?.cancel();
    throw new ConversionError('This page is too large to import', 'fetch_failed');
  }
  if (!response.body) throw new ConversionError('The page returned no content', 'empty_input');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const signature = new Uint8Array(PDF_SIGNATURE.length);
  let signatureSize = 0;
  let limit = sniffPdf ? undefined : MAX_PAGE_BYTES;
  let size = 0;
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        if (declared > (limit ?? MAX_PAGE_BYTES))
          throw new ConversionError('This page is too large to import', 'fetch_failed');
        break;
      }
      if (limit === undefined) {
        const prefix = value.subarray(0, signature.length - signatureSize);
        signature.set(prefix, signatureSize);
        signatureSize += prefix.byteLength;
        if (signatureSize === signature.length)
          limit = hasPdfSignature(signature) ? MAX_PDF_BYTES : MAX_PAGE_BYTES;
      }
      size += value.byteLength;
      if (size > (limit ?? MAX_PAGE_BYTES) || (limit !== undefined && declared > limit)) {
        await reader.cancel();
        throw new ConversionError('This page is too large to import', 'fetch_failed');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Direct acquisition precedes WebView rendering. Bytes and time are bounded;
 *  neither a stalled stream nor an aborted task can publish partial HTML. */
export async function fetchWebPage(
  value: string,
  signal?: AbortSignal,
  fetcher: PageFetch = defaultFetch,
): Promise<AcquiredPage> {
  signal?.throwIfAborted();
  const url = validatePageUrl(value);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('Page request timed out', 'TimeoutError')),
    FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9' },
    });
    controller.signal.throwIfAborted();
    if (!response.ok) {
      await response.body?.cancel();
      throw new ConversionError(
        `Could not fetch this page (HTTP ${response.status})`,
        'fetch_failed',
      );
    }
    const finalUrl = validatePageUrl(response.url || url);
    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    const isPdfType = contentType.includes('application/pdf');
    if (
      contentType &&
      !isPdfType &&
      !/text\/(html|plain)|application\/xhtml\+xml|application\/octet-stream/.test(contentType)
    ) {
      await response.body?.cancel();
      throw new ConversionError(
        'This address does not contain a webpage or PDF',
        'unsupported_type',
      );
    }
    const bytes = await readBounded(
      response,
      controller.signal,
      isPdfType || !contentType || contentType.includes('application/octet-stream'),
    );
    if (hasPdfSignature(bytes)) {
      let name = new URL(finalUrl).pathname.split('/').pop() || 'article';
      try {
        name = decodeURIComponent(name);
      } catch {
        /* retain malformed escaped filenames */
      }
      name = name.replace(/[\u0000-\u001f/\\]/g, '_');
      if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';
      return {
        kind: 'file',
        file: new File([bytes], name, { type: 'application/pdf' }),
        title: name.slice(0, -4),
        url: finalUrl,
      };
    }
    if (isPdfType)
      throw new ConversionError('This address did not return a valid PDF', 'parse_failed');
    const charset =
      contentType.match(/charset\s*=\s*["']?([^\s;"']+)/)?.[1] ||
      new TextDecoder('ascii')
        .decode(bytes.subarray(0, 4096))
        .match(/<meta[^>]+charset\s*=\s*["']?([^\s;"'/>]+)/i)?.[1] ||
      'utf-8';
    let html: string;
    try {
      html = new TextDecoder(charset).decode(bytes);
    } catch {
      html = new TextDecoder().decode(bytes);
    }
    if (!html.trim()) throw new ConversionError('The page returned no content', 'empty_input');
    return { kind: 'page', html, url: finalUrl };
  } catch (error) {
    signal?.throwIfAborted();
    if (controller.signal.aborted)
      throw new ConversionError('The page request timed out', 'fetch_failed');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
