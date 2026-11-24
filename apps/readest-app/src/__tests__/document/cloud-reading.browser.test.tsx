import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import CloudHeadPreview from '@/app/reader/components/CloudHeadPreview';
import { expect, it, vi } from 'vitest';
import { previewScope, cachedHeadPreview } from '@/glossa/sync/previewCache';
import { HeadPreviewBuilder, decodeHeadPreview } from '@/glossa/sync/headPreview';
import * as CFI from 'foliate-js/epubcfi.js';
import { SearchPackBuilder, decodeSearchPack } from '@/glossa/sync/searchSidecar';
import {
  createLibrarySearchSession,
  resolveSearchResultCfi,
  searchLibraryBooks,
} from '@/services/librarySearchService';
import { WebAppService } from '@/services/webAppService';
import type { Book, LibrarySearchMatch } from '@/types/book';
const account = vi.hoisted(() => ({ subject: 'fixture-user' }));
vi.mock('@/utils/access', async (original) => ({
  ...(await original<typeof import('@/utils/access')>()),
  getUserID: async () => account.subject,
}));
vi.mock('@/glossa/sync/config', async (original) => ({
  ...(await original<typeof import('@/glossa/sync/config')>()),
  syncOrigin: () => 'https://sync.example.test',
}));
import { BlobReader, BlobWriter, Uint8ArrayReader, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { prepareFile } from '@glossa/sync-contracts/publisher';
import { buildPdfLayout } from '@/glossa/sync/buildPdfLayout';
import { decodePdfLayout } from '@/glossa/sync/pdfLayout';
import { buildEpubLayout } from '@/glossa/sync/buildEpubLayout';
import { decodeEpubLayout } from '@/glossa/sync/epubLayout';
import { chunkFile, describeObject } from '@glossa/sync-contracts/chunker';
import { CloudRangeReader, type ReaderTransport } from '@glossa/sync-contracts/reader';
import { DocumentLoader, type BookDoc } from '@/libs/document';
import { CloudReaderFile } from '@/glossa/sync/readerFile';

async function fixture(name: string) {
  const res = await fetch('/src/__tests__/fixtures/data/' + name);
  expect(res.ok).toBe(true);
  return res.blob();
}
function padding() {
  const bytes = new Uint8Array(24 * 1024 * 1024);
  let state = 0x39c81a;
  for (let i = 0; i < bytes.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = state & 255;
  }
  return bytes;
}
async function scannedPDF() {
  const scan = await fixture('glossa-ocr-sample.pdf');
  const trailer = await scan.slice(-512).text();
  const previous = Number(/startxref\s+(\d+)/.exec(trailer)![1]);
  const num = Number(/\/Size (\d+)/.exec(trailer)![1]);
  const root = /\/Root (\d+ \d+ R)/.exec(trailer)![1];
  const data = padding(),
    offset = scan.size + 1;
  const object = new Blob([
    '\n' + num + ' 0 obj\n<< /Length ' + data.byteLength + ' >>\nstream\n',
    data,
    '\nendstream\nendobj\n',
  ]);
  return new Blob([
    scan,
    object,
    'xref\n' +
      num +
      ' 1\n' +
      String(offset).padStart(10, '0') +
      ' 00000 n \ntrailer\n<< /Size ' +
      (num + 1) +
      ' /Root ' +
      root +
      ' /Prev ' +
      previous +
      ' >>\nstartxref\n' +
      (scan.size + object.size) +
      '\n%%EOF\n',
  ]);
}
async function compressedEPUB() {
  const original = new ZipReader(new BlobReader(await fixture('glossa-reading-sample.epub')));
  const writer = new ZipWriter(new BlobWriter());
  for (const entry of await original.getEntries()) {
    if (entry.directory) continue;
    await writer.add(entry.filename, new BlobReader(await entry.getData(new BlobWriter())), {
      level: entry.filename === 'mimetype' ? 0 : 6,
    });
    if (entry.filename === 'mimetype')
      await writer.add('OEBPS/unused.bin', new Uint8ArrayReader(padding()), { level: 0 });
  }
  await original.close();
  return writer.close();
}
// Exercise the shipped File, PDF.js, EPUB and chunker paths; use an isolated memory object store here.
// Wrangler integration separately verifies API, signing and object transport through workerd.
async function openRangeFile(
  blob: Blob,
  format: 'PDF' | 'EPUB',
  withSearch = false,
  withPreview = false,
) {
  const chunks: { ordinal: number; start_byte: number; end_byte: number; blake3: string }[] = [];
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  let hash = '';
  async function* source() {
    for (let i = 0; i < blob.size; i += 1024 * 1024)
      yield new Uint8Array(await blob.slice(i, i + 1024 * 1024).arrayBuffer());
  }
  for await (const c of chunkFile(source())) {
    if (c.type === 'complete') {
      hash = c.file_blake3;
      continue;
    }
    chunks.push({
      ordinal: c.ordinal,
      start_byte: c.start_byte,
      end_byte: c.end_byte,
      blake3: c.blake3,
    });
    objects.set(c.blake3, c.data.slice());
  }
  const identity = {
    book_id: crypto.randomUUID(),
    manifest_id: crypto.randomUUID(),
    file_blake3: hash,
  };
  const plan = await prepareFile(blob);
  const search = withSearch
    ? new SearchPackBuilder({
        source_file_blake3: hash,
        file_bytes: blob.size,
        format: format === 'PDF' ? 'pdf' : 'epub',
        language: 'en',
      })
    : undefined;
  const preview = withPreview
    ? new HeadPreviewBuilder(plan, format === 'PDF' ? 'pdf' : 'epub')
    : undefined;
  const layout =
    format === 'EPUB'
      ? await buildEpubLayout(blob, plan, search, preview)
      : await buildPdfLayout(blob, plan, search, preview);
  const assets: { blake3: string; role: string; codec_version: string; bytes: number }[] = [];
  {
    expect(layout).toBeDefined();
    const data = new Uint8Array(await layout!.body.arrayBuffer());
    const { blake3 } = describeObject(data);
    objects.set(blake3, data);
    assets.push({
      blake3,
      role: layout!.role,
      codec_version: layout!.codec_version,
      bytes: data.length,
    });
    if (format === 'EPUB') {
      const entries = [...decodeEpubLayout(data, hash, blob.size).values()];
      const last = entries.at(-1)!;
      expect(last.zip_method).toBe(8);
      expect(last.dependencies_complete).toBe(false);
      const [[start, end]] = last.compressed_ranges;
      const text = await new Response(
        blob
          .slice(start, end + 1)
          .stream()
          .pipeThrough(new DecompressionStream('deflate-raw')),
      ).text();
      expect(text).toContain('return signal');
      expect(() => decodeEpubLayout(data, '0'.repeat(64), blob.size)).toThrow(
        'layout_source_mismatch',
      );
    }
  }
  const searchPack = await search?.finish();
  if (searchPack) {
    const data = new Uint8Array(await searchPack.body.arrayBuffer());
    const { blake3 } = describeObject(data);
    objects.set(blake3, data);
    assets.push({
      blake3,
      role: searchPack.role,
      codec_version: searchPack.codec_version,
      bytes: data.length,
    });
  }
  const head = preview?.finish();
  if (head) {
    const data = new Uint8Array(await head.body.arrayBuffer());
    const { blake3 } = describeObject(data);
    objects.set(blake3, data);
    assets.push({ role: head.role, codec_version: head.codec_version, bytes: data.length, blake3 });
  }
  const gets: string[] = [];
  const signedRanges: { start_byte: number; end_byte: number }[][] = [];
  const api: ReaderTransport = {
    async control(path, payload) {
      if (path.includes('/manifest?'))
        return {
          ...identity,
          file_bytes: blob.size,
          manifest_digest: 'a'.repeat(64),
          chunk_count: chunks.length,
          next_ordinal: null,
          assets,
          chunks,
        };
      const { ranges, assets: roles } = payload as {
        ranges: { start_byte: number; end_byte: number }[];
        assets: string[];
      };
      if (ranges.length) signedRanges.push(ranges);
      return {
        manifest_id: identity.manifest_id,
        assets: assets
          .filter((a) => roles.includes(a.role))
          .map((a) => ({ ...a, get_url: 'https://objects.example/' + a.blake3 })),
        chunks: chunks
          .filter((c) =>
            ranges.some((r) => r.end_byte >= c.start_byte && r.start_byte <= c.end_byte),
          )
          .map((c) => ({ ...c, get_url: 'https://objects.example/' + c.blake3 })),
      };
    },
    async object(url) {
      const hash = new URL(url).pathname.slice(1);
      gets.push(hash);
      return new Response(objects.get(hash)!);
    },
  };
  const open = async () =>
    new CloudReaderFile(
      await CloudRangeReader.open(api, identity),
      'scan.' + format.toLowerCase(),
      blob.type,
      withPreview
        ? previewScope({
            ...identity,
            origin: 'https://sync.example.test',
            subject: 'fixture-user',
          })
        : undefined,
    );
  return {
    file: await open(),
    open,
    gets,
    signedRanges,
    identity,
    head,
    searchPack,
    searchHash: assets.find((a) => a.role === 'search_sidecar')?.blake3,
    layoutHash: assets[0]?.blake3,
    layout: await layout!.body.text(),
    hash,
    transferred: () => gets.reduce((sum, h) => sum + objects.get(h)!.length, 0),
  };
}
for (const format of ['PDF', 'EPUB'] as const) {
  it('opens a cloud-only ' +
    format +
    ' and reads the target without fetching all original bytes', async () => {
    const blob = await (format === 'PDF' ? scannedPDF() : compressedEPUB());
    const { file, gets, transferred, layoutHash } = await openRangeFile(blob, format);
    let doc: BookDoc | undefined;
    try {
      const result = await new DocumentLoader(file, { loadPDFCache: false }).open();
      doc = result.book;
      expect(result.format).toBe(format);
      expect(doc.sections.length).toBeGreaterThan(1);
      if (format === 'PDF') {
        const image = await doc.getPDFImage!(1, 320);
        const bitmap = await createImageBitmap(image!);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          expect(pixels.some((v, i) => i % 4 === 0 && v < 160 && pixels[i + 3]! > 0)).toBe(true);
        } finally {
          bitmap.close();
        }
      } else {
        expect((await doc.sections.at(-1)!.createDocument()).body.textContent).toContain(
          'return signal',
        );
      }
      expect(gets.filter((hash) => hash === layoutHash)).toHaveLength(1);
      expect(new Set(gets).size).toBe(gets.length);
      expect(transferred()).toBeLessThan(blob.size);
      console.info('cold range fixture', format, {
        gets: gets.length,
        bytes: transferred(),
        fileBytes: blob.size,
      });
    } finally {
      await doc?.destroy?.();
      await file.close();
    }
  }, 45000);
}

