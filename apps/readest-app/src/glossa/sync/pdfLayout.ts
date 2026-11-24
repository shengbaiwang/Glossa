import { z } from 'zod';
import { blake3 } from '@glossa/sync-contracts';

export const pdfLayoutCodec = 'pdfjs-display-ranges-v1';
export const maxPdfLayoutBytes = 2 << 20;
export const maxPdfLayoutPages = 16384;
export const maxPdfRanges = 256;
export type ByteInterval = [number, number];
const offset = z.int().nonnegative();
const page = z.strictObject({
  page_index: offset,
  ranges: z
    .array(z.tuple([offset, offset]))
    .min(1)
    .max(maxPdfRanges),
  dependencies_complete: z.literal(false),
});

export function decodePdfLayout(bytes: Uint8Array, hash: string, size: number, parser: string) {
  if (bytes.length > maxPdfLayoutBytes) throw new Error('layout_too_large');
  const layout = z
    .strictObject({
      schema_version: z.literal(1),
      format: z.literal('pdf'),
      source_file_blake3: blake3,
      file_bytes: offset,
      parser_version: z.string().min(1).max(80),
      pages: z.array(page).min(1).max(maxPdfLayoutPages),
    })
    .parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (
    layout.source_file_blake3 !== hash ||
    layout.file_bytes !== size ||
    layout.parser_version !== parser
  )
    throw new Error('layout_source_mismatch');
  for (const [index, page] of layout.pages.entries()) {
    if (index !== page.page_index) throw new Error('invalid_page_index');
    let previous = -1;
    for (const [start, end] of page.ranges) {
      if (start <= previous || start > end || end >= size) throw new Error('invalid_pdf_range');
      previous = end;
    }
  }
  return layout.pages;
}
