import { expect, it, vi } from 'vitest';
import { fetchWebPage, MAX_PAGE_BYTES } from '@/services/send/pageAcquisition';

it('keeps the redirect destination and decodes declared legacy charset', async () => {
  const response = new Response(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]), {
    headers: { 'content-type': 'text/html; charset=gbk' },
  });
  Object.defineProperty(response, 'url', { value: 'https://example.org/final/article' });
  const fetcher = vi.fn().mockResolvedValue(response);
  const result = await fetchWebPage('https://example.org/old', undefined, fetcher);
  expect(result).toMatchObject({
    kind: 'page',
    html: '你好',
    url: 'https://example.org/final/article',
  });
});

it('stops oversized streaming bodies rather than reading them all', async () => {
  const cancel = vi.fn();
  let reads = 0;
  const stream = new ReadableStream({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(MAX_PAGE_BYTES / 2));
    },
    cancel,
  });
  await expect(
    fetchWebPage(
      'https://example.org',
      undefined,
      vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/html' } })),
    ),
  ).rejects.toMatchObject({ code: 'fetch_failed' });
  expect(cancel).toHaveBeenCalled();
  expect(reads).toBeLessThan(6);
});

it('routes actual PDF content to the existing file import contract', async () => {
  const result = await fetchWebPage(
    'https://example.org/paper',
    undefined,
    vi.fn().mockResolvedValue(
      new Response('%PDF-1.7\noriginal fixture', {
        headers: { 'content-type': 'application/pdf' },
      }),
    ),
  );
  expect(result.kind).toBe('file');
  if (result.kind === 'file') {
    expect(result.file.type).toBe('application/pdf');
    expect(result.file.name).toMatch(/\.pdf$/);
  }
});

it('rejects a successful HTTP response containing a non-page payload', async () => {
  await expect(
    fetchWebPage(
      'https://example.org',
      undefined,
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"not":"an article"}', { headers: { 'content-type': 'application/json' } }),
        ),
    ),
  ).rejects.toMatchObject({ code: 'unsupported_type' });
});

it('cancels a stalled stream promptly and never returns partial content', async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([60]));
    },
    cancel,
  });
  const pending = fetchWebPage(
    'https://example.org',
    controller.signal,
    vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/html' } })),
  );
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(stream.locked).toBe(true));
  controller.abort();
  await rejection;
  expect(cancel).toHaveBeenCalled();
});

it.each([
  undefined,
  'application/octet-stream',
])('accepts a PDF larger than the HTML limit with content type %s after sniffing split signature bytes', async (contentType) => {
  const size = MAX_PAGE_BYTES + 6;
  const headers = new Headers({ 'content-length': String(size) });
  if (contentType) headers.set('content-type', contentType);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('%P'));
      controller.enqueue(new TextEncoder().encode('DF-'));
      controller.enqueue(new Uint8Array(size - 5));
      controller.close();
    },
  });
  const result = await fetchWebPage(
    'https://example.org/paper',
    undefined,
    vi.fn().mockResolvedValue(new Response(stream, { headers })),
  );
  expect(result.kind).toBe('file');
  if (result.kind === 'file') expect(result.file.size).toBe(size);
});

it('rejects a declared body above the PDF limit without reading it', async () => {
  const pull = vi.fn();
  const cancel = vi.fn();
  const stream = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
  await expect(
    fetchWebPage(
      'https://example.org/paper',
      undefined,
      vi
        .fn()
        .mockResolvedValue(
          new Response(stream, { headers: { 'content-length': String(64 * 1024 * 1024 + 1) } }),
        ),
    ),
  ).rejects.toMatchObject({ code: 'fetch_failed' });
  expect(pull).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalled();
});

it('keeps the HTML limit for untyped non-PDF content after sniffing', async () => {
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    controller.enqueue(new TextEncoder().encode('<html'));
  });
  const stream = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
  await expect(
    fetchWebPage(
      'https://example.org/article',
      undefined,
      vi
        .fn()
        .mockResolvedValue(
          new Response(stream, { headers: { 'content-length': String(MAX_PAGE_BYTES + 1) } }),
        ),
    ),
  ).rejects.toMatchObject({ code: 'fetch_failed' });
  expect(pull.mock.calls.length).toBeLessThanOrEqual(1);
  expect(cancel).toHaveBeenCalled();
});

it('times out a stalled unknown-type PDF signature without returning partial bytes', async () => {
  vi.useFakeTimers();
  try {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('%PD'));
      },
      cancel,
    });
    const pending = fetchWebPage(
      'https://example.org/paper',
      undefined,
      vi.fn().mockResolvedValue(new Response(stream)),
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'fetch_failed',
      message: 'The page request timed out',
    });
    await vi.advanceTimersByTimeAsync(12_001);
    await rejection;
    expect(cancel).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
