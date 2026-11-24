import { z } from 'zod';
import { blake3 } from '@glossa/sync-contracts';
import type { PublicationAsset } from '@glossa/sync-contracts/publisher';
import { searchTextFilter } from '@/utils/node';

export const searchCodec = 'section-text-gzip-v1';
const normalizer = 'foliate-text-walker-utf16-v1';
const maxInflated = 16 << 20;
export const maxSearchBytes = 4 << 20;
const maxSections = 16384;
const entry = z.strictObject({
  anchor: z.strictObject({ section: z.int().nonnegative() }),
  label: z.string().max(2048),
  text: z.string().max(4 << 20),
});
const pack = z.strictObject({
  schema_version: z.literal(1),
  source_file_blake3: blake3,
  file_bytes: z.int().positive(),
  format: z.enum(['epub', 'pdf']),
  language: z.string().max(128),
  normalizer: z.literal(normalizer),
  compression: z.literal('gzip'),
  section_count: z.int().min(1).max(maxSections),
  entries: z.array(entry).min(1).max(maxSections),
});
export type SearchIdentity = {
  source_file_blake3: string;
  file_bytes: number;
  format: 'pdf' | 'epub';
  language: string;
};

export class SearchPackBuilder {
  private entries: z.infer<typeof entry>[] = [];
  private size = 0;
  private hasText = false;
  expectedSections?: number;
  enabled = true;
  constructor(private identity: SearchIdentity) {
    this.enabled = identity.language.length <= 128;
  }
  async add(section: number, doc: Document, label = '') {
    if (!this.enabled) return;
    const { textWalker } = await import('foliate-js/text-walker.js');
    let text = '';
    for (const value of textWalker(
      doc,
      (parts: string[]) => [parts.join('')],
      searchTextFilter(this.identity.language),
    ))
      text = value;
    const row = { anchor: { section }, label: label.slice(0, 2048), text };
    if (section !== this.entries.length || section >= maxSections || text.length > 4 << 20) {
      this.discard();
      return;
    }
    this.size += new Blob([JSON.stringify(row)]).size + 1;
    if (this.size > maxInflated) {
      this.discard();
      return;
    }
    this.hasText ||= Boolean(text.trim());
    this.entries.push(row);
  }
  discard() {
    this.enabled = false;
    this.entries = [];
  }
  async finish(): Promise<PublicationAsset | undefined> {
    const count = this.expectedSections;
    if (
      !this.enabled ||
      !this.hasText ||
      this.entries.length !== count ||
      typeof CompressionStream !== 'function'
    )
      return;
    const raw = new Blob([
      JSON.stringify({
        ...this.identity,
        schema_version: 1,
        normalizer,
        compression: 'gzip',
        section_count: count,
        entries: this.entries,
      }),
    ]);
    this.discard();
    if (raw.size > maxInflated) return;
    try {
      const body = await new Response(
        raw.stream().pipeThrough(new CompressionStream('gzip')),
      ).blob();
      if (body.size <= maxSearchBytes)
        return {
          role: 'search_sidecar',
          mime: 'application/gzip',
          codec_version: searchCodec,
          body,
        };
    } catch {
      // Some WebViews expose CompressionStream without a working gzip codec.
    }
    return undefined;
  }
}

export async function decodeSearchPack(blob: Blob, expected: SearchIdentity) {
  if (blob.size > maxSearchBytes) throw new Error('search_pack_too_large');
  const reader = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxInflated) throw new Error('search_pack_too_large');
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const data = pack.parse(JSON.parse(parts.join('')));
  if (
    data.source_file_blake3 !== expected.source_file_blake3 ||
    data.file_bytes !== expected.file_bytes ||
    data.format !== expected.format ||
    data.language !== expected.language ||
    data.entries.length !== data.section_count ||
    data.entries.some((e, i) => e.anchor.section !== i)
  )
    throw new Error('search_pack_mismatch');
  return data.entries.map(({ anchor, label, text }) => ({ idx: anchor.section, label, text }));
}
