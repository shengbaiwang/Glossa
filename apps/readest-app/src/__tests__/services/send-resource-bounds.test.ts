import { afterEach, describe, expect, test, vi } from 'vitest';
import { readBoundedResponse } from '@/services/send/conversion/boundedResponse';
import { fetchAuthorImage, fetchBestFavicon } from '@/services/send/conversion/faviconFetcher';
import { imageFetchHeaders } from '@/services/send/conversion/httpHeaders';

afterEach(() => vi.restoreAllMocks());
describe('bounded resource reader', () => {
  test('rejects a declared oversized body without consuming it', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-length': '9999999' },
    });
    await expect(readBoundedResponse(response, 1024)).rejects.toThrow('byte limit');
    expect(cancel).toHaveBeenCalled();
  });
  test('returns exact bytes at the limit', async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }),
    );
    expect(new Uint8Array(await readBoundedResponse(response, 4))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });
  test('external cancellation settles a stalled read and cancels the body', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        pull() {
          return new Promise(() => undefined);
        },
        cancel,
      }),
    );
    const ac = new AbortController();
    const operation = readBoundedResponse(response, 1024, ac.signal);
    ac.abort(new Error('User cancelled'));
    await expect(operation).rejects.toThrow('User cancelled');
    expect(cancel).toHaveBeenCalled();
  });
});

test('favicon streaming stops at its smaller byte ceiling, then uses the next candidate', async () => {
  const cancel = vi.fn();
  let chunks = 0;
  const oversized = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          chunks++;
          controller.enqueue(new Uint8Array(128 * 1024));
        },
        cancel,
      },
      { highWaterMark: 0 },
    ),
    { headers: { 'content-type': 'image/png' } },
  );
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(oversized)
    .mockResolvedValue(
      new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } }),
    );
  const doc = new DOMParser().parseFromString(
    '<link rel="icon" href="/declared.png">',
    'text/html',
  );
  const result = await fetchBestFavicon(doc, 'https://example.org/page');
  expect(result?.bytes.byteLength).toBe(2);
  expect(chunks).toBeLessThanOrEqual(5);
  expect(cancel).toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('author image cancellation is propagated to the calling conversion', async () => {
  const cancel = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      new ReadableStream({
        pull() {
          return new Promise(() => undefined);
        },
        cancel,
      }),
      { headers: { 'content-type': 'image/png' } },
    ),
  );
  const ac = new AbortController();
  const operation = fetchAuthorImage(
    'https://example.org/avatar.png',
    'https://example.org/page',
    ac.signal,
  );
  await Promise.resolve();
  await Promise.resolve();
  ac.abort(new Error('Cancelled by user'));
  await expect(operation).rejects.toThrow('Cancelled by user');
});

test('resource headers contain only Accept and a safe HTTP referrer', () => {
  expect(imageFetchHeaders('https://user:password@example.org/article#private')).toEqual({
    accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8',
    referer: 'https://example.org/article',
  });
  expect(imageFetchHeaders('file:///Users/private/article.html')).not.toHaveProperty('referer');
  expect(imageFetchHeaders(null)).not.toHaveProperty('user-agent');
});
