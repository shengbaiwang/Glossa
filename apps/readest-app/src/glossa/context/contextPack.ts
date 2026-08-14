import type { SourceAnchor } from '../citations/sourceAnchor';
import type { SelectedText, SourceSegment, StructuredTextBlock } from './types';

export const MAX_CHAPTER_CONTEXT_SEGMENTS = 32;
export const MAX_CHAPTER_CONTEXT_CHARACTERS = 12_000;
export const MAX_REQUEST_CONTEXT_SEGMENTS = 40;
export const MAX_REQUEST_CONTEXT_CHARACTERS = 16_000;

export type ContextScope =
  | { kind: 'minimal'; excludesSelectionAfter: true }
  | {
      kind: 'chapter-to-selection';
      excludesSelectionAfter: true;
      chapterSegmentCount: number;
      truncated: boolean;
    }
  | {
      kind: 'read-section';
      excludesUnreadSectionText: true;
      chapterSegmentCount: number;
      truncated: boolean;
      /** Fingerprint of every locally proved read block, before the request budget. */
      evidenceFingerprint: string;
    };

export type ContextSegment = {
  sourceId: string;
  text: string;
  anchor: SourceAnchor;
  role: 'previous' | 'selection' | 'chapter' | 'retrieval';
};

/** The complete, bounded evidence set supplied to one Glossa request. */
export type ContextPack = {
  selectionSourceId: string;
  segments: ContextSegment[];
  hasPreviousContext: boolean;
  scope: ContextScope;
  scopeLabel: string;
  retrieval: { segmentCount: number; truncated: boolean } | null;
};

const anchorKey = (anchor: SourceAnchor): string =>
  [
    anchor.documentId,
    anchor.format,
    anchor.sectionId ?? '',
    anchor.cfi ?? '',
    anchor.quote.exact,
    anchor.quote.prefix ?? '',
    anchor.quote.suffix ?? '',
  ].join('\u001f');

const sameAnchor = (left: SourceAnchor, right: SourceAnchor): boolean =>
  anchorKey(left) === anchorKey(right);

// FNV-1a keeps source IDs deterministic without bringing document content or a
// browser-only encoder into the domain protocol.
const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const stableEvidenceFingerprint = (blocks: Pick<StructuredTextBlock, 'anchor'>[]): string => {
  let hash = 0xcbf29ce484222325n;
  for (const block of blocks) {
    for (const character of anchorKey(block.anchor)) {
      hash ^= BigInt(character.codePointAt(0) ?? 0);
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
  }
  return hash.toString(16).padStart(16, '0');
};

const sourceIdFor = (segment: SourceSegment, taken: Set<string>): string => {
  const base = `source_${stableHash(anchorKey(segment.anchor))}`;
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) candidate = `${base}_${suffix++}`;
  taken.add(candidate);
  return candidate;
};

/**
 * Build the smallest safe evidence set for C03: the selected range and at
 * most one paragraph immediately before it in the same chapter. The adapter
 * returns neighbouring paragraphs in document order. It cannot prove that a
 * following paragraph was read, so following text is deliberately excluded.
 */
export function createContextPack(options: {
  selection: SelectedText;
  selectionContext: SourceSegment[];
}): ContextPack {
  const { selection, selectionContext } = options;
  const selectedIndex = selectionContext.findIndex((segment) =>
    sameAnchor(segment.anchor, selection.anchor),
  );
  const preceding =
    selectedIndex > 0
      ? selectionContext
          .slice(0, selectedIndex)
          .filter((segment) => segment.anchor.sectionId === selection.anchor.sectionId)
          .at(-1)
      : undefined;
  const taken = new Set<string>();
  const segments: ContextSegment[] = [];
  if (preceding && !sameAnchor(preceding.anchor, selection.anchor)) {
    segments.push({
      sourceId: sourceIdFor(preceding, taken),
      text: preceding.text,
      anchor: preceding.anchor,
      role: 'previous',
    });
  }
  const selectionSourceId = sourceIdFor(selection, taken);
  segments.push({
    sourceId: selectionSourceId,
    text: selection.text,
    anchor: selection.anchor,
    role: 'selection',
  });
  const hasPreviousContext = segments.some(({ role }) => role === 'previous');
  return {
    selectionSourceId,
    segments,
    hasPreviousContext,
    scope: { kind: 'minimal', excludesSelectionAfter: true },
    scopeLabel: hasPreviousContext ? '选区 + 同章节前 1 段 · 未使用后文' : '仅选区 · 未使用后文',
    retrieval: null,
  };
}

