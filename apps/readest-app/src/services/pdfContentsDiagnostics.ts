/** Observed failure classes. A title mismatch alone cannot establish an OCR error. */
export function classifyFailure(report?: { code?: string; stage?: string }) {
  const code = report?.code ?? '';
  if (!report) return 'unknown';
  if (code === 'pdf_contents_cancelled') return 'cancelled';
  if (code === 'pdf_contents_timeout') return 'timeout';
  if (code.endsWith('_limit')) return 'limit';
  if (report.stage === 'save' || code === 'outline_changed' || code === 'source_changed')
    return 'save';
  if (/^pdf_contents_(?:order|page_mapping)/.test(code)) return 'mapping';
  if (code === 'pdf_contents_incomplete' && report.stage === 'extraction') return 'extraction';
  if (/^pdf_contents_(?:heading_|incomplete|structure_)/.test(code)) return 'verification';
  if (code === 'pdf_contents_not_found') return 'discovery';
  if (code === 'pdf_contents_extraction_failed') return 'extraction';
  if (
    /^pdf_(?:recognition|ocr|word_boxes)/.test(code) ||
    /(?:fine|detection|heading)_ocr_failed$/.test(code)
  )
    return 'recognition';
  return 'runtime';
}
