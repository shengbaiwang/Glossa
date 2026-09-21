import * as CFI from 'foliate-js/epubcfi.js';
import { md5 } from 'js-md5';
import type { BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { extractChapter, listChapters } from '@/glossa/context/chapters';
import { checkAborted, collectRangeBlocks, readRangeText } from '@/glossa/context/text';
import type { ChapterDescriptor } from '@/glossa/context/types';
import { buildReadingPassages, getPassageId } from '@/glossa/passages/passages';
import type { ReadingPassage } from '@/glossa/passages/types';
import { stubTranslation as _ } from '@/utils/misc';
import { createReadingScope, ReadingScopeError, type ReadingScope } from './scope';

export type ReadingCaptureView = Pick<
  FoliateView,
  'lastLocation' | 'getCFI' | 'resolveCFI' | 'isFixedLayout'
> & { renderer: Pick<FoliateView['renderer'], 'getContents'> };

/** Capture the range at the click, then read its text from the original local EPUB document. */
export async function captureReadingScope({
  bookDoc,
  view,
  documentHash,
  kind,
  signal,
}: {
  bookDoc: BookDoc;
  view: ReadingCaptureView;
  documentHash: string;
  kind: 'page' | 'selection';
  signal?: AbortSignal;
}): Promise<ReadingScope> {
  checkAborted(signal);
  try {
    if (view.isFixedLayout)
      throw new ReadingScopeError(_('Reading ranges are available for reflowable EPUBs.'));
    const contents = view.renderer.getContents();
    let range: Range | undefined;
    if (kind === 'selection') {
      const selections = contents.flatMap(({ doc }) => {
        const selection = doc.getSelection();
        return selection && !selection.isCollapsed && selection.rangeCount === 1
          ? [selection.getRangeAt(0).cloneRange()]
          : [];
      });
      if (selections.length === 1) range = selections[0];
    } else {
      range = view.lastLocation?.range?.cloneRange();
    }
    if (!range || range.collapsed)
      throw new ReadingScopeError(
        _('The reading range is unavailable. Select text or choose a passage.'),
      );
    const content = contents.find(({ doc }) => range!.startContainer.ownerDocument === doc);
    const index = content?.index;
    if (index === undefined || !bookDoc.sections[index]) throw new Error('Missing section');
    // Element-boundary selections have inconsistent CFI offsets in foliate. Tighten only to
    // the first/last readable text already inside the selected range before serializing it.
    const liveBlocks = collectRangeBlocks(content!.doc, range);
    const first = liveBlocks[0]?.range;
    const last = liveBlocks.at(-1)?.range;
    if (!first || !last) throw new Error('Empty range');
    range.setStart(first.startContainer, first.startOffset);
    range.setEnd(last.endContainer, last.endOffset);
    const liveText = readRangeText(content!.doc, range);
    if (!liveText) throw new Error('Empty range');
    const cfi = view.getCFI(index, range);
    const resolved = view.resolveCFI(cfi);
    if (resolved.index !== index) throw new Error('Mismatched section');
    const chapterTitle = view.lastLocation?.tocItem?.label?.trim().slice(0, 500) ?? '';
    const section = bookDoc.sections[index]!;
    const original = await section.createDocument();
    checkAborted(signal);
    const originalRange = resolved.anchor(original);
    if (readRangeText(original, originalRange) !== liveText) throw new Error('Changed range');
    const blocks = collectRangeBlocks(original, originalRange);
    const sources = blocks.map((block, blockIndex) => {
      const sourceCFI = CFI.joinIndir(
        section.cfi ?? CFI.fake.fromIndex(index),
        CFI.fromRange(block.range),
      );
      return {
        sourceId: `chat-${index}-${md5(sourceCFI).slice(0, 12)}`,
        text: block.text,
        kind: block.kind,
        anchor: {
          sectionIndex: index,
          cfi: sourceCFI,
          quote: {
            exact: block.text,
            prefix: blocks[blockIndex - 1]?.text.slice(-64) ?? '',
            suffix: blocks[blockIndex + 1]?.text.slice(0, 64) ?? '',
          },
        },
      };
    });
    return createReadingScope({
      documentHash,
      kind,
      title: kind === 'selection' ? _('Selected text') : _('Current page'),
      chapterTitle,
      sources,
    });
  } catch (cause) {
    checkAborted(signal);
    if (cause instanceof ReadingScopeError) throw cause;
    throw new ReadingScopeError(_('The reading range could not be verified. Select it again.'));
  }
}

export async function prepareChapterPassages({
  bookDoc,
  chapter,
  signal,
}: {
  bookDoc: BookDoc;
  chapter: ChapterDescriptor;
  signal?: AbortSignal;
}): Promise<ReadingPassage[]> {
  checkAborted(signal);
  const canonical = listChapters(bookDoc).find((item) => item.id === chapter.id);
  if (!canonical) throw new ReadingScopeError(_('The selected chapter is unavailable.'));
  const content = await extractChapter(bookDoc, canonical, { signal });
  checkAborted(signal);
  return buildReadingPassages(content);
}

export function scopeForPassage(
  documentHash: string,
  chapter: ChapterDescriptor,
  passage: ReadingPassage,
): ReadingScope {
  if (passage.unavailable || passage.id !== getPassageId(chapter.id, passage.sources))
    throw new ReadingScopeError(_('The selected reading passage is unavailable.'));
  return createReadingScope({
    documentHash,
    kind: 'passage',
    title: passage.title.slice(0, 500),
    chapterTitle: chapter.title.slice(0, 500),
    sources: passage.sources,
  });
}
