import type { ChapterSource } from '@/glossa/context/types';
import { checkAborted, normalizeSourceText } from '@/glossa/context/text';

const stopWords = new Set(
  '的 了 是 在 和 与 有 都 这 本书 这本书 先生 为什么 为何 时候 吗 呢 哪些 什么 怎么 如何 这些 这个 那个 一个 作者 表达 观点 总结 概括 总论 the a an of in to and or is are this that what how does book author summarize summary'.split(
    ' ',
  ),
);
const normalize = (text: string) => normalizeSourceText(text).normalize('NFKC').toLocaleLowerCase();
const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : undefined;

/** Segment Chinese questions as words, rather than requiring the entire question verbatim. */
export function queryTerms(query: string): string[] {
  const text = normalize(query);
  const words = segmenter
    ? [...segmenter.segment(text)].filter((part) => part.isWordLike).map((part) => part.segment)
    : (text.match(/[\p{L}\p{N}]+/gu) ?? []).flatMap((word) =>
        /\p{Script=Han}/u.test(word) && word.length > 2
          ? Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))
          : [word],
      );
  return [...new Set(words)].filter((word) => !stopWords.has(word)).slice(0, 32);
}

export function rankSources(sources: ChapterSource[], query: string): ChapterSource[] {
  const phrase = normalize(query);
  const terms = queryTerms(query);
  const texts = sources.map((source) => normalize(source.text));
  const weights = terms.map((term) =>
    Math.log(1 + sources.length / (1 + texts.filter((text) => text.includes(term)).length)),
  );
  return sources
    .map((source, index) => ({
      source,
      index,
      score:
        (phrase && texts[index]!.includes(phrase) ? 8 : 0) +
        terms.reduce((sum, term, i) => sum + (texts[index]!.includes(term) ? weights[i]! : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ source }) => source);
}

/** A bounded selection is not an exhaustive inventory, even when it says “main points”. */
export const asksForSelection = (question: string) =>
  /(?:举出|舉出|列出|选出|選出|挑出|推荐|推薦).{0,6}(?:[一二三四五六七八九十两兩几幾\d]+).{0,24}(?:观点|觀點|论点|論點|例子|片段)|\b(?:top|pick|select|give|list)\s+(?:\d+|three|five|a few)\b/iu.test(
    question,
  );

/** Intent hint; the book planner also handles less explicit summary requests. */
export const asksForOverview = (question: string) =>
  /总结|總結|概括|概述|梳理|综述|綜述|主旨|大意|都.{0,16}(观点|觀點|论点|論點)|(?:所有|全部|主要|核心).{0,12}(观点|觀點|论点|論點)|哪些.{0,8}(观点|觀點|论点|論點)|\b(summari[sz]e|summary|overview|synopsis|all (?:the )?(?:points|arguments)|main (?:ideas|points|arguments))\b/iu.test(
    question,
  );

const indexTerms = (text: string): string[] => {
  const normalized = normalize(text);
  const words = segmenter
    ? [...segmenter.segment(normalized)]
        .filter((part) => part.isWordLike)
        .map((part) => part.segment)
    : (normalized.match(/[\p{L}\p{N}]+/gu) ?? []);
  // Bigrams bridge differing Chinese word boundaries between questions and prose.
  const grams = (normalized.match(/\p{Script=Han}{2,}/gu) ?? []).flatMap((word) =>
    Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2)),
  );
  return [...words, ...grams].filter((word) => !stopWords.has(word));
};

export interface SourceSearchIndex {
  search(query: string, limit?: number): ChapterSource[];
}

/** Local BM25 postings; build once, yield to reading/cancellation between batches. */
export async function buildSourceIndex(
  sources: ChapterSource[],
  signal: AbortSignal,
): Promise<SourceSearchIndex> {
  const postings = new Map<string, Map<number, number>>();
  const lengths: number[] = [];
  for (let index = 0; index < sources.length; index++) {
    if (index % 32 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    checkAborted(signal);
    const terms = indexTerms(sources[index]!.text);
    lengths.push(terms.length);
    for (const term of terms) {
      let hits = postings.get(term);
      if (!hits) {
        hits = new Map();
        postings.set(term, hits);
      }
      hits.set(index, (hits.get(index) ?? 0) + 1);
    }
  }
  checkAborted(signal);
  const average =
    lengths.reduce((sum, length) => sum + length, 0) / Math.max(1, sources.length) || 1;
  return {
    search(query, limit = 12) {
      const scores = new Map<number, number>();
      for (const term of [...new Set(indexTerms(query))].slice(0, 64)) {
        const hits = postings.get(term);
        if (!hits) continue;
        const idf = Math.log(1 + (sources.length - hits.size + 0.5) / (hits.size + 0.5));
        for (const [index, frequency] of hits) {
          const normalization = 1.2 * (0.25 + (0.75 * lengths[index]!) / average);
          scores.set(
            index,
            (scores.get(index) ?? 0) + (idf * frequency * 2.2) / (frequency + normalization),
          );
        }
      }
      return [...scores]
        .sort(([a, x], [b, y]) => y - x || a - b)
        .slice(0, limit)
        .map(([index]) => sources[index]!);
    },
  };
}

/** Broad selection gets a bounded, distributed sample, never a completeness claim. */
export function sampleBookSources(sources: ChapterSource[], limit = 36): ChapterSource[] {
  const sections = new Map<number, ChapterSource[]>();
  for (const source of sources) {
    if (source.text.length > 20000) continue;
    const entries = sections.get(source.anchor.sectionIndex) ?? [];
    entries.push(source);
    sections.set(source.anchor.sectionIndex, entries);
  }
  // Spread even across large books; do not consume the budget on the first spines.
  const groups = [...sections.values()];
  const selectedGroups =
    groups.length <= limit
      ? groups
      : Array.from(
          { length: limit },
          (_, i) => groups[Math.round((i * (groups.length - 1)) / (limit - 1))]!,
        );
  const output = new Map<string, ChapterSource>();
  for (const fraction of [0.5, 0, 1, 0.25, 0.75])
    for (const group of selectedGroups) {
      if (output.size >= limit) break;
      const source = group[Math.round(fraction * (group.length - 1))]!;
      output.set(source.sourceId, source);
    }
  return [...output.values()];
}

/** Remove identification boilerplate, retaining real search concepts and explicit names when needed. */
export function seedSearchQuery(question: string, metadata: { bookTitle: string; author: string }) {
  let topic = question;
  for (const label of [metadata.bookTitle, metadata.author])
    if (label.length >= 2) topic = topic.split(label).join(' ');
  const terms = queryTerms(topic);
  return (terms.length ? terms.join(' ') : question).slice(0, 200);
}

/** A direct reference to visible/selected text; generic follow-ups are not page references. */
export const asksForFocus = (question: string) =>
  /这段|這段|这句|這句|此段|此句|当前页|當前頁|选中|選中|划线|劃線|\b(?:this passage|this paragraph|this sentence|selected text|current page)\b/iu.test(
    question,
  );