for (const format of ['PDF', 'EPUB'] as const) {
  it('displays and caches the independent opening preview for ' + format, async () => {
    const blob = format === 'PDF' ? await scannedPDF() : await compressedEPUB();
    const sample = await openRangeFile(blob, format, false, true);
    const ext = format === 'PDF' ? 'pdf' : 'epub';
    const asset = sample.head!;
    expect(asset.role).toBe('head_preview_chunk');
    const bytes = new Uint8Array(await asset.body.arrayBuffer());
    const preview = await sample.file.headPreview(ext);
    expect(sample.gets).toEqual([describeObject(bytes).blake3]);
    expect(sample.signedRanges).toHaveLength(0);
    if (preview?.format === 'pdf') {
      expect(preview.pages).toHaveLength(3);
      const truncated = new TextEncoder().encode(
        JSON.stringify({
          ...preview,
          pages: [preview.pages[0]!.slice(0, -8)],
        }),
      );
      expect(() => decodeHeadPreview(truncated, sample.hash, blob.size, ext)).toThrow();

      for (const url of preview.pages) {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        try {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(bitmap, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          expect(pixels.some((v, i) => i % 4 === 0 && v < 150 && pixels[i + 3]! > 0)).toBe(true);
        } finally {
          bitmap.close();
        }
      }
    } else {
      expect(preview?.format).toBe('epub');
      expect(preview?.text).toContain('an amber mark points to a passage, not to an answer.');
      expect(preview?.text).toContain('星标索引在读者翻页前记录每一个琥珀色标记。');
      expect(preview?.text).not.toContain('return signal');
    }
    expect(() => decodeHeadPreview(bytes, '0'.repeat(64), blob.size, ext)).toThrow(
      'preview_source_mismatch',
    );
    const key = 'fixture-reader';
    const pointer = {
      ...sample.identity,
      subject: 'fixture-user',
      origin: 'https://sync.example.test',
    };
    expect(await cachedHeadPreview(pointer, ext)).toEqual(preview);
    expect(await cachedHeadPreview({ ...pointer, subject: 'other' }, ext)).toBeUndefined();
    expect(
      await cachedHeadPreview({ ...pointer, manifest_id: crypto.randomUUID() }, ext),
    ).toBeUndefined();
    const libraryBefore = useLibraryStore.getState();
    const readerBefore = useReaderStore.getState();
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    try {
      const row = { hash: 'fixture', title: 'Preview', format, glossaCloud: pointer } as Book;
      useLibraryStore.setState({
        library: [row],
        hashIndex: new Map([[row.hash, 0]]),
        cloudSubject: pointer.subject,
      });
      useReaderStore.setState({
        viewStates: {
          [key]: {
            ...readerBefore.viewStates[key]!,
            headPreview: {
              content: preview!,
              subject: pointer.subject,
              origin: pointer.origin,
              manifest: pointer.manifest_id,
            },
          },
        },
      });
      flushSync(() => root.render(<CloudHeadPreview bookKey={key}>loading</CloudHeadPreview>));
      expect(host.querySelector('article')?.getAttribute('aria-label')).toBe(row.title);
      if (format === 'PDF') expect(host.querySelectorAll('img')).toHaveLength(3);
      else expect(host.textContent).toContain('星标索引');
      flushSync(() => useLibraryStore.setState({ cloudSubject: 'other' }));
      expect(host.textContent).toBe('loading');
    } finally {
      root.unmount();
      host.remove();
      useLibraryStore.setState(libraryBefore);
      useReaderStore.setState(readerBefore);
    }
    await sample.file.close();
    const reopened = await sample.open();
    try {
      expect(await reopened.headPreview(ext)).toEqual(preview);
      expect(sample.gets).toHaveLength(1);
      expect(sample.signedRanges).toHaveLength(0);
    } finally {
      await reopened.close();
    }
  }, 45000);
}

it('omits unsupported ZIP metadata and rejects a changed local source', async () => {
  const invalid = new Blob(['unsupported EPUB']);
  expect(await buildEpubLayout(invalid, await prepareFile(invalid))).toBeUndefined();
  const epub = await fixture('glossa-reading-sample.epub');
  const plan = await prepareFile(epub);
  const changed = new Blob(['?', epub.slice(1)]);
  await expect(buildEpubLayout(changed, plan)).rejects.toThrow('source_file_changed');
});

it('coalesces a split EPUB chapter and falls back to parser ranges for a mismatched layout', async () => {
  const chunks = [new Uint8Array(64).fill(33), new Uint8Array(64).fill(44)];
  const fileHash = describeObject(new Uint8Array([...chunks[0]!, ...chunks[1]!])).blake3;
  const descriptors = chunks.map((bytes, i) => ({
    ordinal: i,
    start_byte: i * 64,
    end_byte: (i + 1) * 64 - 1,
    blake3: describeObject(bytes).blake3,
  }));
  const entry = { filename: 'part.xhtml', offset: 20, compressedSize: 40, compressionMethod: 8 };
  for (const stale of [false, true]) {
    const raw = new TextEncoder().encode(
      JSON.stringify({
        schema_version: 1,
        source_file_blake3: stale ? '0'.repeat(64) : fileHash,
        format: 'epub',
        file_bytes: 128,
        spine: [
          {
            href: entry.filename,
            spine_index: 0,
            header_offset: 20,
            zip_method: 8,
            compressed_ranges: [[60, 99]],
            dependencies: [],
            dependencies_complete: false,
          },
        ],
      }),
    );
    const asset = {
      role: 'layout_manifest',
      codec_version: 'epub-spine-ranges-v1',
      ...describeObject(raw),
    };
    const objects = new Map([
      [asset.blake3, raw],
      ...chunks.map((bytes, i) => [descriptors[i]!.blake3, bytes] as const),
    ]);
    const requests: number[] = [];
    const id = {
      book_id: crypto.randomUUID(),
      manifest_id: crypto.randomUUID(),
      file_blake3: fileHash,
    };
    const reader = await CloudRangeReader.open(
      {
        async control(path, payload) {
          if (path.includes('/manifest?'))
            return {
              ...id,
              manifest_digest: 'c'.repeat(64),
              chunk_count: 2,
              file_bytes: 128,
              chunks: descriptors,
              assets: [asset],
              next_ordinal: null,
            };
          const { ranges, assets } = payload as {
            ranges: { start_byte: number; end_byte: number }[];
            assets: string[];
          };
          if (ranges.length) requests.push(ranges.length);
          return {
            manifest_id: id.manifest_id,
            chunks: descriptors
              .filter((d) =>
                ranges.some((r) => r.start_byte <= d.end_byte && r.end_byte >= d.start_byte),
              )
              .map((d) => ({ ...d, get_url: 'https://objects.example/' + d.blake3 })),
            assets: assets.length
              ? [{ ...asset, get_url: 'https://objects.example/' + asset.blake3 }]
              : [],
          };
        },
        async object(url) {
          return new Response(objects.get(new URL(url).pathname.slice(1))!);
        },
      },
      id,
    );
    const file = new CloudReaderFile(reader, 'local.epub', 'application/epub+zip');
    try {
      await file.warmEpubText(entry);
      expect(requests).toEqual(stale ? [] : [2]);
      expect(new Uint8Array(await file.slice(62, 66).arrayBuffer())).toEqual(
        new Uint8Array([33, 33, 44, 44]),
      );
      expect(requests).toEqual([2]);
    } finally {
      await file.close();
    }
  }
});

// Three distant shared objects and nonreferenced padding. The page tree supplies
// Resources to both leaves; reading the second page in a warm parser would miss them.
async function sharedResourcePdf(imageOnly = false) {
  const parts: BlobPart[] = ['%PDF-1.7\n'];
  let size = 9;
  const offsets: number[] = [0];
  const push = (part: string | Uint8Array<ArrayBuffer>) => {
    parts.push(part);
    size += typeof part === 'string' ? part.length : part.byteLength;
  };
  const start = (id: number) => {
    offsets[id] = size;
    push(id + ' 0 obj\n');
  };
  const obj = (id: number, text: string) => {
    start(id);
    push(text + '\nendobj\n');
  };
  const pad = imageOnly ? new Uint8Array(0) : padding();
  function hole(id: number, offset: number) {
    start(id);
    const bytes = pad.subarray(offset, offset + (8 << 20));
    push('<< /Length ' + bytes.length + ' >>\nstream\n');
    push(bytes);
    push('\nendstream\nendobj\n');
  }
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(
    2,
    '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] /MediaBox [0 0 400 400] /Resources << /Font << /F1 7 0 R >> /XObject << /Stamp 9 0 R >> >> >>',
  );
  obj(3, '<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>');
  obj(4, '<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>');
  for (const id of [5, 6]) {
    const text = imageOnly ? '' : 'BT /F1 18 Tf 20 200 Td (page ' + id + ') Tj ET ';
    const ops = text + 'q 80 0 0 80 40 40 cm /Stamp Do Q';
    obj(id, '<< /Length ' + ops.length + ' >>\nstream\n' + ops + '\nendstream');
  }
  hole(8, 0);
  obj(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  hole(10, 8 << 20);
  start(9);
  push(
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\n',
  );
  push(new Uint8Array([255, 0, 0]));
  push('\nendstream\nendobj\n');
  hole(11, 16 << 20);
  const xref = size;
  push('xref\n0 12\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) push(String(offset).padStart(10, '0') + ' 00000 n \n');
  push('trailer\n<< /Size 12 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return {
    blob: new Blob(parts, { type: 'application/pdf' }),
    font: offsets[7]!,
    image: offsets[9]!,
  };
}

it('records distant inherited font and image reads independently for both cold PDF pages', async ({
  task,
}) => {
  const { blob, font, image } = await sharedResourcePdf();
  const remote = await openRangeFile(blob, 'PDF');
  const parser = JSON.parse(remote.layout).parser_version;
  const data = new TextEncoder().encode(remote.layout);
  const pages = decodePdfLayout(data, remote.hash, blob.size, parser);
  expect(pages).toHaveLength(2);
  expect(() => decodePdfLayout(data, remote.hash, blob.size, 'other-parser')).toThrow(
    'layout_source_mismatch',
  );
  for (const page of pages) {
    expect(page.dependencies_complete).toBe(false);
    expect(page.ranges.length).toBeGreaterThan(1);
    for (const offset of [font, image])
      expect(page.ranges.some(([a, b]) => a <= offset && offset <= b)).toBe(true);
  }
  let doc: BookDoc | undefined;
  try {
    doc = (await new DocumentLoader(remote.file, { loadPDFCache: false }).open()).book;
    const bitmap = await createImageBitmap((await doc.getPDFImage!(1, 400))!);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      expect([...ctx.getImageData(60, 340, 1, 1).data]).toEqual([255, 0, 0, 255]);
    } finally {
      bitmap.close();
    }
    expect(await doc.getPDFText!(1)).toContain('page 6');
    expect(
      remote.signedRanges.some((batch) =>
        [font, image].every((byte) =>
          batch.some((r) => r.start_byte <= byte && byte <= r.end_byte),
        ),
      ),
    ).toBe(true);
    expect(remote.transferred()).toBeLessThan(blob.size);
    const metrics: Record<string, unknown> = {};
    metrics['coldRead'] = {
      objectGets: remote.gets.length,
      bytes: remote.transferred(),
      fileBytes: blob.size,
      layoutBytes: data.length,
    };
    const benchEnv = (import.meta as ImportMeta & { env: { VITE_GLOSSA_CLOUD_BENCH?: string } })
      .env;
    if (benchEnv.VITE_GLOSSA_CLOUD_BENCH === '1') {
      const coldTimes: number[] = [],
        warmTimes: number[] = [];
      for (let sample = 0; sample < 20; sample++) {
        const started = performance.now();
        const file = await remote.open();
        let coldBook: BookDoc | undefined;
        try {
          coldBook = (await new DocumentLoader(file, { loadPDFCache: false }).open()).book;
          const render = async () =>
            (await createImageBitmap((await coldBook!.getPDFImage!(1, 400))!)).close();
          await render();
          coldTimes.push(performance.now() - started);
          const before = remote.gets.length,
            repeat = performance.now();
          await render();
          warmTimes.push(performance.now() - repeat);
          expect(remote.gets).toHaveLength(before);
        } finally {
          await coldBook?.destroy?.();
          await file.close();
        }
      }
      const percentiles = (values: number[]) => {
        const sorted = values.slice().sort((a, b) => a - b);
        return { p50: Math.round(sorted[9]!), p95: Math.round(sorted[18]!) };
      };
      metrics['pageBitmapMs'] = {
        samples: 20,
        cold: percentiles(coldTimes),
        warm: percentiles(warmTimes),
      };
    }
    Object.assign(task.meta, metrics);
  } finally {
    await doc?.destroy?.();
    await remote.file.close();
  }
}, 60000);

it('preserves a PDF source mismatch as an upload error and omits layouts for unreadable PDFs', async () => {
  const pdf = await fixture('glossa-ocr-sample.pdf');
  const plan = await prepareFile(pdf);
  expect(plan.chunks).toHaveLength(1);
  const single = await buildPdfLayout(pdf, plan);
  const { pages } = JSON.parse(await single!.body.text());
  expect(pages.length).toBeGreaterThan(1);
  for (const page of pages) expect(page.ranges).toEqual([[0, pdf.size - 1]]);
  await expect(buildPdfLayout(new Blob(['?', pdf.slice(1)]), plan)).rejects.toThrow(
    'source_file_changed',
  );
  const invalid = new Blob(['%PDF-1.7\n']);
  expect(await buildPdfLayout(invalid, await prepareFile(invalid))).toBeUndefined();
});

for (const format of ['EPUB', 'PDF'] as const) {
  it('searches a cloud-only ' +
    format +
    ' offline after one asset GET and resolves the original range', async () => {
    const blob =
      format === 'EPUB'
        ? await fixture('glossa-reading-sample.epub')
        : (await sharedResourcePdf()).blob;
    const term = format === 'EPUB' ? 'return signal' : 'page 6';
    const remote = await openRangeFile(blob, format, true);
    expect(remote.searchHash).toBeTypeOf('string');
    const app = new WebAppService();
    const owner = account.subject;
    const book: Book = {
      hash: crypto.randomUUID(),
      format,
      title: 'Fixture',
      author: '',
      createdAt: 1,
      updatedAt: 1,
      primaryLanguage: 'en',
      glossaCloud: { ...remote.identity, origin: 'https://sync.example.test', subject: owner },
    };
    vi.spyOn(app, 'getBookFileSize').mockResolvedValue(null);
    vi.spyOn(app, 'loadBookNav').mockResolvedValue(null);
    vi.spyOn(app, 'resolveNativeBookFilePath').mockResolvedValue(null);
    const load = async () => ({ book, file: await remote.open() });
    const content = vi.spyOn(app, 'loadBookContent').mockImplementation(load);
    const search = async (row: Book) => {
      const hits: LibrarySearchMatch[] = [],
        errors: string[] = [];
      for await (const e of searchLibraryBooks(app, [row], term)) {
        if (e.type === 'result') hits.push(...e.result.subitems);
        if (e.type === 'book-error') errors.push(e.error);
      }
      return { hits, errors };
    };
    const session = createLibrarySearchSession(app);
    try {
      const found = await search(book);
      expect(found.errors).toEqual([]);
      expect(found.hits.length).toBeGreaterThan(0);
      expect(remote.gets).toEqual([remote.searchHash]);
      expect(remote.signedRanges).toHaveLength(0);
      content.mockRejectedValue(new Error('offline'));
      expect(await search(book)).toEqual(found);
      expect(content).toHaveBeenCalledTimes(1);
      account.subject = 'other-account';
      expect(await search(book)).toEqual({ hits: [], errors: ['sync_account_changed'] });
      account.subject = owner;
      expect(
        await search({
          ...book,
          glossaCloud: { ...book.glossaCloud!, manifest_id: crypto.randomUUID() },
        }),
      ).toEqual({ hits: [], errors: ['offline'] });
      expect(remote.gets).toEqual([remote.searchHash]);
      content.mockImplementation(load);
      const locator = found.hits[0]!.locator;
      const cfi = await resolveSearchResultCfi(session, book, locator);
      expect(cfi).toBeTruthy();
      expect(
        await resolveSearchResultCfi(session, book, {
          ...locator,
          sectionTextSha256: '0'.repeat(64),
        }),
      ).toBeNull();
      const doc = await (await session.open(book)).bookDoc.sections[
        locator.section
      ]!.createDocument();
      const parts = CFI.parse(cfi!);
      (parts.parent ?? parts).shift();
      expect(CFI.toRange(doc, parts)?.toString().toLowerCase()).toBe(term);
      expect(remote.signedRanges.length).toBeGreaterThan(0);
      await expect(
        decodeSearchPack(remote.searchPack!.body, {
          source_file_blake3: '0'.repeat(64),
          file_bytes: blob.size,
          format: format === 'PDF' ? 'pdf' : 'epub',
          language: 'en',
        }),
      ).rejects.toThrow('search_pack_mismatch');
    } finally {
      account.subject = owner;
      await session.close();
      await remote.file.close();
      await app.deleteDatabase(book.hash + '/search.db', 'Books');
    }
  }, 45000);
}

it('omits an image-only search pack and bounds decompression', async () => {
  const scan = (await sharedResourcePdf(true)).blob;
  const plan = await prepareFile(scan);
  const identity = {
    source_file_blake3: plan.file_blake3,
    file_bytes: scan.size,
    format: 'pdf' as const,
    language: 'en',
  };
  const search = new SearchPackBuilder(identity);
  expect(await buildPdfLayout(scan, plan, search)).toBeDefined();
  expect(await search.finish()).toBeUndefined();
  const oversized = new Blob([new Uint8Array((16 << 20) + 1)]);
  const gzip = await new Response(
    oversized.stream().pipeThrough(new CompressionStream('gzip')),
  ).blob();
  await expect(decodeSearchPack(gzip, identity)).rejects.toThrow('search_pack_too_large');
});

it('keeps blank page ordinals in a mixed scanned and text PDF', async () => {
  const pdf = await fixture('glossa-ocr-sample.pdf');
  const plan = await prepareFile(pdf);
  const identity = {
    source_file_blake3: plan.file_blake3,
    file_bytes: pdf.size,
    format: 'pdf' as const,
    language: 'en',
  };
  const search = new SearchPackBuilder(identity);
  await buildPdfLayout(pdf, plan, search);
  const asset = await search.finish();
  const rows = await decodeSearchPack(asset!.body, identity);
  expect(rows.map((row) => row.text.trim())).toEqual([
    '',
    '',
    '',
    'Native text keeps its original offsets.',
  ]);
  expect(rows[3]!.idx).toBe(3);
});
