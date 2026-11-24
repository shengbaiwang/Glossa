import { previewLongEdge, type HeadPreviewBuilder } from './headPreview';
import type { SearchPackBuilder } from './searchSidecar';
import type { PreparedFile, PublicationAsset } from '@glossa/sync-contracts/publisher';
import {
  maxPdfLayoutBytes,
  maxPdfLayoutPages,
  maxPdfRanges,
  pdfLayoutCodec,
  type ByteInterval,
} from './pdfLayout';
import { VerifiedSource } from './verifiedSource';

function mergeRanges(ranges: ByteInterval[]) {
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: ByteInterval[] = [];
  for (const [start, end] of ranges) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export async function buildPdfLayout(
  file: Blob,
  plan: PreparedFile,
  search?: SearchPackBuilder,
  preview?: HeadPreviewBuilder,
): Promise<PublicationAsset | undefined> {
  const source = new VerifiedSource(file, plan);
  let probe: ReturnType<typeof import('foliate-js/pdf.js').createPDFRangeProbe> | undefined;
  const readLayout = async (): Promise<PublicationAsset | undefined> => {
    const pages = [];
    let pageCount = 1,
      encodedBytes = 0;
    const { createPDFRangeProbe } = await import('foliate-js/pdf.js');
    probe = createPDFRangeProbe();
    const singleChunk = plan.chunks.length === 1;
    for (let page_index = 0; page_index < pageCount; page_index++) {
      const observed: ByteInterval[] = [];
      let total = 0;
      const traceFile = {
        size: plan.file_bytes,
        glossaRangeSource: true,
        slice(start: number, end: number) {
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start < 0 ||
            start >= end ||
            end > plan.file_bytes
          )
            throw new Error('invalid_pdf_range');
          total += end - start;
          // Some damaged PDFs cause PDF.js to fall back to reading the entire file.
          if (total > 48 << 20 || observed.length >= 4096) throw new Error('pdf_trace_too_large');
          observed.push([start, end - 1]);
          return { arrayBuffer: async () => (await source.read(start, end - start)).buffer };
        },
      };
      // Reading any byte of a single-chunk book already brings in the whole
      // object. One page-tree lookup gives an exact physical map for all pages.
      if (!singleChunk || page_index === 0) {
        const count = await probe.inspect(
          traceFile,
          page_index,
          singleChunk,
          search,
          preview && {
            edge: previewLongEdge,
            add: (index: number, canvas: HTMLCanvasElement) => preview.addPage(index, canvas),
          },
        );
        if (
          !Number.isSafeInteger(count) ||
          count < 1 ||
          count > maxPdfLayoutPages ||
          (page_index !== 0 && count !== pageCount)
        )
          return undefined;
        pageCount = count;
        if (preview) preview.pageCount = count;
      }
      const ranges: ByteInterval[] = singleChunk
        ? [[0, plan.file_bytes - 1]]
        : mergeRanges(observed);
      if (!ranges.length || ranges.length > maxPdfRanges) return undefined;
      const page = { page_index, ranges, dependencies_complete: false };
      encodedBytes += JSON.stringify(page).length + 1;
      if (encodedBytes > maxPdfLayoutBytes) return undefined;
      pages.push(page);
    }
    if (search) search.expectedSections = pageCount;
    const body = new Blob(
      [
        JSON.stringify({
          schema_version: 1,
          format: 'pdf',
          parser_version: probe.version,
          source_file_blake3: plan.file_blake3,
          file_bytes: plan.file_bytes,
          pages,
        }),
      ],
      { type: 'application/json' },
    );
    if (body.size > maxPdfLayoutBytes) return undefined;
    return { role: 'layout_manifest', codec_version: pdfLayoutCodec, mime: body.type, body };
  };

  let layout: PublicationAsset | undefined;
  try {
    layout = await readLayout();
  } catch (error) {
    if (source.failure) throw source.failure;
    if (!(error instanceof Error)) throw error;
  } finally {
    probe?.close();
  }
  if (source.failure) throw source.failure;
  return layout;
}
