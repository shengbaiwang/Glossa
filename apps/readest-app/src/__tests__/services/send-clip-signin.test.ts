import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('@/services/send/clipOptions', () => ({ getClipOptions: () => ({}) }));
vi.mock('@/services/send/pageAcquisition', () => ({ fetchWebPage: vi.fn() }));
vi.mock('@/services/send/conversion/conversionWorker', () => ({
  convertToEpubWithWorker: vi.fn(),
}));

import { convertPageToEpub } from '@/services/send/conversion/convertToEpub';
import { convertToEpubWithWorker } from '@/services/send/conversion/conversionWorker';
import { ConversionError } from '@/services/send/conversion/types';
import {
  clipPageWithSignInFallback,
  isClipCancelled,
  CLIP_SIGNIN_CONFIRM_EVENT,
} from '@/services/send/clipSignIn';
import { eventDispatcher } from '@/utils/event';
import { fetchWebPage } from '@/services/send/pageAcquisition';
import type { AppService } from '@/types/system';

const _ = (k: string) => k;
const mobileAppService = { isMobileApp: true } as AppService;
const desktopAppService = { isMobileApp: false } as AppService;

// A paywall preview has explicit restriction evidence, independent of length.
const LOGIN_WALL_HTML = `<!doctype html>
<html lang="en">
  <head><title>At Sears, a Warring-Divisions Model</title></head>
  <body>
    <article>
      <h1>At Sears, a Warring-Divisions Model Adds to the Troubles</h1>
      <p>Eddie Lampert runs Sears like a hedge fund portfolio, with dozens of
      autonomous units competing for capital and attention.</p>
      <p>Subscribe to continue reading this article.</p>
    </article>
  </body>
</html>`;

describe('convertPageToEpub login-wall detection', () => {
  it('throws a ConversionError with the login_wall code for paywall stubs', async () => {
    const err = await convertPageToEpub(LOGIN_WALL_HTML, 'https://example.com/article').then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(ConversionError);
    expect((err as ConversionError).code).toBe('login_wall');
  });
});

