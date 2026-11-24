import { z } from 'zod';
import { blake3 } from '@glossa/sync-contracts';

export const epubLayoutCodec = 'epub-spine-ranges-v1';
export const maxLayoutBytes = 2 << 20;
export const maxSpineItems = 8192;
const offset = z.int().nonnegative();

const spineEntry = z.strictObject({
  spine_index: offset,
  href: z.string().min(1).max(2048),
  header_offset: offset,
  zip_method: z.union([z.literal(0), z.literal(8)]),
  compressed_ranges: z.tuple([z.tuple([offset, offset])]),
  dependencies: z.array(z.string()).length(0),
  dependencies_complete: z.literal(false),
});
export type SpineRange = z.infer<typeof spineEntry>;

export function decodeEpubLayout(bytes: Uint8Array, hash: string, size: number) {
  if (bytes.length > maxLayoutBytes) throw new Error('layout_too_large');
  const value = z
    .strictObject({
      schema_version: z.literal(1),
      format: z.literal('epub'),
      file_bytes: offset,
      source_file_blake3: blake3,
      spine: z.array(spineEntry).min(1).max(maxSpineItems),
    })
    .parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (value.source_file_blake3 !== hash || value.file_bytes !== size)
    throw new Error('layout_source_mismatch');
  const paths = new Map<string, SpineRange>();
  for (const [i, item] of value.spine.entries()) {
    const [[start, end]] = item.compressed_ranges;
    if (item.spine_index !== i || item.header_offset + 30 > start || start > end || end >= size)
      throw new Error('invalid_spine_range');
    paths.set(item.href, item);
  }
  return paths;
}
