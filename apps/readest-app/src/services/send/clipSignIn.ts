/** Acquisition and recovery shared by URL import and native ingress. */

import { invoke } from '@tauri-apps/api/core';
import type { AppService } from '@/types/system';
import { eventDispatcher } from '@/utils/event';
import { getClipOptions } from './clipOptions';
import { ConversionError, type ConvertedBook } from './conversion/types';
import { fetchWebPage } from './pageAcquisition';

type Translate = (key: string) => string;

/** Sync event consumed by `ClipSignInAlert`. Detail: `{ url, respond }`. */
export const CLIP_SIGNIN_CONFIRM_EVENT = 'clip-signin-confirm';

/** Native cancel message from both mobile controllers — a user closing the
 *  interactive capture is not an error, so callers stay quiet on it. */
const CLIP_CANCELLED_MESSAGE = 'Capture cancelled';

export interface ClipRecovery {
  code: 'login_wall' | 'parse_failed' | 'fetch_failed';
  message: string;
}

export interface ClipTaskOptions {
  signal?: AbortSignal;
  onStage?: (stage: string) => void;
  onRecovery?: (reason: ClipRecovery, signal?: AbortSignal) => Promise<boolean>;
}

interface PageCapture {
  html: string;
  finalUrl: string;
  baseUrl: string;
  selection?: boolean;
}

async function capturePage(
  url: string,
  _: Translate,
  interactive: boolean,
  signal?: AbortSignal,
): Promise<PageCapture> {
  signal?.throwIfAborted();
  const taskId = crypto.randomUUID();
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      void invoke('cancel_clip', { taskId }).catch(() => {});
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    const result = await Promise.race([
      invoke<PageCapture>('clip_page', {
        url,
        taskId,
        options: { ...getClipOptions(_), interactive },
      }),
      cancelled,
    ]);
    signal?.throwIfAborted();
    if (
      !result ||
      typeof result.html !== 'string' ||
      typeof result.finalUrl !== 'string' ||
      typeof result.baseUrl !== 'string'
    )
      throw new ConversionError('Could not capture this page', 'parse_failed');
    for (const value of [result.finalUrl, result.baseUrl]) {
      if (!['http:', 'https:'].includes(new URL(value).protocol))
        throw new ConversionError('Could not capture this page', 'parse_failed');
    }
    return result;
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

export function isClipCancelled(err: unknown): boolean {
  // Tauri `invoke` rejects with the raw string from the native side; our own
  // wrappers throw Error objects. Accept both shapes.
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return message === CLIP_CANCELLED_MESSAGE;
}

export async function clipPageToBook(
  url: string,
  _: Translate,
  interactive = false,
  task: ClipTaskOptions = {},
): Promise<ConvertedBook> {
  task.signal?.throwIfAborted();
  task.onStage?.('Loading article…');
  const { convertToEpubWithWorker } = await import('./conversion/conversionWorker');
  task.signal?.throwIfAborted();
  if (!interactive) {
    try {
      const page = await fetchWebPage(url, task.signal);
      task.signal?.throwIfAborted();
      if (page.kind === 'file')
        return {
          file: page.file,
          title: page.title,
          author: '',
          webSource: { originalUrl: url, url: page.url },
        };
      task.onStage?.('Preparing article…');
      const book = await convertToEpubWithWorker({
        kind: 'page',
        html: page.html,
        url: page.url,
        originalUrl: url,
        captureMethod: 'http',
        onStage: task.onStage,
        ...(task.signal ? { signal: task.signal } : {}),
      });
      task.signal?.throwIfAborted();
      return book;
    } catch (error) {
      task.signal?.throwIfAborted();
      if (error instanceof ConversionError && error.code === 'unsupported_type') throw error;
      // HTML shells and unauthenticated responses get one rendered attempt.
    }
  }
  task.onStage?.(interactive ? 'Open the page, then capture' : 'Loading dynamic page…');
  const capture = await capturePage(url, _, interactive, task.signal);
  task.signal?.throwIfAborted();
  task.onStage?.('Preparing article…');
  const book = await convertToEpubWithWorker({
    kind: 'page',
    html: capture.html,
    url: capture.finalUrl,
    originalUrl: url,
    baseUrl: capture.baseUrl,
    captureMethod: capture.selection ? 'selection' : 'webview',
    onStage: task.onStage,
    ...(capture.selection ? { scope: 'excerpt' as const } : {}),
    ...(task.signal ? { signal: task.signal } : {}),
  });
  task.signal?.throwIfAborted();
  return book;
}

/** Ask the mounted `ClipSignInAlert` whether to open the page for a manual
 *  sign-in + capture. Resolves false when no confirm UI is mounted. */
function confirmClipSignIn(
  url: string,
  signal?: AbortSignal,
  reason?: ClipRecovery,
): Promise<boolean> {
  return new Promise((resolve) => {
    const respond = (value: boolean) => {
      signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const abort = () => respond(false);
    if (signal?.aborted) {
      respond(false);
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    const handled = eventDispatcher.dispatchSync(CLIP_SIGNIN_CONFIRM_EVENT, {
      url,
      respond,
      signal,
      reason,
    });
    if (!handled) respond(false);
  });
}

/**
 * Clip `url` and convert it to a book. Insufficient content or a login wall
 * offers one user-controlled rendered capture on desktop and mobile.
 * Declining (or having no confirm UI mounted) rethrows the original error;
 * cancelling the interactive capture rejects with the native
 * "Capture cancelled" message — check `isClipCancelled` to stay quiet.
 */
export async function clipPageWithSignInFallback(
  url: string,
  _: Translate,
  appService: AppService | null,
  task: ClipTaskOptions = {},
): Promise<ConvertedBook> {
  try {
    return await clipPageToBook(url, _, false, task);
  } catch (err) {
    task.signal?.throwIfAborted();
    if (isClipCancelled(err) || !appService) throw err;
    if (
      err instanceof ConversionError &&
      !['login_wall', 'parse_failed', 'fetch_failed', 'empty_input'].includes(err.code)
    )
      throw err;
    const reason: ClipRecovery = {
      code:
        err instanceof ConversionError && err.code === 'login_wall'
          ? 'login_wall'
          : err instanceof ConversionError && err.code === 'parse_failed'
            ? 'parse_failed'
            : 'fetch_failed',
      message: err instanceof Error ? err.message : String(err),
    };
    const confirmed = task.onRecovery
      ? await task.onRecovery(reason, task.signal)
      : await confirmClipSignIn(url, task.signal, reason);
    if (!confirmed) throw err;
    task.signal?.throwIfAborted();
    return await clipPageToBook(url, _, true, task);
  }
}
