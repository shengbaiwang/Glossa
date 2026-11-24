import type { PDFOutlineEntry } from './pdfEnhancement';

type Folio = { group: number; printed: number; scope?: number };
type Path = {
  entry: PDFOutlineEntry;
  anchor?: { group: number; offset: number };
  count: number;
  previous?: Path;
};

/**
 * A numbered segment can acquire extra physical pages, but the offset cannot
 * shrink without independent, unambiguous anchors on both sides of a gap.
 * Carry the last numbered anchor
 * across unnumbered headings. Count all admissible paths, saturating at two.
 */
export function alignContentsTargets(
  targets: readonly (readonly PDFOutlineEntry[])[],
  folios: readonly (Folio | undefined)[] = [],
): PDFOutlineEntry[] | 'none' | 'ambiguous' {
  const anchors = new Map<string, Set<number>>();
  targets.forEach((candidates, index) => {
    const folio = folios[index];
    if (!folio || candidates.length !== 1) return;
    for (const entry of candidates) {
      const key = `${folio.group}:${entry.pageIndex - folio.printed}`;
      const pages = anchors.get(key) ?? new Set<number>();
      pages.add(entry.pageIndex);
      anchors.set(key, pages);
    }
  });
  const supported = (group: number, offset: number) =>
    (anchors.get(`${group}:${offset}`)?.size ?? 0) >= 2;
  let previous: Path[] = [];
  for (const [index, candidates] of targets.entries()) {
    const folio = folios[index];
    const current: Path[] = [];
    for (const entry of candidates) {
      const numbered = folio && { group: folio.group, offset: entry.pageIndex - folio.printed };
      if (!index) {
        current.push({ entry, anchor: numbered, count: 1 });
        continue;
      }
      const paths = new Map<string, Path>();
      for (const predecessor of previous) {
        if (predecessor.entry.pageIndex > entry.pageIndex) continue;
        const prior = predecessor.anchor;
        if (
          folios[index - 1]?.scope !== folio?.scope &&
          predecessor.entry.pageIndex === entry.pageIndex
        )
          continue;
        if (
          numbered &&
          prior?.group === numbered.group &&
          prior.offset > numbered.offset &&
          !(supported(prior.group, prior.offset) && supported(numbered.group, numbered.offset))
        )
          continue;
        const anchor = numbered ?? prior;
        const key = anchor ? `${anchor.group}:${anchor.offset}` : '';
        const path = paths.get(key);
        if (path) path.count = Math.min(2, path.count + predecessor.count);
        else paths.set(key, { entry, anchor, count: predecessor.count, previous: predecessor });
      }
      current.push(...paths.values());
    }
    previous = current;
  }
  const paths = previous.reduce((count, candidate) => count + candidate.count, 0);
  if (!paths) return 'none';
  if (paths > 1) return 'ambiguous';
  const outline: PDFOutlineEntry[] = [];
  for (let path = previous[0]; path; path = path.previous) outline.push(path.entry);
  return outline.reverse();
}
