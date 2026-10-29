/**
 * Spawn an offscreen document the first time the SW needs to convert a
 * page, then reuse it for the lifetime of the SW. Closing it costs ~30 ms
 * on the next clip, so we let it sit idle — Chrome reclaims it when the
 * SW itself shuts down.
 *
 * The offscreen page exists because MV3 service workers don't expose
 * `DOMParser` / `Document`, which the shared `convertPageToEpub` relies
 * on (Readability, asset bundler, heading extractor, etc.). It also
 * retains the EPUB for local download or performs the explicit cloud upload — we avoid sending the EPUB bytes back to the
 * SW because `chrome.runtime.sendMessage` does not reliably structured-
 * clone `ArrayBuffer` between extension contexts; the bytes come through
 * JSON-serialized as `{}`, which wrapped in `new Blob([{}])` becomes the
 * literal text "[object Object]" — exactly what the inbox drainer was
 * rejecting as a corrupt EPUB.
 */

import type { ClipErrorCode } from '../lib/messages';
import { translate as _ } from '../lib/i18n';
import { resolveUploadEndpoint } from './upload';

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

let ensurePromise: Promise<void> | null = null;

async function offscreenDocumentExists(): Promise<boolean> {
  const off = chrome.offscreen as typeof chrome.offscreen & {
    hasDocument?: () => Promise<boolean>;
  };
  if (off?.hasDocument) {
    try {
      return await off.hasDocument();
    } catch {
      /* fall through */
    }
  }
  const runtime = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (filter: { contextTypes: string[] }) => Promise<unknown[]>;
  };
  if (runtime.getContexts) {
    const contexts = await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return contexts.length > 0;
  }
  return false;
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await offscreenDocumentExists()) {
    await waitForOffscreenReady();
    return;
  }
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async (): Promise<void> => {
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification:
          'Parse and convert the captured page HTML to a self-contained EPUB, then save locally or explicitly upload to the user inbox. The MV3 service worker has no DOMParser, and EPUB bytes do not survive runtime.sendMessage serialization between contexts.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Race: another caller created it in the meantime. Harmless.
      if (!/single offscreen document/i.test(message)) {
        throw err;
      }
    } finally {
      ensurePromise = null;
    }
    // The offscreen page may finish executing slightly after
    // `createDocument` resolves; poll for its `ping` reply so the first
    // real message never lands on a not-yet-listening page.
    await waitForOffscreenReady();
  })();
  return ensurePromise;
}

async function waitForOffscreenReady(): Promise<void> {
  // ~4 seconds of polling — well over the wall-clock cost of script
  // execution. `setTimeout` keeps the SW awake while waiting.
  for (let i = 0; i < 40; i++) {
    try {
      const reply = (await chrome.runtime.sendMessage({ type: 'send-to-readest:ping' })) as
        | { ok?: boolean }
        | undefined;
      if (reply?.ok) return;
    } catch {
      /* offscreen not up yet — retry */
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(_('Offscreen page failed to start'));
}

export interface ClipAndUploadResult {
  inboxId: string;
  title: string;
  author: string;
  byteSize: number;
  missingAssets?: number;
}

export interface ClipAndDownloadResult {
  url: string;
  filename: string;
  missingAssets?: number;
}

interface ClipInput {
  html: string;
  url: string;
  baseUrl?: string;
  pageTitle: string;
}

export interface ClipAndUploadFailure {
  code: ClipErrorCode;
  message: string;
}

type Outcome<T> = { ok: true; result: T } | { ok: false; failure: ClipAndUploadFailure };
const CLIP_TIMEOUT_MS = 90_000;

async function requestConversion<T>(request: Record<string, unknown>): Promise<Outcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await ensureOffscreenDocument();
    const response = (await Promise.race([
      chrome.runtime.sendMessage(request),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(resolve, CLIP_TIMEOUT_MS);
      }),
    ])) as ({ ok: true } & T) | ({ ok: false } & ClipAndUploadFailure) | undefined;
    if (!response)
      return {
        ok: false,
        failure: {
          code: 'unknown',
          message: _('Conversion timed out after {seconds}s', { seconds: CLIP_TIMEOUT_MS / 1000 }),
        },
      };
    if (!response.ok)
      return { ok: false, failure: { code: response.code, message: response.message } };
    const { ok: _ok, ...result } = response;
    return { ok: true, result: result as T };
  } catch (err) {
    return {
      ok: false,
      failure: { code: 'unknown', message: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Cloud mode is explicit; EPUB bytes and upload remain in the offscreen realm. */
export async function clipAndUploadViaOffscreen(
  opts: ClipInput & { token: string },
): Promise<Outcome<ClipAndUploadResult>> {
  const endpoint = await resolveUploadEndpoint();
  return requestConversion<ClipAndUploadResult>({
    type: 'send-to-readest:clip-and-upload',
    ...opts,
    endpoint,
  });
}

/** Local mode never reads credentials or resolves the cloud endpoint. */
export async function clipAndDownloadViaOffscreen(
  opts: ClipInput,
): Promise<Outcome<ClipAndDownloadResult>> {
  return requestConversion<ClipAndDownloadResult>({
    type: 'send-to-readest:clip-and-download',
    ...opts,
  });
}

export async function releaseDownloadUrl(url: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'send-to-readest:release-download', url });
}
