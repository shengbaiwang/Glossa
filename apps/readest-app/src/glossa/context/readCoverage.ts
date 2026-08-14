/**
 * Persisted evidence of EPUB text the reader has actually displayed after a
 * page turn or continuous scroll. This intentionally is not a progress
 * percentage: a table-of-contents, citation, or search jump must not turn the
 * skipped text into eligible AI context.
 */
export type EpubReadRange = {
  version: 1;
  sectionIndex: number;
  startCfi: string;
  endCfi: string;
};

type CfiComparator = (left: string, right: string) => number;

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isEpubReadRange = (value: unknown): value is EpubReadRange => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['version'] === 1 &&
    isNonNegativeInteger(record['sectionIndex']) &&
    typeof record['startCfi'] === 'string' &&
    record['startCfi'].trim().length > 0 &&
    typeof record['endCfi'] === 'string' &&
    record['endCfi'].trim().length > 0
  );
};

/** Readest/follow-up navigation reasons which prove the user saw a range. */
export const shouldRecordEpubReadingEvent = (reason: unknown): boolean =>
  reason === 'page' || reason === 'scroll';

/** Unknown or old persisted data never widens the evidence set. */
export const parseEpubReadCoverage = (value: unknown): EpubReadRange[] =>
  Array.isArray(value) ? value.filter(isEpubReadRange) : [];

const normalizeRange = (range: EpubReadRange, compareCfi: CfiComparator): EpubReadRange =>
  compareCfi(range.startCfi, range.endCfi) <= 0
    ? range
    : { ...range, startCfi: range.endCfi, endCfi: range.startCfi };

/**
 * Add a visible range and merge only overlapping ranges in the same section.
 * Keeping gaps is deliberate: navigating to a later chapter must never imply
 * that the intervening text was read.
 */
export const addEpubReadRange = (
  current: unknown,
  next: EpubReadRange,
  compareCfi: CfiComparator,
): EpubReadRange[] => {
  const ranges = [...parseEpubReadCoverage(current), next]
    .map((range) => normalizeRange(range, compareCfi))
    .sort(
      (left, right) =>
        left.sectionIndex - right.sectionIndex || compareCfi(left.startCfi, right.startCfi),
    );
  const merged: EpubReadRange[] = [];
  for (const candidate of ranges) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.sectionIndex === candidate.sectionIndex &&
      compareCfi(candidate.startCfi, previous.endCfi) <= 0
    ) {
      if (compareCfi(candidate.endCfi, previous.endCfi) > 0) previous.endCfi = candidate.endCfi;
    } else {
      merged.push({ ...candidate });
    }
  }
  return merged;
};

/** A candidate without a resolvable CFI is excluded rather than guessed. */
export const isEpubSourceInReadCoverage = (
  cfi: string | undefined,
  sectionIndex: number | undefined,
  coverage: unknown,
  compareCfi: CfiComparator,
): boolean => {
  if (!cfi?.trim() || !isNonNegativeInteger(sectionIndex)) return false;
  return parseEpubReadCoverage(coverage).some(
    (range) =>
      range.sectionIndex === sectionIndex &&
      compareCfi(range.startCfi, cfi) <= 0 &&
      compareCfi(cfi, range.endCfi) <= 0,
  );
};

/**
 * A chapter-summary block is eligible only when its complete native range is
 * inside one recorded reading interval. Checking one endpoint alone could
 * accidentally send the unread tail of a paragraph.
 */
export const isEpubRangeInReadCoverage = (
  startCfi: string | undefined,
  endCfi: string | undefined,
  sectionIndex: number | undefined,
  coverage: unknown,
  compareCfi: CfiComparator,
): boolean => {
  if (!startCfi?.trim() || !endCfi?.trim() || !isNonNegativeInteger(sectionIndex)) return false;
  const [start, end] = compareCfi(startCfi, endCfi) <= 0 ? [startCfi, endCfi] : [endCfi, startCfi];
  return parseEpubReadCoverage(coverage).some(
    (range) =>
      range.sectionIndex === sectionIndex &&
      compareCfi(range.startCfi, start) <= 0 &&
      compareCfi(end, range.endCfi) <= 0,
  );
};
