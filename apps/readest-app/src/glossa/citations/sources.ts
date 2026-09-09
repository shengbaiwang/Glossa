import * as CFI from 'foliate-js/epubcfi.js';
import type { BookDoc } from '@/libs/document';
import type { ChapterSource } from '../context/types';
import { checkAborted, collectTextBlocks, normalizeSourceText } from '../context/text';

export const validateSourceIds = (ids: string[], sources: ChapterSource[]): ChapterSource[] => {
  const byId = new Map(sources.map((source) => [source.sourceId, source]));
  return [...new Set(ids)].map((id) => {
    const source = byId.get(id);
    if (!source) throw new Error('Unknown note source');
    return source;
  });
};

export interface ResolvedSource {
  cfi: string;
  text: string;
  recovered: boolean;
}

/** Re-read local text before navigating. Model-supplied quotation and locations are never used. */
export const resolveSource = async (
  book: BookDoc,
  source: ChapterSource,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ResolvedSource | null> => {
  checkAborted(signal);
  const { sectionIndex, cfi, quote } = source.anchor;
  const section = book.sections[sectionIndex];
  if (!section || !quote.exact) return null;
  const doc = await section.createDocument();
  checkAborted(signal);
  try {
    const parts = CFI.parse(cfi);
    const index =
      book.resolveCFI?.(cfi)?.index ?? CFI.fake.toIndex((parts.parent ?? parts).shift());
    const range = book.resolveCFI ? book.resolveCFI(cfi)?.anchor?.(doc) : CFI.toRange(doc, parts);
    if (index === sectionIndex && range && typeof range !== 'number') {
      const text = collectTextBlocks(doc, range)
        .map((block) => block.text)
        .join(' ');
      if (normalizeSourceText(text) === normalizeSourceText(quote.exact))
        return { cfi, text, recovered: false };
    }
  } catch {
    // An edited EPUB may invalidate a structural anchor. Try the stored local text below.
  }
  const blocks = collectTextBlocks(doc);
  let matches = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.text === normalizeSourceText(quote.exact));
  if (matches.length > 1 && (quote.prefix || quote.suffix)) {
    matches = matches.filter(
      ({ index }) =>
        (!quote.prefix || blocks[index - 1]?.text.endsWith(quote.prefix)) &&
        (!quote.suffix || blocks[index + 1]?.text.startsWith(quote.suffix)),
    );
  }
  if (matches.length !== 1) return null;
  const { block } = matches[0]!;
  return {
    cfi: CFI.joinIndir(section.cfi ?? CFI.fake.fromIndex(sectionIndex), CFI.fromRange(block.range)),
    text: block.text,
    recovered: true,
  };
};
