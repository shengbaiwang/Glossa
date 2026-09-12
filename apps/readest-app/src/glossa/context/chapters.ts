import * as CFI from 'foliate-js/epubcfi.js';
import { md5 } from 'js-md5';
import type { BookDoc, TOCItem } from '@/libs/document';
import { checkAborted, collectTextBlocks } from './text';
import type { ChapterBoundary, ChapterContent, ChapterDescriptor, ChapterSource } from './types';

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const boundaryFor = (book: BookDoc, href: string): ChapterBoundary | undefined => {
  const [path, fragment] = book.splitTOCHref(href);
  const sectionIndex = book.sections.findIndex((section) =>
    [section.id, section.href].some(
      (value) => value != null && decode(value) === decode(String(path)),
    ),
  );
  if (sectionIndex < 0) return undefined;
  return { sectionIndex, ...(fragment ? { fragment: decode(String(fragment)) } : {}) };
};

/** TOC order is preserved. A chapter includes its descendants, never its next sibling. */
export const listChapters = (book: BookDoc): ChapterDescriptor[] => {
  const chapters: ChapterDescriptor[] = [];
  const walk = (items: TOCItem[], depth: number, parentId?: string) => {
    for (const item of items) {
      const start = boundaryFor(book, item.href);
      const id = `chapter-${md5(item.href).slice(0, 12)}-${chapters.length}`;
      if (start)
        chapters.push({
          id,
          title: item.label.trim() || String(chapters.length + 1),
          href: item.href,
          depth,
          parentId,
          sectionIndex: start.sectionIndex,
          start,
        });
      if (item.subitems?.length)
        walk(item.subitems, start ? depth + 1 : depth, start ? id : parentId);
    }
  };
  let toc = book.toc ?? [];
  // An EPUB can wrap its entire outline in a single book-title node. Offer its chapters.
  while (toc.length === 1 && toc[0]?.subitems?.length) toc = toc[0].subitems;
  walk(toc, 0);

  if (!chapters.length) {
    book.sections.forEach((section, sectionIndex) => {
      if (section.linear === 'no') return;
      chapters.push({
        id: `section-${sectionIndex}`,
        title: String(sectionIndex + 1),
        href: section.href ?? section.id,
        depth: 0,
        sectionIndex,
        start: { sectionIndex },
        end: { sectionIndex: sectionIndex + 1 },
      });
    });
    // A lone linear file has no chapter boundary; do not offer the whole book.
    return chapters.length > 1 ? chapters : [];
  }

  const firstLinearSection = book.sections.findIndex((section) => section.linear !== 'no');
  if (chapters.length === 1 && chapters[0]!.sectionIndex <= firstLinearSection) return [];

  if (chapters.every((chapter) => chapter.depth === 0)) {
    // Calibre NCX files often flatten file headings and their #fragment children.
    let fileParent: ChapterDescriptor | undefined;
    let numberedParent: ChapterDescriptor | undefined;
    for (const chapter of chapters) {
      if (!chapter.start.fragment) {
        fileParent = chapter;
        numberedParent = undefined;
      } else if (fileParent?.sectionIndex === chapter.sectionIndex) {
        chapter.depth = 1;
        chapter.parentId = fileParent.id;
        if (/^[（(][一二三四五六七八九十百零〇\d]+[）)]/.test(chapter.title) && numberedParent) {
          chapter.depth = 2;
          chapter.parentId = numberedParent.id;
        } else {
          numberedParent = /^[一二三四五六七八九十百零〇]+[、.．]/.test(chapter.title)
            ? chapter
            : undefined;
        }
      } else {
        fileParent = undefined;
        numberedParent = undefined;
      }
    }
  }

  chapters.forEach((chapter, index) => {
    const next = chapters.slice(index + 1).find((candidate) => candidate.depth <= chapter.depth);
    if (next) {
      chapter.end =
        next.sectionIndex < chapter.sectionIndex
          ? { sectionIndex: chapter.sectionIndex + 1 }
          : next.start;
    }
  });
  const roots = chapters.filter((chapter) => chapter.depth === 0);
  if (roots.length === 1 && chapters.length > 1 && roots[0]!.sectionIndex <= firstLinearSection) {
    const root = roots[0]!;
    return chapters
      .filter((chapter) => chapter.id !== root.id)
      .map((chapter) => ({
        ...chapter,
        depth: chapter.depth - 1,
        parentId: chapter.parentId === root.id ? undefined : chapter.parentId,
      }));
  }
  return chapters;
};

