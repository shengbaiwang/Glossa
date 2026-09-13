import { describe, expect, it } from 'vitest';
import type { ChapterContent, ChapterSource } from '@/glossa/context/types';
import { buildReadingPassages } from '@/glossa/passages/passages';

const source = (sourceId = 's1', text = 'Conditions shape institutions.'): ChapterSource => ({
  sourceId,
  text,
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: 'epubcfi(/6/2!/4/2)',
    quote: { exact: text, prefix: '', suffix: '' },
  },
});
const content = (sources = [source()]): ChapterContent => ({
  chapter: {
    id: 'chapter-1',
    title: 'Institutions',
    href: 'chapter.xhtml',
    depth: 0,
    sectionIndex: 0,
    start: { sectionIndex: 0 },
  },
  sources,
  characterCount: sources.reduce((n, item) => n + item.text.length, 0),
});
describe('reading passages', () => {
  it('accepts twenty thousand input characters across many complete paragraphs', async () => {
    const blocks = Array.from({ length: 200 }, (_, i) => source(`s${i}`, '甲'.repeat(100)));
    const passages = buildReadingPassages(content(blocks));
    expect(passages).toHaveLength(1);
    expect(passages[0]).toMatchObject({ characterCount: 20000, unavailable: false });
    const split = buildReadingPassages(content([...blocks, source('next', '乙')]));
    expect(split.map((p) => p.characterCount)).toEqual([20000, 1]);
  });
  it('keeps complete blocks and following headings together within the hard cap', () => {
    const blocks = [
      source('a', 'a'.repeat(4800)),
      { ...source('h', 'Heading'), kind: 'heading' as const },
      source('b', 'b'.repeat(2000)),
      source('c', 'c'.repeat(3500)),
    ];
    const passages = buildReadingPassages(content(blocks));
    expect(passages.map((p) => p.sources.map((s) => s.sourceId))).toEqual([['a'], ['h', 'b', 'c']]);
    expect(passages.flatMap((p) => p.sources)).toEqual(blocks);
    expect(passages.every((p) => p.characterCount <= 20000)).toBe(true);
  });
  it('marks an oversized indivisible block unavailable without changing text or anchor', () => {
    const block = { ...source('long', '甲'.repeat(20001)), kind: 'table' as const };
    const passages = buildReadingPassages(content([source('a'), block, source('b')]));
    expect(passages).toHaveLength(3);
    expect(passages[1]).toMatchObject({
      unavailable: true,
      sources: [block],
      characterCount: 20001,
    });
    expect(passages[1]!.sources[0]!.anchor).toEqual(block.anchor);
  });
  it('limits source counts and keeps every source exactly once', () => {
    const blocks = Array.from({ length: 401 }, (_, i) => source(`s${i}`));
    const passages = buildReadingPassages(content(blocks));
    expect(passages.every((p) => p.sources.length <= 200)).toBe(true);
    expect(passages.flatMap((p) => p.sources)).toEqual(blocks);
    expect(new Set(passages.map((p) => p.id)).size).toBe(passages.length);
  });
  it('keeps heading groups with their first paragraph at target and source-count boundaries', () => {
    const heading = { ...source('heading', 'h'.repeat(30)), kind: 'heading' as const };
    expect(
      buildReadingPassages(
        content([source('previous', 'a'.repeat(19990)), heading, source('following')]),
      ).map((p) => p.sources.map((s) => s.sourceId)),
    ).toEqual([['previous'], ['heading', 'following']]);
    const headings = Array.from({ length: 200 }, (_, index) => ({
      ...source(`h${index}`, 'Heading'),
      kind: 'heading' as const,
    }));
    const [passage] = buildReadingPassages(content([...headings, source('following')]));
    expect(passage).toMatchObject({ unavailable: true });
    expect(passage!.sources.at(-1)!.sourceId).toBe('following');
  });
  it('marks an oversized heading and its following paragraph unavailable as one complete group', () => {
    const heading = { ...source('heading', 'h'.repeat(19900)), kind: 'heading' as const };
    const blocks = [heading, source('following', 'p'.repeat(200))];
    const passages = buildReadingPassages(content(blocks));
    expect(passages).toHaveLength(1);
    expect(passages[0]).toMatchObject({
      unavailable: true,
      characterCount: 20100,
      sources: blocks,
    });
  });
  it('rejects ambiguous duplicate sources and returns no passage for an empty chapter', () => {
    expect(() => buildReadingPassages(content([source(), source()]))).toThrow();
    expect(buildReadingPassages(content([]))).toEqual([]);
  });
});
