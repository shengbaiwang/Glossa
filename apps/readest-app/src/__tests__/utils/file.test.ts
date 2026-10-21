import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemoteFile } from '@/utils/file';

// RemoteFile.fromNativePath serves a local file through the `rangefile` custom
// URI scheme, carrying the byte range in the URL query (?start=&end=) rather
// than a `Range` header — because Android's WebView re-applies a `Range`
// header's offset to intercepted bodies and corrupts non-zero-start reads.
describe('RemoteFile.fromNativePath (rangefile query-range scheme)', () => {
  const path = '/data/user/0/com.bilingify.readest/cache/堂吉诃德（译文名著典藏）.mobi';
  const TOTAL = 8192;
  let calls: Array<{ url: string; init?: RequestInit }>;
  let data: Uint8Array;

  beforeEach(() => {
    calls = [];
    data = new Uint8Array(8192);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const u = new URL(url);
      const start = Number(u.searchParams.get('start') ?? 0);
      const end = Number(u.searchParams.get('end') ?? 0);
      const body = data.slice(start, Math.min(end + 1, data.length));
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'X-Total-Size': String(TOTAL),
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(body.length),
        }),
        arrayBuffer: async () =>
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const noRangeHeader = () =>
    calls.every((c) => {
      const h = c.init?.headers as Record<string, string> | undefined;
      return !h || !Object.keys(h).some((k) => k.toLowerCase() === 'range');
    });

  it('builds a rangefile.localhost URL with the path percent-encoded in the query', () => {
    const f = RemoteFile.fromNativePath(path, 'book.mobi');
    expect(f.url).toBe(`http://rangefile.localhost/?path=${encodeURIComponent(path)}`);
    expect(f.name).toBe('book.mobi');
  });

  it('open() reads the size from X-Total-Size and sends NO Range header', async () => {
    const f = await RemoteFile.fromNativePath(path).open();
    expect(f.size).toBe(TOTAL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('start=0');
    expect(calls[0]!.url).toContain('end=0');
    expect(noRangeHeader()).toBe(true);
  });

  it('fetchRangePart() carries the range in the query, not a Range header', async () => {
    const f = await RemoteFile.fromNativePath(path).open();
    calls.length = 0;
    const buf = await f.fetchRangePart(1024, 2047);
    expect(buf.byteLength).toBe(1024);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get('start')).toBe('1024');
    expect(u.searchParams.get('end')).toBe('2047');
    expect(noRangeHeader()).toBe(true);
    // bytes must be the real [1024,2047] slice (proves no offset re-application)
    expect(new Uint8Array(buf)[0]).toBe(1024 & 0xff);
  });

  it('slice().arrayBuffer() returns the correct bytes for a non-zero offset', async () => {
    const f = await RemoteFile.fromNativePath(path).open();
    const buf = await f.slice(2000, 2010).arrayBuffer(); // [2000, 2010)
    expect(buf.byteLength).toBe(10);
    expect(new Uint8Array(buf)[0]).toBe(2000 & 0xff);
    expect(noRangeHeader()).toBe(true);
  });
});

