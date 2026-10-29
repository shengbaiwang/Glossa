/**
 * Message protocol between popup, service worker, and content script. Keep
 * shapes flat and JSON-serializable — `chrome.runtime.sendMessage` can't carry
 * Blobs, Files, or non-plain objects across boundaries.
 *
 * The content script's job has been reduced to a page snapshot: it grabs
 * the rendered `outerHTML`, current URL, and document base URI and hands those off to the SW,
 * which delegates everything (Readability, asset bundle, cover, TOC, EPUB
 * build) to the shared `convertPageToEpub` in `src/services/send/conversion/`.
 * The extension and application use the same extraction and packaging rules;
 * their captured page content may differ.
 */

export interface PageSnapshot {
  /** Current page URL. Canonical metadata must not change relative asset resolution. */
  sourceUrl: string;
  baseUrl?: string;
  /** `document.title` — used only as a popup display fallback; the
   *  shared converter re-extracts the real title from the captured HTML. */
  pageTitle: string;
  /** Full rendered `document.documentElement.outerHTML`. */
  html: string;
}

export type ClipProgress =
  | { phase: 'capturing' }
  | { phase: 'converting' }
  | { phase: 'uploading' }
  | { phase: 'downloading' }
  | { phase: 'done'; delivery?: 'download' | 'cloud'; missingAssets?: number }
  | { phase: 'error'; code: ClipErrorCode; message: string };

export type ClipErrorCode =
  | 'no-active-tab'
  | 'restricted-page'
  | 'not-signed-in'
  | 'session-expired'
  | 'inbox-full'
  | 'capture-failed'
  | 'no-readable-content'
  | 'network-error'
  | 'server-error'
  | 'unknown';

/** popup → service worker */
export interface ClipRequest {
  type: 'send-to-readest:clip';
  tabId: number;
  /** Legacy requests retain explicit cloud behavior. Popup defaults to local download. */
  delivery?: 'download' | 'cloud';
}

/** service worker → popup (broadcast updates) */
export interface ClipProgressMessage {
  type: 'send-to-readest:progress';
  progress: ClipProgress;
}

/** popup → service worker: get current state on popup (re-)open. */
export interface StatusRequest {
  type: 'send-to-readest:status';
}

export interface StatusResponse {
  signedIn: boolean;
  inFlight: boolean;
  lastProgress: ClipProgress | null;
}
