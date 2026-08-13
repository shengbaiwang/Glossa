import { describe, expect, test } from 'vitest';

import { createContextPack } from '@/glossa/context/contextPack';
import type { SelectedText, SourceSegment } from '@/glossa/context/types';

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
});