describe('clipPageWithSignInFallback', () => {
  const convertMock = vi.mocked(convertToEpubWithWorker);
  const loginWall = () => new ConversionError('login wall', 'login_wall');
  const book = { file: new File(['x'], 'a.epub'), title: 'A', author: '' };

  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue({
      html: '<html>stub</html>',
      finalUrl: 'https://example.com/final',
      baseUrl: 'https://example.com/assets/',
    });
    vi.mocked(fetchWebPage).mockReset().mockRejectedValue(new Error('HTTP unavailable'));
    convertMock.mockReset();
  });

  it('retries with interactive clip when the user confirms sign-in', async () => {
    convertMock.mockRejectedValueOnce(loginWall()).mockResolvedValueOnce(book);
    const onConfirm = vi.fn((event: CustomEvent) => {
      const { respond } = event.detail as { url: string; respond: (ok: boolean) => void };
      respond(true);
      return true;
    });
    eventDispatcher.onSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    try {
      const result = await clipPageWithSignInFallback('https://example.com/a', _, mobileAppService);
      expect(result).toBe(book);
      expect(invokeMock).toHaveBeenCalledTimes(2);
      const secondOptions = invokeMock.mock.calls[1]![1] as { options: { interactive?: boolean } };
      expect(secondOptions.options.interactive).toBe(true);
    } finally {
      eventDispatcher.offSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    }
  });

  it('rethrows the login-wall error when the user declines', async () => {
    convertMock.mockRejectedValueOnce(loginWall());
    const onConfirm = vi.fn((event: CustomEvent) => {
      const { respond } = event.detail as { respond: (ok: boolean) => void };
      respond(false);
      return true;
    });
    eventDispatcher.onSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    try {
      await expect(
        clipPageWithSignInFallback('https://example.com/a', _, mobileAppService),
      ).rejects.toMatchObject({ code: 'login_wall' });
      expect(invokeMock).toHaveBeenCalledTimes(1);
    } finally {
      eventDispatcher.offSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    }
  });

  it('rethrows without prompting when no confirm UI is mounted', async () => {
    convertMock.mockRejectedValueOnce(loginWall());
    await expect(
      clipPageWithSignInFallback('https://example.com/a', _, mobileAppService),
    ).rejects.toMatchObject({ code: 'login_wall' });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('offers interactive capture on desktop too', async () => {
    convertMock.mockRejectedValueOnce(loginWall()).mockResolvedValueOnce(book);
    const onConfirm = vi.fn((event: CustomEvent) => {
      event.detail.respond(true);
      return true;
    });
    eventDispatcher.onSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    try {
      expect(await clipPageWithSignInFallback('https://example.com/a', _, desktopAppService)).toBe(
        book,
      );
      expect(onConfirm).toHaveBeenCalledOnce();
    } finally {
      eventDispatcher.offSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    }
  });

  it('keeps unsupported inputs out of interactive recovery', async () => {
    convertMock.mockRejectedValueOnce(new ConversionError('nope', 'unsupported_type'));
    const onConfirm = vi.fn(() => true);
    eventDispatcher.onSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    try {
      await expect(
        clipPageWithSignInFallback('https://example.com/a', _, mobileAppService),
      ).rejects.toMatchObject({ code: 'unsupported_type' });
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      eventDispatcher.offSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirm);
    }
  });

  it('uses direct HTTP before opening a native window and keeps redirect metadata', async () => {
    vi.mocked(fetchWebPage).mockResolvedValueOnce({
      kind: 'page',
      html: '<article>direct</article>',
      url: 'https://example.com/new',
    });
    convertMock.mockResolvedValueOnce(book);
    expect(await clipPageWithSignInFallback('https://example.com/old', _, desktopAppService)).toBe(
      book,
    );
    expect(invokeMock).not.toHaveBeenCalled();
    expect(convertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/new',
        originalUrl: 'https://example.com/old',
      }),
    );
  });

  it('falls back from an unusable HTTP shell to the rendered page', async () => {
    vi.mocked(fetchWebPage).mockResolvedValueOnce({
      kind: 'page',
      html: '<main></main>',
      url: 'https://example.com/a',
    });
    convertMock
      .mockRejectedValueOnce(new ConversionError('shell', 'parse_failed'))
      .mockResolvedValueOnce(book);
    expect(await clipPageWithSignInFallback('https://example.com/a', _, desktopAppService)).toBe(
      book,
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'clip_page',
      expect.objectContaining({ taskId: expect.any(String) }),
    );
    expect(convertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: 'https://example.com/final',
        baseUrl: 'https://example.com/assets/',
      }),
    );
  });

  it('retains original and redirected sources without rewriting a direct PDF', async () => {
    const file = new File(['%PDF-1.7\noriginal fixture'], 'paper.pdf');
    vi.mocked(fetchWebPage).mockResolvedValueOnce({
      kind: 'file',
      file,
      title: 'paper',
      url: 'https://cdn.example.com/paper.pdf',
    });
    const result = await clipPageWithSignInFallback(
      'https://example.com/download',
      _,
      desktopAppService,
    );
    expect(result.file).toBe(file);
    expect(result.webSource).toEqual({
      originalUrl: 'https://example.com/download',
      url: 'https://cdn.example.com/paper.pdf',
    });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(convertMock).not.toHaveBeenCalled();
  });

  it('requests inline recovery and marks a manual selection as an excerpt', async () => {
    convertMock
      .mockRejectedValueOnce(new ConversionError('shell', 'parse_failed'))
      .mockResolvedValueOnce(book);
    invokeMock
      .mockResolvedValueOnce({
        html: '<main>shell</main>',
        finalUrl: 'https://example.com/a',
        baseUrl: 'https://example.com/',
      })
      .mockResolvedValueOnce({
        html: '<article>selected</article>',
        finalUrl: 'https://example.com/a',
        baseUrl: 'https://example.com/',
        selection: true,
      });
    const onRecovery = vi.fn().mockResolvedValue(true);
    expect(
      await clipPageWithSignInFallback('https://example.com/a', _, desktopAppService, {
        onRecovery,
      }),
    ).toBe(book);
    expect(onRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'parse_failed' }),
      undefined,
    );
    expect(convertMock).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'excerpt' }));
  });
});

describe('isClipCancelled', () => {
  it('recognizes the native cancel message in both Tauri reject shapes', () => {
    // Tauri `invoke` rejects with the raw string from the native side.
    expect(isClipCancelled('Capture cancelled')).toBe(true);
    expect(isClipCancelled(new Error('Capture cancelled'))).toBe(true);
    expect(isClipCancelled('Page took too long to load')).toBe(false);
    expect(isClipCancelled(undefined)).toBe(false);
  });
});

it('cancels the actual native task and does not convert a late capture', async () => {
  vi.mocked(fetchWebPage).mockRejectedValueOnce(new Error('HTTP unavailable'));
  let finish!: (value: unknown) => void;
  invokeMock
    .mockReset()
    .mockResolvedValue(undefined)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  vi.mocked(convertToEpubWithWorker).mockClear();
  const controller = new AbortController();
  const pending = clipPageWithSignInFallback('https://example.com/a', _, desktopAppService, {
    signal: controller.signal,
  });
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('clip_page', expect.any(Object)));
  controller.abort();
  await rejection;
  expect(invokeMock).toHaveBeenCalledWith('cancel_clip', { taskId: expect.any(String) });
  finish({
    html: '<html>late</html>',
    finalUrl: 'https://example.com/a',
    baseUrl: 'https://example.com/',
  });
  expect(convertToEpubWithWorker).not.toHaveBeenCalled();
});
