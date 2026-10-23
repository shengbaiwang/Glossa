import { z } from 'zod';
import { createDerivedStore, hashData } from '@/glossa/harness/derivedStore';
import { outlineEntrySchema, savePDFOutline, type PDFCache } from '@/services/pdfEnhancement';

const snapshotSchema = z.object({
  outline: z.array(outlineEntrySchema).min(1).max(1000),
  generator: z.enum(['glossa-contents-2', 'glossa-contents-3']),
});
const history = createDerivedStore('glossa-pdf-contents-history', snapshotSchema, {
  entryBytes: 600000,
  entries: 16,
  totalBytes: 2000000,
});
const keyFor = (cache: PDFCache, count: number, revision = cache.revision) =>
  hashData({ id: cache.id, count, revision });

/** One-step recovery is bound to the file fingerprint, page count and exact saved revision. */
export async function rememberPDFContents(cache: PDFCache, count: number, signal: AbortSignal) {
  const previous = snapshotSchema.safeParse(cache);
  if (!previous.success) return;
  const key = await keyFor(cache, count, cache.revision + 1);
  await history.save(key, previous.data, signal);
  // A bounded store can reject an oversized record without throwing.
  if (!(await history.load(key))) throw new Error('pdf_contents_backup_failed');
}
export async function previousPDFContents(cache: PDFCache, count: number) {
  if (!cache.generator?.startsWith('glossa-contents-')) return null;
  return history.load(await keyFor(cache, count));
}
export async function restorePDFContents(
  source: string,
  cache: PDFCache,
  count: number,
  signal: AbortSignal,
) {
  const previous = await previousPDFContents(cache, count);
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!previous) throw new Error('outline_changed');
  return savePDFOutline(source, cache, previous.outline, count, previous.generator);
}
