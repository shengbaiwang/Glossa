import type { SourceAnchor } from '../citations/sourceAnchor';
import type { SelectedText, SourceSegment } from './types';

export type ContextSegment = {
  sourceId: string;
  text: string;
  anchor: SourceAnchor;
  role: 'previous' | 'selection';
};

/** The complete, bounded evidence set supplied to one Glossa request. */
export type ContextPack = {
  selectionSourceId: string;
  segments: ContextSegment[];
  hasPreviousContext: boolean;
  scopeLabel: string;
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
    scopeLabel: hasPreviousContext ? '选区 + 同章节前 1 段 · 未使用后文' : '仅选区 · 未使用后文',
  };
}
