// Byte offsets at the reader boundary are half-open. The wire format uses inclusive ends.
import { z } from 'zod';
import { blake3 as digest } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { assetRole, blake3, fastCdcProfile, id } from './index.ts';

const offset = z.int().nonnegative();
const segment = z.object({ ordinal: offset, start_byte: offset, end_byte: offset, blake3 });
const descriptor = z.object({
  role: assetRole,
  bytes: z.int().positive().max(fastCdcProfile.max),
  blake3,
  codec_version: z.string(),
});
const header = z.object({
  manifest_id: id,
  file_blake3: blake3,
  file_bytes: z.int().positive(),
  chunk_count: z.int().positive(),
  manifest_digest: blake3,
  assets: z.array(descriptor).max(4),
  chunks: z.array(segment).max(128),
  next_ordinal: offset.nullable(),
});
const signedUrl = z.url({ protocol: /^https$/ });
const links = z.object({
  manifest_id: id,
  chunks: z.array(segment.extend({ get_url: signedUrl })).max(128),
  assets: z.array(z.object({ role: assetRole, blake3, get_url: signedUrl })).max(4),
});
type Chunk = z.infer<typeof segment>;
export type AssetRole = z.infer<typeof assetRole>;
export type CloudBookIdentity = { book_id: string; manifest_id: string; file_blake3: string };
export type ReaderTransport = {
  control(path: string, body: unknown | undefined, signal: AbortSignal): Promise<unknown>;
  object(url: string, signal: AbortSignal): Promise<Response>;
};
export function readerTransport(origin: string, token: () => Promise<string>): ReaderTransport {
  return {
    async control(path, body, signal) {
      const options = {
        method: body === undefined ? 'GET' : 'POST',
        signal,
        redirect: 'error',
        credentials: 'omit',
        headers: {
          Authorization: 'Bearer ' + (await token()),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      } as const;
      const res = await fetch(new URL('/v1' + path, origin), options);
      if (!res.ok) throw new Error('sync_http_' + res.status);
      return res.json();
    },
    object: (url, signal) => {
      const options = {
        signal,
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      } as const;
      return fetch(url, options);
    },
  };
}
async function verifiedBytes(response: Response, size: number, hash: string) {
  if (response.status !== 200 || !response.body) throw new Error('object_http_' + response.status);
  const stream = response.body.getReader();
  const bytes = new Uint8Array(size);
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await stream.read();
      if (done) break;
      if (offset + value.length > size) throw new Error('object_length_mismatch');
      bytes.set(value, offset);
      offset += value.length;
    }
    if (offset !== size) throw new Error('object_length_mismatch');
    if (bytesToHex(digest(bytes)) !== hash) throw new Error('object_hash_mismatch');
    return bytes;
  } catch (e) {
    await stream.cancel().catch(() => {});
    throw e;
  } finally {
    stream.releaseLock();
  }
}
export class CloudRangeReader {
  readonly size: number;
  readonly fileHash: string;
  readonly assets: readonly z.infer<typeof descriptor>[];
  private readonly chunks: Chunk[];
  private readonly path: string;
  private readonly manifest: string;
  private readonly api: ReaderTransport;
  private readonly controller: AbortController;
  private readonly cache = new Map<string, Uint8Array>();
  private readonly pending = new Map<string, Promise<Uint8Array>>();
  private cachedBytes = 0;
  private fetching = 0;
  private readonly waiting: (() => void)[] = [];
  // Several simultaneous ZIP or PDF range reads share the same four object fetch slots.
  private async fetchObject(url: string, size: number, hash: string) {
    if (this.fetching === 4) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.fetching++;
    try {
      const signal = this.controller.signal;
      signal.throwIfAborted();
      return await verifiedBytes(await this.api.object(url, signal), size, hash);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.fetching--;
    }
  }
  private constructor(
    api: ReaderTransport,
    path: string,
    meta: z.infer<typeof header>,
    chunks: Chunk[],
    controller: AbortController,
  ) {
    this.size = meta.file_bytes;
    this.fileHash = meta.file_blake3;
    this.assets = meta.assets;
    this.chunks = chunks;
    this.api = api;
    this.path = path;
    this.manifest = meta.manifest_id;
    this.controller = controller;
  }
  static async open(
    api: ReaderTransport,
    identity: CloudBookIdentity,
    controller = new AbortController(),
  ) {
    const path = '/books/' + id.parse(identity.book_id);
    const manifest = id.parse(identity.manifest_id),
      fileHash = blake3.parse(identity.file_blake3);
    const chunks: Chunk[] = [];
    let next = 0,
      first: z.infer<typeof header> | undefined;
    for (;;) {
      const cursor = chunks.length ? '&after_ordinal=' + (chunks.length - 1) : '';
      const page = header.parse(
        await api.control(
          path + '/manifest?manifest_id=' + manifest + cursor,
          undefined,
          controller.signal,
        ),
      );
      first ??= page;
      if (
        page.manifest_id !== manifest ||
        page.file_blake3 !== fileHash ||
        page.manifest_digest !== first.manifest_digest ||
        page.file_bytes !== first.file_bytes ||
        page.chunk_count !== first.chunk_count ||
        !page.chunks.length
      )
        throw new Error('manifest_mismatch');
      for (const c of page.chunks) {
        if (
          c.ordinal !== chunks.length ||
          c.start_byte !== next ||
          c.end_byte < next ||
          c.end_byte - next >= fastCdcProfile.max ||
          c.end_byte >= page.file_bytes ||
          chunks.length >= page.chunk_count
        )
          throw new Error('invalid_chunk_map');
        chunks.push(c);
        next = c.end_byte + 1;
      }
      if (page.next_ordinal === null) break;
      if (page.next_ordinal !== chunks.length - 1 || chunks.length >= page.chunk_count)
        throw new Error('invalid_manifest_cursor');
    }
    if (
      next !== first.file_bytes ||
      chunks.length !== first.chunk_count ||
      new Set(first.assets.map((a) => a.role)).size !== first.assets.length
    )
      throw new Error('incomplete_manifest');
    return new CloudRangeReader(api, path, first, chunks, controller);
  }
  close() {
    this.controller.abort();
    this.cache.clear();
    this.cachedBytes = 0;
  }
  private async addresses(ranges: { start_byte: number; end_byte: number }[], assets: AssetRole[]) {
    const value = links.parse(
      await this.api.control(
        this.path + '/stream-urls',
        { manifest_id: this.manifest, ranges, assets },
        this.controller.signal,
      ),
    );
    if (value.manifest_id !== this.manifest) throw new Error('manifest_changed');
    return value;
  }
  private async load(hash: string, size: number, getUrl: () => Promise<string>) {
    const signal = this.controller.signal;
    signal.throwIfAborted();
    const hit = this.cache.get(hash);
    if (hit) {
      if (hit.length !== size) throw new Error('object_length_mismatch');
      this.cache.delete(hash);
      this.cache.set(hash, hit);
      return hit;
    }
    // The slot includes length so inconsistent descriptors never share pending bytes.
    const key = hash + ':' + size;
    const running = this.pending.get(key);
    if (running) return running;
    const request = (async () => {
      const url = await getUrl();
      const bytes = await this.fetchObject(url, size, hash);
      signal.throwIfAborted();
      while (this.cachedBytes + size > 48 * 1024 * 1024) {
        const oldest = this.cache.keys().next().value!;
        this.cachedBytes -= this.cache.get(oldest)!.length;
        this.cache.delete(oldest);
      }
      this.cache.set(hash, bytes);
      this.cachedBytes += size;
      return bytes;
    })();
    this.pending.set(key, request);
    try {
      return await request;
    } finally {
      this.pending.delete(key);
    }
  }
  async asset(role: AssetRole) {
    const a = this.assets.find((a) => a.role === role);
    if (!a) throw new Error('asset_not_found');
    const data = await this.load(a.blake3, a.bytes, async () => {
      const { assets } = await this.addresses([], [role]);
      if (assets.length !== 1 || assets[0]!.role !== role || assets[0]!.blake3 !== a.blake3)
        throw new Error('asset_mismatch');
      return assets[0]!.get_url;
    });
    return data.slice();
  }
  private ordinalAt(start: number) {
    let lo = 0,
      hi = this.chunks.length;
    while (lo < hi) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (this.chunks[mid]!.end_byte < start) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  private async loadBatch(batch: Chunk[]) {
    const missing = batch.filter(
      (c) =>
        !this.cache.has(c.blake3) &&
        !this.pending.has(c.blake3 + ':' + (c.end_byte - c.start_byte + 1)),
    );
    let addresses: Promise<Map<number, string>> | undefined;
    const getUrl = (c: Chunk) => {
      addresses ??= this.addresses(
        missing.map(({ start_byte, end_byte }) => ({ start_byte, end_byte })),
        [],
      ).then((reply) => {
        if (reply.chunks.length !== missing.length) throw new Error('signed_range_mismatch');
        const urls = new Map<number, string>();
        for (const [i, desc] of reply.chunks.entries()) {
          const expected = missing[i]!;
          if (
            desc.ordinal !== expected.ordinal ||
            desc.blake3 !== expected.blake3 ||
            desc.start_byte !== expected.start_byte ||
            desc.end_byte !== expected.end_byte
          )
            throw new Error('signed_range_mismatch');
          urls.set(desc.ordinal, desc.get_url);
        }
        return urls;
      });
      return addresses.then((urls) => urls.get(c.ordinal)!);
    };
    // Register every requested slot synchronously so concurrent parser requests share work.
    return Promise.all(
      batch.map((c) => this.load(c.blake3, c.end_byte - c.start_byte + 1, () => getUrl(c))),
    );
  }

  async warmPdfRanges(ranges: readonly [number, number][]) {
    const missing = new Map<string, Chunk>();
    let bytes = 0;
    for (const [start, end] of ranges) {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        end >= this.size
      )
        throw new Error('invalid_pdf_range');
      for (let i = this.ordinalAt(start); i < this.chunks.length; i++) {
        const chunk = this.chunks[i]!;
        if (chunk.start_byte > end) break;
        const size = chunk.end_byte - chunk.start_byte + 1;
        if (
          missing.has(chunk.blake3) ||
          this.cache.has(chunk.blake3) ||
          this.pending.has(chunk.blake3 + ':' + size)
        )
          continue;
        // A hint gets one bounded signing request; demand reads remain authoritative.
        if (missing.size === 4 || bytes + size > 24 << 20) return;
        missing.set(chunk.blake3, chunk);
        bytes += size;
      }
    }
    if (missing.size) await this.loadBatch([...missing.values()]);
  }

  async warmZipEntry(start: number, end: number) {
    // Only coalesce reads that would otherwise travel in separate chunk requests.
    if (start < 0 || end > this.size || start >= end || end - start > 8 << 20) return;
    const first = this.ordinalAt(start),
      last = this.ordinalAt(end - 1);
    if (first === last || this.chunks.slice(first, last + 1).every((c) => this.cache.has(c.blake3)))
      return;
    await this.read(start, end);
  }
  async read(start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    this.controller.signal.throwIfAborted();
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      end > this.size
    )
      throw new RangeError('invalid_read_range');
    const out = new Uint8Array(end - start);
    let lo = this.ordinalAt(start);
    const begin = start;
    while (start < end) {
      // At most four 16 MiB chunks are signed together, below the 128 MiB server window.
      const batch: Chunk[] = [];
      while (batch.length < 4 && lo < this.chunks.length && this.chunks[lo]!.start_byte < end) {
        batch.push(this.chunks[lo++]!);
      }
      const values = await this.loadBatch(batch);
      for (const [i, c] of batch.entries()) {
        const until = Math.min(end, c.end_byte + 1);
        out.set(values[i]!.subarray(start - c.start_byte, until - c.start_byte), start - begin);
        start = until;
      }
    }
    return out;
  }
}
