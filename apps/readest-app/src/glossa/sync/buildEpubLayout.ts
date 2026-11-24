import type { HeadPreviewBuilder } from './headPreview';
import type { SearchPackBuilder } from './searchSidecar';
import { BlobReader, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { VerifiedSource } from './verifiedSource';
import type { PreparedFile, PublicationAsset } from '@glossa/sync-contracts/publisher';
import { epubLayoutCodec, maxLayoutBytes, maxSpineItems, type SpineRange } from './epubLayout';

class VerifiedZipReader extends BlobReader {
  constructor(
    file: Blob,
    readonly source: VerifiedSource,
  ) {
    super(file);
  }
  override readUint8Array(index: number, length: number) {
    if (length > 4 << 20) throw new Error('unsupported_zip_range');
    return this.source.read(index, length);
  }
}

async function metadataXml(
  entry: FileEntry | undefined,
  mime: DOMParserSupportedType = 'application/xml',
  max = 1 << 20,
) {
  if (!entry || entry.encrypted || entry.compressedSize > max || entry.uncompressedSize > max)
    throw new Error('unsupported_package_metadata');
  const bytes = new Uint8Array(entry.uncompressedSize);
  let pos = 0;
  await entry.getData(
    new WritableStream<Uint8Array>({
      write(chunk) {
        if (pos + chunk.length > bytes.length) throw new Error('invalid_package_length');
        bytes.set(chunk, pos);
        pos += chunk.length;
      },
    }),
    { checkSignature: true, useWebWorkers: false },
  );
  if (pos !== bytes.length) throw new Error('invalid_package_length');
  const doc = new DOMParser().parseFromString(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    mime,
  );
  if (doc.getElementsByTagName('parsererror').length) throw new Error('invalid_package_xml');
  return doc;
}

export async function buildEpubLayout(
  file: Blob,
  plan: PreparedFile,
  search?: SearchPackBuilder,
  preview?: HeadPreviewBuilder,
): Promise<PublicationAsset | undefined> {
  const source = new VerifiedSource(file, plan);
  const reader = new VerifiedZipReader(file, source);
  const zip = new ZipReader(reader);
  const readLayout = async (): Promise<PublicationAsset | undefined> => {
    const entries = new Map<string, FileEntry>();
    let count = 0;
    for await (const entry of zip.getEntriesGenerator()) {
      if (++count > 32768) return;
      if (entry.directory) continue;
      if (entries.has(entry.filename) || entry.diskNumberStart !== 0) return;
      entries.set(entry.filename, entry);
    }
    const container = await metadataXml(entries.get('META-INF/container.xml'));
    const root = Array.from(container.getElementsByTagNameNS('*', 'rootfile'))
      .find((item) => item.getAttribute('media-type') === 'application/oebps-package+xml')
      ?.getAttribute('full-path');
    if (!root || root.startsWith('/') || root.includes('\\')) return;
    const opf = await metadataXml(entries.get(root));
    const manifest = opf.getElementsByTagNameNS('*', 'manifest')[0];
    const spine = opf.getElementsByTagNameNS('*', 'spine')[0];
    if (!manifest || !spine) return;
    const base = new URL('https://epub.invalid/');
    base.pathname = '/' + root.split('/').map(encodeURIComponent).join('/');
    const paths = new Map<string, string>();
    const textPaths = new Set<string>();
    for (const item of manifest.children) {
      const id = item.getAttribute('id'),
        ref = item.getAttribute('href');
      if (!id || !ref || item.localName !== 'item') continue;
      if (paths.has(id)) return;
      const url = new URL(ref, base);
      if (url.origin === base.origin) {
        paths.set(id, decodeURIComponent(url.pathname.slice(1)));
        if (item.getAttribute('media-type') === 'application/xhtml+xml') textPaths.add(id);
      }
    }
    const rows: SpineRange[] = [];
    let wantChapter = Boolean(preview);
    for (const item of spine.children) {
      if (item.localName !== 'itemref') continue;
      const href = paths.get(item.getAttribute('idref') ?? '');
      const entry = href && entries.get(href);
      if (
        !entry ||
        href.length > 2048 ||
        rows.length >= maxSpineItems ||
        entry.encrypted ||
        !entry.compressedSize ||
        (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)
      )
        return;
      const linear = item.getAttribute('linear') !== 'no';
      const firstChapter = wantChapter && linear;
      if (search?.enabled || firstChapter) {
        try {
          if (!textPaths.has(item.getAttribute('idref') ?? '')) {
            search?.discard();
            if (firstChapter) wantChapter = false;
          } else {
            const doc = await metadataXml(entry, 'application/xhtml+xml', 4 << 20);
            if (firstChapter) {
              // Skip standalone front matter designated by the package author.
              const nodes = [doc.body, ...Array.from(doc.body?.children ?? [])];
              const front = nodes.some((el) =>
                el
                  ?.getAttributeNS('http://www.idpf.org/2007/ops', 'type')
                  ?.split(/\s+/)
                  .some((type) => ['cover', 'toc', 'titlepage', 'halftitlepage'].includes(type)),
              );
              if (!front) {
                preview?.addChapter(doc);
                wantChapter = false;
              }
            }
            if (search?.enabled)
              await search.add(rows.length, doc, doc.querySelector('title')?.textContent ?? '');
          }
        } catch {
          search?.discard();
          if (firstChapter) wantChapter = false;
        }
      }
      const bytes = await reader.readUint8Array(entry.offset, 30);
      if (bytes.length !== 30) return;
      const header = new DataView(bytes.buffer);
      if (
        header.getUint32(0, true) !== 0x04034b50 ||
        header.getUint16(8, true) !== entry.compressionMethod
      )
        return;
      const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
      const end = start + entry.compressedSize - 1;
      if (!Number.isSafeInteger(end) || end >= file.size) return;
      rows.push({
        spine_index: rows.length,
        href,
        header_offset: entry.offset,
        zip_method: entry.compressionMethod,
        compressed_ranges: [[start, end]],
        dependencies: [],
        dependencies_complete: false,
      });
    }
    if (!rows.length) return;
    if (search) search.expectedSections = rows.length;
    const body = new Blob(
      [
        JSON.stringify({
          schema_version: 1,
          format: 'epub',
          file_bytes: plan.file_bytes,
          source_file_blake3: plan.file_blake3,
          spine: rows,
        }),
      ],
      { type: 'application/json' },
    );
    if (body.size <= maxLayoutBytes)
      return { role: 'layout_manifest', mime: body.type, codec_version: epubLayoutCodec, body };
    return undefined;
  };

  let layout: PublicationAsset | undefined;
  try {
    layout = await readLayout();
  } catch (error) {
    // Optional acceleration. An unsupported package still publishes and reads via the ZIP parser.
    if (source.failure) throw source.failure;
    if (!(error instanceof Error)) throw error;
  } finally {
    await zip.close();
  }
  if (source.failure) throw source.failure;
  return layout;
}