describe('RemoteFile byte range integrity', () => {
  const data = Uint8Array.from({ length: 400_000 }, (_, i) => i % 251);
  let bodyReads: number;
  let fail: 'short' | 'offset' | 'network' | undefined;

  beforeEach(() => {
    bodyReads = 0;
    fail = undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        if (init?.method === 'HEAD') {
          return new Response(null, { headers: { 'Content-Length': String(data.length) } });
        }
        bodyReads++;
        if (fail === 'network') throw new TypeError('private URL must not escape');
        const range = new Headers(init?.headers).get('Range')!;
        const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
        const start = Number(from),
          end = Math.min(Number(to), data.length - 1);
        const body = data.slice(start, end + (fail === 'short' ? 0 : 1));
        return new Response(body, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start + (fail === 'offset' ? 1 : 0)}-${end}/${data.length}`,
          },
        });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fetches the last requested byte when a range crosses the cached inclusive end', async () => {
    const file = await new RemoteFile('https://example.invalid/book.pdf').open();
    await file.fetchRange(0, 100);
    const result = await file.fetchRange(130_040, 130_048);
    expect(new Uint8Array(result)).toEqual(data.slice(130_040, 130_049));
    expect(bodyReads).toBe(2);
  });

  it.each([
    ['short', 'pdf_range_truncated'],
    ['offset', 'pdf_range_mismatch'],
    ['network', 'pdf_range_read_failed'],
  ] as const)('rejects repeated %s responses with a safe code and does not cache them', async (kind, code) => {
    const file = await new RemoteFile('https://example.invalid/private-book.pdf').open();
    fail = kind;
    await expect(file.slice(2000, 2010).arrayBuffer()).rejects.toThrow(code);
    expect(bodyReads).toBe(2);
    fail = undefined;
    expect(new Uint8Array(await file.slice(2000, 2010).arrayBuffer())).toEqual(
      data.slice(2000, 2010),
    );
    expect(bodyReads).toBe(3);
  });

  it('recovers one transient range read without changing the requested bytes', async () => {
    const normal = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(normal)
        .mockRejectedValueOnce(new TypeError('network'))
        .mockImplementation(normal),
    );
    const file = await new RemoteFile('https://example.invalid/book.pdf').open();
    expect(new Uint8Array(await file.slice(2000, 2010).arrayBuffer())).toEqual(
      data.slice(2000, 2010),
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('slices a complete HTTP 200 response when the server ignores Range', async () => {
    const normal = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(normal).mockResolvedValue(new Response(data)),
    );
    const file = await new RemoteFile('https://example.invalid/book.pdf').open();
    expect(new Uint8Array(await file.slice(2000, 2010).arrayBuffer())).toEqual(
      data.slice(2000, 2010),
    );
  });

  it('returns an empty range without fetching or populating the cache', async () => {
    const file = await new RemoteFile('https://example.invalid/book.pdf').open();
    expect((await file.slice(2000, 2000).arrayBuffer()).byteLength).toBe(0);
    expect(bodyReads).toBe(0);
  });

  it('aborts an active range and prevents retry after close', async () => {
    const normal = globalThis.fetch;
    let rejectRead!: (error: Error) => void;
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(normal)
        .mockImplementationOnce((_input: unknown, init?: RequestInit) => {
          signal = init?.signal;
          return new Promise((_resolve, reject) => {
            rejectRead = reject;
          });
        })
        .mockImplementation(normal),
    );
    const file = await new RemoteFile('https://example.invalid/book.pdf').open();
    const pending = file.slice(2000, 2010).arrayBuffer();
    await file.close();
    rejectRead(new TypeError('network failure after cancellation'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(signal?.aborted).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('cancels a large read across close and immediate reopen between its chunks', async () => {
    const total = 2_048_000;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        if (init?.method === 'HEAD') {
          return new Response(null, { headers: { 'Content-Length': String(total) } });
        }
        bodyReads++;
        const range = new Headers(init?.headers).get('Range')!;
        const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
        const start = Number(from),
          end = Number(to);
        return new Response(new Uint8Array(end - start + 1), {
          status: 206,
          headers: { 'Content-Range': `bytes ${start}-${end}/${total}` },
        });
      }),
    );
    const file = await new RemoteFile('https://example.invalid/book.pdf').open();
    const readPart = file.fetchRangePart.bind(file);
    const firstPart = vi
      .spyOn(file, 'fetchRangePart')
      .mockImplementationOnce(async (start, end) => {
        const result = await readPart(start, end);
        await file.close();
        await file.open();
        return result;
      });
    try {
      await expect(file.fetchRange(0, total - 1)).rejects.toMatchObject({ name: 'AbortError' });
      expect(bodyReads).toBe(1);
      expect((await file.fetchRange(0, 7)).byteLength).toBe(8);
      expect(bodyReads).toBe(2);
    } finally {
      firstPart.mockRestore();
    }
  });

  it('rejects a late body after close without repopulating the cache', async () => {
    const normal = globalThis.fetch;
    let finishRead!: () => void;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(normal)
        .mockImplementationOnce(
          (input: unknown, init?: RequestInit) =>
            new Promise((resolve) => {
              finishRead = () => {
                void normal(input as RequestInfo, init).then(resolve);
              };
            }),
        )
        .mockImplementation(normal),
    );
    const file = await new RemoteFile('https://example.invalid/book.pdf').open();
    const pending = file.slice(2000, 2010).arrayBuffer();
    await file.close();
    finishRead();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await file.open();
    expect(new Uint8Array(await file.slice(2000, 2010).arrayBuffer())).toEqual(
      data.slice(2000, 2010),
    );
    expect(bodyReads).toBe(2);
  });
});