const normalizedText = (text: string): string => text.replace(/\s+/gu, ' ').trim();

const sameEvidence = (left: SourceSegment, right: SourceSegment): boolean =>
  sameAnchor(left.anchor, right.anchor) || normalizedText(left.text) === normalizedText(right.text);

/**
 * Build a deterministic chapter-start-to-selection pack. `precedingBlocks`
 * must already be proved by the EPUB adapter to end before the selection; the
 * domain layer deliberately has no DOM or progress-based fallback.
 */
export function createChapterToSelectionContextPack(options: {
  selection: SelectedText;
  precedingBlocks: StructuredTextBlock[];
}): ContextPack {
  const { selection } = options;
  const blocks = options.precedingBlocks.filter(
    (block, index, all) =>
      block.text.trim() &&
      block.anchor.sectionId === selection.anchor.sectionId &&
      !sameEvidence(block, selection) &&
      !all.slice(0, index).some((earlier) => sameEvidence(earlier, block)),
  );
  const selectionCharacters = Array.from(selection.text).length;
  const availableCharacters = Math.max(0, MAX_CHAPTER_CONTEXT_CHARACTERS - selectionCharacters);
  const availableSegments = Math.max(0, MAX_CHAPTER_CONTEXT_SEGMENTS - 1);
  const included = new Set<StructuredTextBlock>();
  let usedCharacters = 0;

  // Preserve a chapter title when it fits, then take the closest earlier blocks
  // backwards. Sorting at the end restores document order for the provider.
  const heading = blocks.find((block) => block.kind === 'heading');
  if (heading && Array.from(heading.text).length <= availableCharacters && availableSegments > 0) {
    included.add(heading);
    usedCharacters += Array.from(heading.text).length;
  }
  for (const block of [...blocks].reverse()) {
    if (included.has(block) || included.size >= availableSegments) continue;
    const length = Array.from(block.text).length;
    if (usedCharacters + length > availableCharacters) continue;
    included.add(block);
    usedCharacters += length;
  }
  const selectedBlocks = blocks.filter((block) => included.has(block));
  const truncated =
    selectedBlocks.length !== blocks.length || selectionCharacters > MAX_CHAPTER_CONTEXT_CHARACTERS;
  const taken = new Set<string>();
  const segments: ContextSegment[] = selectedBlocks.map((block) => ({
    sourceId: sourceIdFor(block, taken),
    text: block.text,
    anchor: block.anchor,
    role: 'chapter',
  }));
  const selectionSourceId = sourceIdFor(selection, taken);
  segments.push({
    sourceId: selectionSourceId,
    text: selection.text,
    anchor: selection.anchor,
    role: 'selection',
  });
  const chapterSegmentCount = segments.length;
  return {
    selectionSourceId,
    segments,
    hasPreviousContext: selectedBlocks.length > 0,
    scope: {
      kind: 'chapter-to-selection',
      excludesSelectionAfter: true,
      chapterSegmentCount,
      truncated,
    },
    scopeLabel: truncated
      ? `本章开头至选区 · 最近 ${chapterSegmentCount} 段（已截断）· 未使用后文`
      : `本章开头至选区 · ${chapterSegmentCount} 段 · 未使用后文`,
    retrieval: null,
  };
}

/**
 * Build a summary evidence pack from blocks that the adapter has already
 * proved fully read. It deliberately has no synthetic selection: F02 is about
 * the current chapter's read portion, not the current cursor position.
 */
