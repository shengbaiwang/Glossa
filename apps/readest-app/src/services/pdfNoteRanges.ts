import * as CFI from 'foliate-js/epubcfi.js';

/** An additive field: cfi remains the first-page anchor for older clients. */
export function getPDFNoteRanges(note: { cfi: string; pdfRanges?: unknown }): string[] {
  if (note.pdfRanges === undefined) return [note.cfi];
  const ranges = note.pdfRanges;
  const invalid = () => new Error('pdf_annotation_unresolved');
  if (!Array.isArray(ranges) || ranges.length < 2 || ranges.length > 24 || ranges[0] !== note.cfi) {
    throw invalid();
  }
  let previous: number | undefined;
  let first: number | undefined;
  for (const cfi of ranges) {
    if (typeof cfi !== 'string' || cfi.length > 4096 || !CFI.isCFI.test(cfi)) throw invalid();
    try {
      const parts = CFI.parse(cfi);
      if (!parts.parent?.length || !parts.start?.length || !parts.end?.length) throw invalid();
      for (const path of [parts.parent, parts.start, parts.end]) {
        if (
          path.some(
            (steps: { index: number; offset?: number }[]) =>
              !steps.length ||
              steps.some(
                (step) =>
                  !Number.isSafeInteger(step.index) ||
                  step.index < 1 ||
                  (step.offset !== undefined &&
                    (!Number.isSafeInteger(step.offset) || step.offset < 0)),
              ),
          )
        ) {
          throw invalid();
        }
      }
      const index = CFI.fake.toIndex((parts.parent ?? parts)[0]);
      first ??= index;
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index - first >= 24 ||
        (previous !== undefined && index <= previous)
      ) {
        throw invalid();
      }
      previous = index;
    } catch {
      throw invalid();
    }
  }
  return [...ranges];
}
