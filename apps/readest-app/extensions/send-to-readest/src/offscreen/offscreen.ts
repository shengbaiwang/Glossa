/** DOM conversion and EPUB storage live here; only JSON metadata crosses MV3 contexts. */
import { configureZip } from '@/utils/zip';
import { convertToEpub } from '@/services/send/conversion/convertToEpub';
import type { ClipErrorCode } from '../lib/messages';
import { uploadEpub } from '../background/upload';

configureZip().catch((err) =>
  console.warn('[send-to-readest/offscreen]', 'configureZip failed', err),
);

interface ClipRequest {
  type: 'send-to-readest:clip-and-upload' | 'send-to-readest:clip-and-download';
  html: string;
  url: string;
  baseUrl?: string;
  pageTitle: string;
  token?: string;
  endpoint?: string;
}

type ClipResponse =
  | {
      ok: true;
      inboxId: string;
      title: string;
      author: string;
      byteSize: number;
      missingAssets: number;
    }
  | { ok: true; url: string; filename: string; missingAssets: number }
  | { ok: true }
  | { ok: false; code: ClipErrorCode; message: string };

const downloads = new Map<string, ReturnType<typeof setTimeout>>();
function release(url: string): void {
  const timer = downloads.get(url);
  if (!timer) return;
  clearTimeout(timer);
  downloads.delete(url);
  URL.revokeObjectURL(url);
}

function filename(title: string): string {
  return `${
    title
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/^\.+|[.\s]+$/g, '')
      .slice(0, 150) || 'Article'
  }.epub`;
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: ClipResponse) => void): boolean => {
    if (!message || typeof message !== 'object') return false;
    const m = message as { type?: string; url?: string };
    if (m.type === 'send-to-readest:ping') {
      sendResponse({ ok: true });
      return false;
    }
    if (m.type === 'send-to-readest:release-download') {
      if (typeof m.url === 'string') release(m.url);
      sendResponse({ ok: true });
      return false;
    }
    if (
      m.type !== 'send-to-readest:clip-and-upload' &&
      m.type !== 'send-to-readest:clip-and-download'
    )
      return false;
    const req = message as ClipRequest;
    void (async (): Promise<void> => {
      let converted;
      try {
        converted = await convertToEpub({
          kind: 'page',
          captureMethod: 'browser',
          html: req.html,
          url: req.url,
          baseUrl: req.baseUrl,
        });
      } catch (err) {
        sendResponse({
          ok: false,
          code: 'no-readable-content',
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      const missingAssets =
        converted.warnings
          ?.filter((warning) => warning.code === 'missing_assets')
          .reduce((total, warning) => total + (warning.count ?? 0), 0) ?? 0;
      try {
        if (req.type === 'send-to-readest:clip-and-download') {
          const url = URL.createObjectURL(converted.file);
          // Expire orphaned URLs even if the SW is reclaimed during a save dialog.
          downloads.set(
            url,
            setTimeout(() => release(url), 10 * 60_000),
          );
          sendResponse({
            ok: true,
            url,
            filename: filename(converted.title || req.pageTitle),
            missingAssets,
          });
          return;
        }
        if (!req.endpoint || !req.token) {
          sendResponse({
            ok: false,
            code: 'not-signed-in',
            message: 'Sign in at web.readest.com first',
          });
          return;
        }
        const result = await uploadEpub({
          endpoint: req.endpoint,
          token: req.token,
          epub: converted.file,
          title: converted.title || req.pageTitle,
          sourceUrl: req.url,
        });
        if (!result.ok) {
          sendResponse({ ok: false, code: result.code, message: result.message });
          return;
        }
        sendResponse({
          ok: true,
          inboxId: result.id,
          title: converted.title,
          author: converted.author,
          byteSize: converted.file.size,
          missingAssets,
        });
      } catch (err) {
        sendResponse({
          ok: false,
          code: 'unknown',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  },
);