export function createReadSectionContextPack(options: {
  section: Pick<StructuredTextBlock, 'text' | 'anchor' | 'kind' | 'order'>[];
}): ContextPack | null {
  const blocks = options.section.filter(
    (block, index, all) =>
      block.text.trim() && !all.slice(0, index).some((earlier) => sameEvidence(earlier, block)),
  );
  if (blocks.length === 0) return null;
  const included = new Set<(typeof blocks)[number]>();
  let usedCharacters = 0;
  const heading = blocks.find((block) => block.kind === 'heading');
  if (heading && Array.from(heading.text).length <= MAX_CHAPTER_CONTEXT_CHARACTERS) {
    included.add(heading);
    usedCharacters += Array.from(heading.text).length;
  }
  for (const block of [...blocks].reverse()) {
    if (included.has(block) || included.size >= MAX_CHAPTER_CONTEXT_SEGMENTS) continue;
    const length = Array.from(block.text).length;
    if (usedCharacters + length > MAX_CHAPTER_CONTEXT_CHARACTERS) continue;
    included.add(block);
    usedCharacters += length;
  }
  const selectedBlocks = blocks.filter((block) => included.has(block));
  const taken = new Set<string>();
  const segments: ContextSegment[] = selectedBlocks.map((block) => ({
    sourceId: sourceIdFor(block, taken),
    text: block.text,
    anchor: block.anchor,
    role: 'chapter',
  }));
  const truncated = selectedBlocks.length !== blocks.length;
  return {
    // Preserved for shared ContextPack compatibility; F02 never treats this as
    // a selected range and validates every summary source independently.
    selectionSourceId: segments[0]!.sourceId,
    segments,
    hasPreviousContext: false,
    scope: {
      kind: 'read-section',
      excludesUnreadSectionText: true,
      chapterSegmentCount: segments.length,
      truncated,
      evidenceFingerprint: stableEvidenceFingerprint(blocks),
    },
    scopeLabel: truncated
      ? `本章已读部分 · 最近 ${segments.length} 段（已截断）· 未使用后文`
      : `本章已读部分 · ${segments.length} 段 · 未使用后文`,
    retrieval: null,
  };
}

const keywordScore = (text: string, query: string): number => {
  const words = query.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const normalized = normalizedText(text).toLocaleLowerCase();
  return words.reduce((score, word) => score + (normalized.includes(word) ? 1 : 0), 0);
};

/**
 * Keep selection-time evidence intact, then add only compact, local keyword
 * matches from E06. Candidate order is deterministic and no text is sliced:
 * when the budget is exhausted the candidate is simply not sent.
 */
export const addReadKeywordCandidates = (options: {
  contextPack: ContextPack;
  query: string;
  candidates: SourceSegment[];
  maximumCharacters?: number;
  maximumSegments?: number;
}): ContextPack => {
  const {
    contextPack,
    query,
    candidates,
    maximumCharacters = MAX_REQUEST_CONTEXT_CHARACTERS,
    maximumSegments = MAX_REQUEST_CONTEXT_SEGMENTS,
  } = options;
  const existingKeys = new Set(contextPack.segments.map(({ anchor }) => anchorKey(anchor)));
  const seenCandidateKeys = new Set<string>();
  const uniqueCandidates = candidates
    .filter((candidate) => {
      const key = anchorKey(candidate.anchor);
      if (!candidate.text.trim() || existingKeys.has(key) || seenCandidateKeys.has(key))
        return false;
      seenCandidateKeys.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        keywordScore(right.text, query) - keywordScore(left.text, query) ||
        anchorKey(left.anchor).localeCompare(anchorKey(right.anchor)),
    );
  const selected = [...contextPack.segments];
  const taken = new Set(selected.map(({ sourceId }) => sourceId));
  let usedCharacters = selected.reduce(
    (total, segment) => total + Array.from(segment.text).length,
    0,
  );
  let truncated = false;
  for (const candidate of uniqueCandidates) {
    const length = Array.from(candidate.text).length;
    if (selected.length >= maximumSegments || usedCharacters + length > maximumCharacters) {
      truncated = true;
      continue;
    }
    selected.push({
      sourceId: sourceIdFor(candidate, taken),
      text: candidate.text,
      anchor: candidate.anchor,
      role: 'retrieval',
    });
    usedCharacters += length;
  }
  const segmentCount = selected.filter(({ role }) => role === 'retrieval').length;
  return {
    ...contextPack,
    segments: selected,
    scopeLabel:
      segmentCount > 0
        ? `${contextPack.scopeLabel} + 已读范围关键词检索 ${segmentCount} 段${truncated ? '（已截断）' : ''}`
        : contextPack.scopeLabel,
    retrieval: { segmentCount, truncated },
  };
};
