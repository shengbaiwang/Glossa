import { decodePdfLayout, pdfLayoutCodec, maxPdfLayoutBytes } from './pdfLayout';
import { decodeEpubLayout, epubLayoutCodec, maxLayoutBytes, type SpineRange } from './epubLayout';
import type { CloudRangeReader } from '@glossa/sync-contracts/reader';

// Convert Blob.slice indices to the half-open absolute range used by PDF.js and zip.js.
function index(value: number | undefined, length: number, fallback: number) {
  if (value === undefined) return fallback;
  const n = Math.trunc(value) || 0;
  return n < 0 ? Math.max(0, length + n) : Math.min(length, n);
}
class RangeBlob extends Blob {
  private source: CloudRangeReader;
  private begin: number;
  private end: number;
  constructor(source: CloudRangeReader, begin: number, end: number, type = '') {
    super([], { type });
    this.source = source;
    this.begin = begin;
    this.end = end;
  }
  override get size() {
    return this.end - this.begin;
  }
  override slice(start?: number, end?: number, type = '') {
    const a = index(start, this.size, 0),
      b = index(end, this.size, this.size);
    return new RangeBlob(this.source, this.begin + a, this.begin + Math.max(a, b), type);
  }
  override async bytes() {
    return this.source.read(this.begin, this.end);
  }
  override async arrayBuffer() {
    return (await this.bytes()).buffer;
  }
  override async text() {
    return new TextDecoder().decode(await this.bytes());
  }
  override stream() {
    let at = this.begin;
    const end = this.end,
      source = this.source;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      async pull(controller) {
        if (at >= end) {
          controller.close();
          return;
        }
        const next = Math.min(end, at + 1024 * 1024);
        controller.enqueue(await source.read(at, next));
        at = next;
      },
    });
  }
}
export class CloudReaderFile extends File {
  private readonly view: RangeBlob;
  private readonly source: CloudRangeReader;
  // makePDF uses the PDF.js range transport and skips background full-file prefetch.
  readonly glossaRangeSource = true;
  constructor(
    source: CloudRangeReader,
    name: string,
    type: string,
    private readonly previewScope?: string,
  ) {
    super([], name, { type, lastModified: 0 });
    this.source = source;
    this.view = new RangeBlob(source, 0, source.size, type);
  }
  override get size() {
    return this.view.size;
  }
  override slice(start?: number, end?: number, type?: string) {
    return this.view.slice(start, end, type);
  }
  override arrayBuffer() {
    return this.view.arrayBuffer();
  }
  override bytes() {
    return this.view.bytes();
  }
  override text() {
    return this.view.text();
  }
  override stream() {
    return this.view.stream();
  }
  private layout?: Promise<Map<string, SpineRange> | undefined>;
  async warmEpubText(entry: {
    filename: string;
    offset: number;
    compressedSize: number;
    compressionMethod: number;
  }) {
    const asset = this.source.assets.find((a) => a.role === 'layout_manifest');
    if (asset?.codec_version !== epubLayoutCodec || asset.bytes > maxLayoutBytes) return;
    this.layout ??= this.source
      .asset('layout_manifest')
      .then((bytes) => decodeEpubLayout(bytes, this.source.fileHash, this.size))
      .catch(() => undefined);
    const row = (await this.layout)?.get(entry.filename);
    if (!row || row.header_offset !== entry.offset || row.zip_method !== entry.compressionMethod)
      return;
    const [[start, end]] = row.compressed_ranges;
    // The local ZIP parser still interprets the header, compressed data and linked resources.
    if (end - start + 1 !== entry.compressedSize || start - entry.offset > 30 + 2 * 65535) return;
    await this.source.warmZipEntry(entry.offset, end + 1);
  }
  private pdfLayout?: Promise<ReturnType<typeof decodePdfLayout> | undefined>;
  async warmPdfPage(index: number, parser: string) {
    const asset = this.source.assets.find((a) => a.role === 'layout_manifest');
    if (asset?.codec_version !== pdfLayoutCodec || asset.bytes > maxPdfLayoutBytes) return;
    this.pdfLayout ??= this.source
      .asset('layout_manifest')
      .then((bytes) => decodePdfLayout(bytes, this.source.fileHash, this.size, parser))
      .catch(() => undefined);
    const page = (await this.pdfLayout)?.[index];
    if (page) await this.source.warmPdfRanges(page.ranges).catch(() => undefined);
  }
  async headPreview(format: 'epub' | 'pdf') {
    const asset = this.source.assets.find((a) => a.role === 'head_preview_chunk');
    if (!asset) return;
    const { decodeHeadPreview, previewCodec, maxPreviewBytes } = await import('./headPreview');
    if (asset.codec_version !== previewCodec || asset.bytes > maxPreviewBytes) return;
    const { loadPreviewBytes } = await import('./previewCache');
    const bytes = await loadPreviewBytes(
      this.previewScope,
      asset.blake3,
      asset.bytes,
      this.size,
      () => this.source.asset('head_preview_chunk'),
    );
    return decodeHeadPreview(bytes, this.source.fileHash, this.size, format);
  }
  async searchSections(format: 'pdf' | 'epub', language: string) {
    const { decodeSearchPack, searchCodec, maxSearchBytes } = await import('./searchSidecar');
    const asset = this.source.assets.find((a) => a.role === 'search_sidecar');
    if (asset?.codec_version !== searchCodec || asset.bytes > maxSearchBytes) return undefined;
    return decodeSearchPack(new Blob([await this.source.asset('search_sidecar')]), {
      format,
      language,
      source_file_blake3: this.source.fileHash,
      file_bytes: this.size,
    });
  }
  async close() {
    this.source.close();
  }
}
