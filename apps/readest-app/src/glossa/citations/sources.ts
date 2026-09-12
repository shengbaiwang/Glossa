import * as CFI from 'foliate-js/epubcfi.js';
import type { BookDoc } from '@/libs/document';
import type { ChapterSource } from '../context/types';
import {
  checkAborted,
  collectTextBlocks,
  normalizeSourceText,
  readRangeText,
  isReadable,
} from '../context/text';

export const validateSourceIds = (ids: string[], sources: ChapterSource[]): ChapterSource[] => {
  const byId = new Map(sources.map((source) => [source.sourceId, source]));
  return [...new Set(ids)].map((id) => {
    const source = byId.get(id);
    if (!source) throw new Error('Unknown reading source');
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
      const selectedText = readRangeText(doc, range);
      if (selectedText === normalizeSourceText(quote.exact))
        return { cfi, text: selectedText, recovered: false };
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
  if (matches.length !== 1 || source.sourceId.startsWith('chat-')) {
    // A selection can begin/end inside a paragraph. Recover only an unambiguous exact quote.
    const ranges: Range[] = matches.map(({ block }) => block.range);
    for (const block of blocks) {
      const points: { node: Text; offset: number }[] = [];
      let raw = '';
      const walker = doc.createTreeWalker(
        block.range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT,
      );
      const append = (node: Text) => {
        if (!isReadable(node) || !block.range.intersectsNode(node)) return;
        const start = node === block.range.startContainer ? block.range.startOffset : 0;
        const end = node === block.range.endContainer ? block.range.endOffset : node.length;
        for (let i = start; i < end; i++) {
          raw += node.data[i];
          points.push({ node, offset: i });
        }
      };
      if (block.range.commonAncestorContainer.nodeType === Node.TEXT_NODE)
        append(block.range.commonAncestorContainer as Text);
      else {
        let node: Node | null;
        while ((node = walker.nextNode())) append(node as Text);
      }
      // Conservative fallback: don't guess offsets when Unicode normalization changed them.
      if (raw.normalize('NFC') !== raw || normalizeSourceText(raw) === quote.exact) continue;
      let from = 0;
      while (from < raw.length) {
        const found = raw.indexOf(quote.exact, from);
        if (found < 0) break;
        const first = points[found],
          last = points[found + quote.exact.length - 1];
        if (
          first &&
          last &&
          (!quote.prefix || normalizeSourceText(raw.slice(0, found)).endsWith(quote.prefix)) &&
          (!quote.suffix ||
            normalizeSourceText(raw.slice(found + quote.exact.length)).startsWith(quote.suffix))
        ) {
          const recovered = doc.createRange();
          recovered.setStart(first.node, first.offset);
          recovered.setEnd(last.node, last.offset + 1);
          if (readRangeText(doc, recovered) === quote.exact) ranges.push(recovered);
        }
        from = found + 1;
      }
    }
    if (ranges.length !== 1) return null;
    return {
      cfi: CFI.joinIndir(
        section.cfi ?? CFI.fake.fromIndex(sectionIndex),
        CFI.fromRange(ranges[0]!),
      ),
      text: quote.exact,
      recovered: true,
    };
  }
  const { block } = matches[0]!;
  return {
    cfi: CFI.joinIndir(section.cfi ?? CFI.fake.fromIndex(sectionIndex), CFI.fromRange(block.range)),
    text: block.text,
    recovered: true,
  };
};