/** Full outline path for a reading position, e.g. "第一讲 › （二）中央政府的组织". */
export const chapterPathForHref = (book: BookDoc, href?: string): string => {
  if (
    !href ||
    !book?.toc?.length ||
    !book.sections?.length ||
    typeof book.splitTOCHref !== 'function'
  )
    return '';
  const target = decode(href);
  const chapters = listChapters(book);
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const leaf = chapters.find((chapter) => decode(chapter.href) === target);
  if (!leaf) return '';
  const labels: string[] = [];
  for (let node: ChapterDescriptor | undefined = leaf; node; ) {
    labels.unshift(node.title);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return labels.join(' › ');
};

const fragmentElement = (doc: Document, fragment: string): Element | undefined =>
  doc.getElementById(fragment) ?? Array.from(doc.getElementsByName(fragment))[0];

const chapterRange = (doc: Document, sectionIndex: number, chapter: ChapterDescriptor): Range => {
  const range = doc.createRange();
  range.selectNodeContents(doc.body ?? doc.documentElement);
  const startFragment =
    sectionIndex === chapter.start.sectionIndex ? chapter.start.fragment : undefined;
  const endFragment = sectionIndex === chapter.end?.sectionIndex ? chapter.end.fragment : undefined;
  const start = startFragment ? fragmentElement(doc, startFragment) : undefined;
  const end = endFragment ? fragmentElement(doc, endFragment) : undefined;
  if ((startFragment && !start) || (endFragment && !end))
    throw new Error('Chapter location is unavailable');
  if (start) range.setStartBefore(start);
  if (end) {
    const endPoint = doc.createRange();
    endPoint.setStartBefore(end);
    endPoint.collapse(true);
    if (range.compareBoundaryPoints(Range.START_TO_START, endPoint) >= 0)
      throw new Error('Chapter location is invalid');
    range.setEndBefore(end);
  }
  return range;
};

export const extractChapter = async (
  book: BookDoc,
  chapter: ChapterDescriptor,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ChapterContent> => {
  checkAborted(signal);
  const sources: ChapterSource[] = [];
  const lastSection = Math.min(
    book.sections.length - 1,
    chapter.end
      ? chapter.end.sectionIndex - (chapter.end.fragment ? 0 : 1)
      : book.sections.length - 1,
  );
  for (let sectionIndex = chapter.start.sectionIndex; sectionIndex <= lastSection; sectionIndex++) {
    checkAborted(signal);
    const section = book.sections[sectionIndex];
    if (!section || section.linear === 'no') continue;
    // Yield between spine reads so preparing a reading passage does not monopolize the reader.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    checkAborted(signal);
    const doc = await section.createDocument();
    checkAborted(signal);
    const blocks = collectTextBlocks(doc, chapterRange(doc, sectionIndex, chapter));
    blocks.forEach((block, index) => {
      const cfi = CFI.joinIndir(
        section.cfi ?? CFI.fake.fromIndex(sectionIndex),
        CFI.fromRange(block.range),
      );
      sources.push({
        sourceId: `s-${sectionIndex}-${md5(cfi).slice(0, 12)}`,
        text: block.text,
        kind: block.kind,
        anchor: {
          sectionIndex,
          cfi,
          quote: {
            exact: block.text,
            prefix: blocks[index - 1]?.text.slice(-64) ?? '',
            suffix: blocks[index + 1]?.text.slice(0, 64) ?? '',
          },
        },
      });
    });
  }
  return {
    chapter,
    sources,
    characterCount: sources.reduce((sum, source) => sum + source.text.length, 0),
  };
};
