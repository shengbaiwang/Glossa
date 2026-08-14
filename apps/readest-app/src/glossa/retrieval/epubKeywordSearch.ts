import { textWalker } from 'foliate-js/text-walker.js';
import { searchMatcher } from 'foliate-js/search.js';

import type { SourceSegment } from '../context/types';
import { textFromEpubRange, isEpubReadableTextNode } from '../context/epub';
import { isEpubSourceInReadCoverage } from '../context/readCoverage';

type EpubSearchSection = {
  createDocument?: () => Promise<Document>;
};

export type EpubSearchView = {
  book: { sections: EpubSearchSection[] };
  getCFI: (index: number, range: Range) => string;
};

type CfiComparator = (left: string, right: string) => number;

const ENGLISH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'does',
  'explain',
  'for',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'of',
  'please',
  'the',
  'this',
  'to',
  'what',
  'why',
]);

const cleanCjkQuestionWords = (value: string): string =>
  value
    .replace(/^(?:什么是|请解释|解释|为什么|为何|如何)/u, '')
    .replace(/(?:是什么意思|是什么|吗|呢)$/u, '');

/**
 * Turn a natural-language question into a few deterministic local-search
 * terms. This is intentionally a small heuristic, not semantic retrieval:
 * its only purpose is to avoid asking EPUB `contains` search to match a whole
 * question sentence. The original question remains the provider question.
 */
export const extractEpubKeywordQueries = (question: string): string[] => {
  const quoted = Array.from(question.matchAll(/[“"]([^”"]{2,})[”"]/gu)).flatMap((match) => {
    const phrase = match[1]?.trim();
    return phrase ? [phrase] : [];
  });
  const cjkRuns = question.match(/[\u3400-\u9fff]{2,}/gu) ?? [];
  const cjk = cjkRuns.map(cleanCjkQuestionWords).filter((value) => value.length >= 2);
  // Do not re-add a whole CJK question as an "English" term: the CJK pass
  // above already removes question framing such as “什么是”.
  const english = (question.toLocaleLowerCase().match(/[\p{Script=Latin}\p{N}_]+/gu) ?? [])
    .filter((word) => word.length > 1 && !ENGLISH_STOP_WORDS.has(word))
    .slice(0, 4)
    .join(' ');
  return [...new Set([...quoted, ...cjk, ...(english ? [english] : [])])].slice(0, 4);
};

const searchNodeFilter = (node: Node): number => {
  if (node.nodeType === node.ELEMENT_NODE) {
    const element = node as Element;
    if (element.matches('script, style, template, nav, [hidden], [aria-hidden="true"]')) {
      return NodeFilter.FILTER_REJECT;
    }
    return NodeFilter.FILTER_SKIP;
  }
  return isEpubReadableTextNode(node as Text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
};

const abortError = (): DOMException =>
  new DOMException('The keyword search was cancelled.', 'AbortError');

/**
 * Read-only EPUB keyword retrieval. It deliberately avoids `view.search()`:
 * that Readest UI API creates temporary highlights and clears a user's active
 * search. Candidate CFIs are checked against E05's explicit read coverage
 * before any source text is returned.
 */
export const searchReadEpubText = async (options: {
  documentId: string;
  view: EpubSearchView;
  query: string;
  coverage: unknown;
  compareCfi: CfiComparator;
  signal?: AbortSignal;
}): Promise<SourceSegment[]> => {
  const { documentId, view, query, coverage, compareCfi, signal } = options;
  if (!documentId.trim() || !query.trim()) return [];
  const matcher = searchMatcher(textWalker, {
    mode: 'contains',
    matchCase: false,
    matchDiacritics: false,
    acceptNode: searchNodeFilter,
  });
  const candidates: SourceSegment[] = [];
  for (const [sectionIndex, section] of view.book.sections.entries()) {
    if (signal?.aborted) throw abortError();
    if (!section.createDocument) continue;
    let document: Document;
    try {
      document = await section.createDocument();
    } catch {
      continue;
    }
    for (const match of matcher(document, query)) {
      if (signal?.aborted) throw abortError();
      const text = textFromEpubRange(match.range);
      if (!text) continue;
      let cfi: string;
      try {
        cfi = view.getCFI(sectionIndex, match.range);
        if (!isEpubSourceInReadCoverage(cfi, sectionIndex, coverage, compareCfi)) continue;
      } catch {
        continue;
      }
      candidates.push({
        text,
        anchor: {
          version: 1,
          documentId,
          format: 'epub',
          sectionId: `spine:${sectionIndex}`,
          cfi,
          quote: { exact: text },
        },
      });
    }
  }
  return candidates;
};
