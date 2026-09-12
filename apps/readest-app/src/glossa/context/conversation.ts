import * as CFI from 'foliate-js/epubcfi.js';
import { md5 } from 'js-md5';
import type { BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import type { ChapterSource } from './types';
import { checkAborted, collectRangeBlocks, collectTextBlocks, readRangeText } from './text';
import { ConversationError } from '@/glossa/conversation/schema';
import { stubTranslation as _ } from '@/utils/misc';

export interface ConversationReader {
  visibleLocation(): string | undefined;
  readLocation(
    cfi: string,
    signal: AbortSignal,
    fullParagraphs?: boolean,
  ): Promise<ChapterSource[]>;
}

/** Normalize element boundary selections before Foliate serializes them as text CFIs. */
export function conversationSelectionCfi(
  view: Pick<FoliateView, 'getCFI'>,
  index: number,
  selection: Range,
): string | null {
  const doc = selection.startContainer.ownerDocument;
  if (!doc) return null;
  const blocks = collectRangeBlocks(doc, selection);
  const first = blocks[0],
    last = blocks.at(-1);
  if (!first || !last) return null;
  const range = doc.createRange();
  range.setStart(first.range.startContainer, first.range.startOffset);
  range.setEnd(last.range.endContainer, last.range.endOffset);
  return view.getCFI(index, range);
}

/** The only conversation boundary that knows Readest/EPUB objects. Core receives plain sources. */
export function createConversationReader(
  book: BookDoc,
  getView: () => FoliateView | null | undefined,
): ConversationReader {
  return {
    visibleLocation: () => getView()?.lastLocation?.cfi,
    async readLocation(cfi, signal, fullParagraphs = false) {
      checkAborted(signal);
      try {
        const resolved = book.resolveCFI?.(cfi);
        if (!resolved) throw new Error();
        const section = book.sections[resolved.index];
        if (!section) throw new Error();
        const doc = await section.createDocument();
        checkAborted(signal);
        const range = resolved.anchor?.(doc);
        if (!range || typeof range === 'number') throw new Error();
        const blocks = fullParagraphs
          ? collectTextBlocks(doc).filter(
              (block) =>
                block.range.compareBoundaryPoints(Range.END_TO_START, range) < 0 &&
                block.range.compareBoundaryPoints(Range.START_TO_END, range) > 0,
            )
          : collectRangeBlocks(doc, range);
        const sources = blocks.map((block) => {
          const anchorCfi = CFI.joinIndir(
            section.cfi ?? CFI.fake.fromIndex(resolved.index),
            CFI.fromRange(block.range),
          );
          const before = range.cloneRange();
          before.setEnd(block.range.startContainer, block.range.startOffset);
          const after = range.cloneRange();
          after.setStart(block.range.endContainer, block.range.endOffset);
          return {
            sourceId: `chat-${md5(`${anchorCfi}:${block.text}`)}`,
            text: block.text,
            kind: block.kind,
            anchor: {
              sectionIndex: resolved.index,
              cfi: anchorCfi,
              quote: {
                exact: block.text,
                prefix: readRangeText(doc, before).slice(-80),
                suffix: readRangeText(doc, after).slice(0, 80),
              },
            },
          };
        });
        if (sources.length > 100 || sources.reduce((n, s) => n + s.text.length, 0) > 8000)
          throw new ConversationError(
            _('This reading range is too long. Select a smaller passage.'),
          );
        return sources;
      } catch (error) {
        checkAborted(signal);
        if (error instanceof ConversationError) throw error;
        throw new ConversationError(
          _('The reading context could not be captured. Select text or try again.'),
        );
      }
    },
  };
}

export function mergeConversationSources(
  selection: ChapterSource[],
  visible: ChapterSource[],
): ChapterSource[] {
  const sources = [...new Map([...selection, ...visible].map((s) => [s.sourceId, s])).values()];
  if (sources.reduce((n, s) => n + s.text.length, 0) > 8000 || sources.length > 100)
    throw new ConversationError(_('Use a smaller selection or stop sharing the current page.'));
  return sources;
}
