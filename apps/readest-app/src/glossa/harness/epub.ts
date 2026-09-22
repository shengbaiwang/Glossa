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
import type { BookReadingAccess } from './book';
import {
  asksForSelection,
  buildSourceIndex,
  sampleBookSources,
  type SourceSearchIndex,
} from './retrieval';
import { resolveSource } from '@/glossa/citations/sources';
import type { ChapterSource } from '@/glossa/context/types';

const BOOK_CACHE_VERSION = 'epub-blocks-bm25-context-2';
const MAX_CACHED_CHARS = 2000000;
const bookAccesses = new WeakMap<BookDoc, { key: string; access: BookReadingAccess }>();

/** Lazy, memory-only cache per open document/hash. Opening a panel never reads a book. */
export function createEpubBookAccess(book: BookDoc, documentHash: string): BookReadingAccess {
  if (!book.sections?.length || book.rendition?.layout === 'pre-paginated')
    throw new ReadingScopeError(_('Reading ranges are available for reflowable EPUBs.'));
  const key = `${BOOK_CACHE_VERSION}:${documentHash}`;
  const previous = bookAccesses.get(book);
  if (previous?.key === key) return previous.access;
  const tocChapters = listChapters(book);
  // Front matter and notes often have no TOC entry. Give the model a bounded
  // local route to these originals too, without parsing anything on construction.
  const chapters: ChapterDescriptor[] = [...tocChapters];
  book.sections.forEach((_section, index) => {
    if (!tocChapters.some((chapter) => chapter.sectionIndex === index))
      chapters.push({
        id: `spine-${index}`,
        title:
          index === 0
            ? 'Opening section (outside the table of contents)'
            : `Section ${index + 1} (outside the table of contents)`,
        href: '',
        depth: 0,
        sectionIndex: index,
        start: { sectionIndex: index },
        end: { sectionIndex: index + 1 },
      });
  });
  let cachedSources: ChapterSource[] | undefined;
  let cachedIndex: SourceSearchIndex | undefined;
  const chapterCache = new Map<string, ChapterSource[]>();
  const headings = new Map<string, string>();
  const rememberHeadings = (sources: ChapterSource[]) => {
    let heading = '';
    let section = -1;
    for (const source of sources) {
      if (source.anchor.sectionIndex !== section) heading = '';
      section = source.anchor.sectionIndex;
      if (source.kind === 'heading') heading = source.text.slice(0, 500);
      if (heading) headings.set(source.sourceId, heading);
    }
    while (headings.size > 50000) headings.delete(headings.keys().next().value!);
  };
  const clone = (sources: ChapterSource[]) => structuredClone(sources);
  const readAll = async (signal: AbortSignal) => {
    checkAborted(signal);
    if (cachedSources) return clone(cachedSources);
    const sources: ChapterSource[] = [];
    for (let index = 0; index < book.sections.length; index++) {
      checkAborted(signal);
      const chapter: ChapterDescriptor = {
        id: `spine-${index}`,
        title: '',
        href: '',
        depth: 0,
        sectionIndex: index,
        start: { sectionIndex: index },
        end: { sectionIndex: index + 1 },
      };
      const content = await extractChapter(book, chapter, { signal, includeNonlinear: true });
      rememberHeadings(content.sources);
      sources.push(...content.sources);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    checkAborted(signal);
    if (
      sources.length <= 50000 &&
      sources.reduce((sum, source) => sum + source.text.length, 0) <= MAX_CACHED_CHARS
    )
      cachedSources = sources;
    return clone(sources);
  };
  const access: BookReadingAccess = {
    documentHash,
    sourceContext: (source) => ({
      // Several TOC entries can share a spine file: these are candidate location
      // labels, not a claim that a block belongs to every listed subchapter.
      sectionTitles: tocChapters
        .filter((chapter) => chapter.sectionIndex === source.anchor.sectionIndex)
        .map((chapter) => chapter.title.slice(0, 500))
        .slice(0, 12),
      ...(headings.has(source.sourceId) ? { heading: headings.get(source.sourceId)! } : {}),
    }),
    chapters: chapters.map(({ id, title, depth }) => ({ id, title, depth })),
    readAll,
    readChapter: async (id, signal) => {
      checkAborted(signal);
      const chapter = chapters.find((item) => item.id === id);
      if (!chapter) throw new ReadingScopeError(_('The selected chapter is unavailable.'));
      const cached = chapterCache.get(id);
      if (cached) {
        chapterCache.delete(id);
        chapterCache.set(id, cached);
        return clone(cached);
      }
      const sources = (
        await extractChapter(book, chapter, {
          signal,
          includeNonlinear: chapter.id.startsWith('spine-'),
        })
      ).sources;
      checkAborted(signal);
      rememberHeadings(sources);
      chapterCache.set(id, sources);
      while (
        chapterCache.size > 8 ||
        [...chapterCache.values()].flat().reduce((sum, source) => sum + source.text.length, 0) >
          300000
      )
        chapterCache.delete(chapterCache.keys().next().value!);
      return clone(sources);
    },
    search: async (queries, signal) => {
      const all = await readAll(signal);
      checkAborted(signal);
      const index = cachedIndex ?? (await buildSourceIndex(cachedSources ?? all, signal));
      checkAborted(signal);
      if (cachedSources) cachedIndex = index;
      const ranked = queries.slice(0, 4).map((query) => index.search(query));
      if (queries.some(asksForSelection)) ranked.unshift(sampleBookSources(all));
      const selected = new Map<string, ChapterSource>();
      const positions = new Map(all.map((source, index) => [source.sourceId, index]));
      // Interleave search angles so one phrasing cannot crowd out another.
      for (let i = 0; i < 36; i++)
        for (const hits of ranked) {
          const hit = hits[i];
          if (!hit) continue;
          const index = positions.get(hit.sourceId)!;
          selected.set(hit.sourceId, hit);
          for (const neighbor of [all[index - 1], all[index + 1]])
            if (neighbor && neighbor.anchor.sectionIndex === hit.anchor.sectionIndex)
              selected.set(neighbor.sourceId, neighbor);
        }
      return clone([...selected.values()]);
    },
    verifySources: async (sources, signal) => {
      const verified: ChapterSource[] = [];
      for (const source of sources) {
        checkAborted(signal);
        if (await resolveSource(book, source, { signal })) verified.push(source);
      }
      return verified;
    },
  };
  bookAccesses.set(book, { key, access });
  return access;
}

export type ReadingCaptureView = Pick<
  FoliateView,
  'lastLocation' | 'getCFI' | 'resolveCFI' | 'isFixedLayout'
> & { renderer: Pick<FoliateView['renderer'], 'getContents'> };

/** Freeze only the live range at send time. Original parsing happens on demand. */
export function createEpubFocusReader(
  bookDoc: BookDoc,
  view: ReadingCaptureView | null | undefined,
  documentHash: string,
) {
  if (!view?.renderer?.getContents) return async () => [];
  const contents = view.renderer.getContents();
  const selections = contents.flatMap(({ doc }) => {
    const selection = doc.getSelection();
    return selection && !selection.isCollapsed && selection.rangeCount === 1
      ? [selection.getRangeAt(0).cloneRange()]
      : [];
  });
  const range = selections.length === 1 ? selections[0] : view.lastLocation?.range?.cloneRange();
  const snapshot: ReadingCaptureView = {
    isFixedLayout: view.isFixedLayout,
    lastLocation: view.lastLocation && range ? { ...view.lastLocation, range } : undefined,
    renderer: { getContents: () => contents },
    getCFI: view.getCFI.bind(view),
    resolveCFI: view.resolveCFI.bind(view),
  };
  let sources: ChapterSource[] | undefined;
  return async (signal: AbortSignal) => {
    checkAborted(signal);
    if (!range || selections.length > 1) return [];
    if (!sources)
      sources = (
        await captureReadingScope({ bookDoc, view: snapshot, documentHash, kind: 'page', signal })
      ).sources;
    checkAborted(signal);
    return structuredClone(sources);
  };
}

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
  kind: 'page' | 'selection' | 'auto';
  signal?: AbortSignal;
}): Promise<ReadingScope> {
  checkAborted(signal);
  try {
    if (view.isFixedLayout)
      throw new ReadingScopeError(_('Reading ranges are available for reflowable EPUBs.'));
    const contents = view.renderer.getContents();
    // Decide once, synchronously at the user's click. An invalid existing selection
    // must fail verification rather than silently grant access to the whole page.
    const selections =
      kind === 'page'
        ? []
        : contents.flatMap(({ doc }) => {
            const selection = doc.getSelection();
            return selection && !selection.isCollapsed ? [selection] : [];
          });
    const captureKind = kind === 'auto' ? (selections.length ? 'selection' : 'page') : kind;
    let range: Range | undefined;
    if (captureKind === 'selection') {
      if (selections.length === 1 && selections[0]!.rangeCount === 1)
        range = selections[0]!.getRangeAt(0).cloneRange();
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
      kind: captureKind,
      title: captureKind === 'selection' ? _('Selected text') : _('Current page'),
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
