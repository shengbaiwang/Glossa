import { describe, expect, test } from 'vitest';

import {
  createChapterToSelectionContextPack,
  createContextPack,
  MAX_CHAPTER_CONTEXT_CHARACTERS,
  MAX_CHAPTER_CONTEXT_SEGMENTS,
} from '@/glossa/context/contextPack';
import type { SelectedText, SourceSegment, StructuredTextBlock } from '@/glossa/context/types';

const segment = (text: string, cfi: string): SourceSegment => ({
  text,
  anchor: {
    version: 1,
    documentId: 'fixture-book',
    format: 'epub',
    sectionId: 'chapter-1.xhtml',
    cfi,
    quote: { exact: text },
  },
});

describe('ContextPack', () => {
  test('keeps the selection plus one preceding same-chapter paragraph with stable source anchors', () => {
    const previous = segment('The Aster Index records every amber mark.', 'epubcfi(/6/2!/4/1:0)');
    const selected = segment('amber mark points to a passage', 'epubcfi(/6/2!/4/3:8)');
    const later = segment('This later paragraph must not be used.', 'epubcfi(/6/2!/4/5:0)');
    const pack = createContextPack({
      selection: selected,
      selectionContext: [previous, selected, later],
    });

    expect(pack.scopeLabel).toBe('选区 + 同章节前 1 段 · 未使用后文');
    expect(pack.segments.map(({ text }) => text)).toEqual([previous.text, selected.text]);
    expect(pack.segments.map(({ sourceId }) => sourceId)).toEqual([
      expect.stringMatching(/^source_/u),
      expect.stringMatching(/^source_/u),
    ]);
    expect(pack.segments[0]?.anchor).toEqual(previous.anchor);
    expect(pack.segments[1]?.anchor).toEqual(selected.anchor);
    expect(pack.segments.map(({ sourceId }) => sourceId)).not.toContain(
      expect.stringContaining('later'),
    );
  });

  test('does not cross section boundaries or include unread following text', () => {
    const selected = segment('selected text', 'epubcfi(/6/2!/4/3:0)');
    const otherChapter = {
      ...segment('other chapter', 'epubcfi(/6/4!/4/1:0)'),
      anchor: {
        ...segment('other chapter', 'epubcfi(/6/4!/4/1:0)').anchor,
        sectionId: 'chapter-2.xhtml',
      },
    };
    const pack = createContextPack({
      selection: selected,
      selectionContext: [otherChapter, selected],
    });

    expect(pack.segments).toHaveLength(1);
    expect(pack.segments[0]?.role).toBe('selection');
    expect(pack.scopeLabel).toBe('仅选区 · 未使用后文');
  });

  test('records a missing preceding paragraph for evidence-bound relationship requests', () => {
    const selected: SelectedText = segment('selected text', 'epubcfi(/6/2!/4/3:0)');
    const pack = createContextPack({ selection: selected, selectionContext: [selected] });

    expect(pack.hasPreviousContext).toBe(false);
    expect(pack.segments).toHaveLength(1);
  });

  test('builds a chapter-to-selection pack in document order without selection duplication', () => {
    const selected = segment('selected text', 'epubcfi(/6/2!/4/7:0)');
    const blocks: StructuredTextBlock[] = [
      { ...segment('Chapter one', 'epubcfi(/6/2!/4/1:0)'), kind: 'heading', order: 0 },
      { ...segment('earlier paragraph', 'epubcfi(/6/2!/4/3:0)'), kind: 'paragraph', order: 1 },
      { ...selected, kind: 'paragraph', order: 2 },
    ];
    const pack = createChapterToSelectionContextPack({
      selection: selected,
      precedingBlocks: blocks,
    });
    expect(pack.scope).toMatchObject({ kind: 'chapter-to-selection', truncated: false });
    expect(pack.segments.map(({ text }) => text)).toEqual([
      'Chapter one',
      'earlier paragraph',
      'selected text',
    ]);
    expect(pack.segments.filter(({ role }) => role === 'selection')).toHaveLength(1);
    expect(pack.scopeLabel).toBe('本章开头至选区 · 3 段 · 未使用后文');
  });

  test('uses deterministic segment and Unicode budgets while retaining the selection', () => {
    const selected = segment('选区', 'epubcfi(/6/2!/4/99:0)');
    const blocks: StructuredTextBlock[] = Array.from(
      { length: MAX_CHAPTER_CONTEXT_SEGMENTS + 5 },
      (_, order) => ({
        ...segment(
          `${'文'.repeat(Math.floor(MAX_CHAPTER_CONTEXT_CHARACTERS / 3))}${order}`,
          `epubcfi(/6/2!/4/${order}:0)`,
        ),
        kind: order === 0 ? 'heading' : 'paragraph',
        order,
      }),
    );
    const pack = createChapterToSelectionContextPack({
      selection: selected,
      precedingBlocks: blocks,
    });
    expect(pack.scope).toMatchObject({ kind: 'chapter-to-selection', truncated: true });
    expect(pack.segments).toHaveLength(3);
    expect(pack.segments.at(-1)?.text).toBe('选区');
    expect(pack.segments.map(({ text }) => text)).toEqual([
      blocks[0]!.text,
      blocks.at(-1)!.text,
      '选区',
    ]);
    expect(Array.from(pack.segments.map(({ text }) => text).join('')).length).toBeLessThanOrEqual(
      MAX_CHAPTER_CONTEXT_CHARACTERS,
    );
  });
});
