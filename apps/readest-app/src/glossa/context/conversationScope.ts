import type { BookDoc } from '@/libs/document';
import type { ChapterDescriptor, ChapterSource } from './types';
import { extractChapter } from './chapters';
import { checkAborted } from './text';

export type ConversationScope =
  | 'page'
  | 'selection'
  | 'paragraph'
  | 'section'
  | 'article'
  | 'chapter'
  | 'book'
  | 'none';
export const SCOPE_LABELS: Record<ConversationScope, string> = {
  page: 'Current page',
  selection: 'Selected text',
  paragraph: 'One paragraph',
  section: 'One section',
  article: 'One article',
  chapter: 'One chapter',
  book: 'Whole book',
  none: 'No reading context',
};

const termsFor = (question: string): string[] => {
  const runs = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [
    ...new Set(
      runs.flatMap((run) =>
        /[\u3400-\u9fff]/.test(run)
          ? Array.from({ length: Math.max(0, run.length - 1) }, (_, i) => run.slice(i, i + 2))
          : run.length > 2
            ? [run]
            : [],
      ),
    ),
  ].slice(0, 40);
};

/** Deterministic local keyword retrieval, with distributed samples for broad questions. */
export function selectScopeEvidence(
  sources: ChapterSource[],
  question: string,
  wholeBook = false,
  budget = 6000,
): ChapterSource[] {
  const total = sources.reduce((n, s) => n + s.text.length, 0);
  if (!wholeBook && total <= budget && sources.length <= 60) return sources;
  const terms = termsFor(question);
  const ranked = sources.map((source, index) => ({
    source,
    index,
    score: terms.reduce(
      (n, term) => n + (source.text.toLowerCase().includes(term) ? term.length : 0),
      0,
    ),
  }));
  const matches = ranked
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const candidates = matches.length
    ? matches
    : Array.from(
        { length: Math.min(8, sources.length) },
        (_, i) => ranked[Math.floor((i * sources.length) / Math.min(8, sources.length))]!,
      );
  // Whole-book scope authorizes local retrieval, never uploading an entire book.
  const cap = wholeBook ? Math.min(8, Math.max(0, sources.length - 1)) : 12;
  const selected: typeof ranked = [];
  let size = 0;
  for (const item of candidates) {
    if (selected.length >= cap) break;
    if (size + item.source.text.length > budget) continue;
    size += item.source.text.length;
    selected.push(item);
  }
  return selected.sort((a, b) => a.index - b.index).map((item) => item.source);
}

/** Reads one explicitly chosen outline entry, or scans the explicitly selected whole book locally. */
export async function readScopeEvidence(
  book: BookDoc,
  chapter: ChapterDescriptor | undefined,
  question: string,
  signal: AbortSignal,
): Promise<{ sources: ChapterSource[]; sampled: boolean }> {
  if (chapter) {
    const content = await extractChapter(book, chapter, { signal });
    const sources = selectScopeEvidence(content.sources, question);
    return { sources, sampled: sources.length < content.sources.length };
  }
  // Retain a small candidate set per spine, yielding between files. No permanent full-book index.
  const candidates: ChapterSource[] = [];
  let totalSources = 0;
  for (let index = 0; index < book.sections.length; index++) {
    checkAborted(signal);
    if (book.sections[index]?.linear === 'no') continue;
    const descriptor: ChapterDescriptor = {
      id: `chat-section-${index}`,
      title: '',
      href: '',
      depth: 0,
      sectionIndex: index,
      start: { sectionIndex: index },
      end: { sectionIndex: index + 1 },
    };
    const { sources } = await extractChapter(book, descriptor, { signal });
    totalSources += sources.length;
    candidates.push(...selectScopeEvidence(sources, question));
    if (candidates.length > 200)
      candidates.splice(0, candidates.length, ...selectScopeEvidence(candidates, question));
  }
  const sources = selectScopeEvidence(candidates, question, true);
  return { sources, sampled: sources.length < totalSources };
}
