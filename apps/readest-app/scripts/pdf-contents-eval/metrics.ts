import type { PDFOutlineEntry } from '../../src/services/pdfEnhancement';
export { classifyFailure } from '../../src/services/pdfContentsDiagnostics';

const titleKey = (title: string) => title.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const parentPaths = (entries: PDFOutlineEntry[]) => {
  const parents: string[] = [];
  return entries.map((entry) => {
    parents.length = entry.level;
    const path = JSON.stringify(parents);
    parents.push(`${titleKey(entry.title)}@${entry.pageIndex}`);
    return path;
  });
};

/** References are never manufactured from the output under evaluation. */
export function evaluateContents(
  expected: PDFOutlineEntry[],
  actual: PDFOutlineEntry[],
  audited: boolean,
) {
  const unmatched = new Set(actual.map((_, index) => index));
  const expectedParents = parentPaths(expected);
  const actualParents = parentPaths(actual);
  let missing = 0,
    wrongPage = 0,
    wrongLevel = 0,
    wrongParent = 0,
    correct = 0;
  for (const [expectedIndex, entry] of expected.entries()) {
    const candidates = [...unmatched].filter(
      (i) => titleKey(actual[i]!.title) === titleKey(entry.title),
    );
    // Repeated labels are legal. Prefer their actual destination before falling
    // back to the first occurrence; each published entry is counted once.
    const index = candidates.find((i) => actual[i]!.pageIndex === entry.pageIndex) ?? candidates[0];
    if (index === undefined) {
      missing++;
      continue;
    }
    unmatched.delete(index);
    const found = actual[index]!;
    if (found.pageIndex !== entry.pageIndex) wrongPage++;
    if (found.level !== entry.level) wrongLevel++;
    const parentMatches = expectedParents[expectedIndex] === actualParents[index];
    if (!parentMatches) wrongParent++;
    if (found.pageIndex === entry.pageIndex && found.level === entry.level && parentMatches)
      correct++;
  }
  return {
    expected: expected.length,
    published: actual.length,
    correct,
    missing,
    extra: unmatched.size,
    wrongPage,
    wrongLevel,
    wrongParent,
    complete: audited ? missing === 0 && unmatched.size === 0 && correct === expected.length : null,
  };
}
