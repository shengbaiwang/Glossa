import { describe, expect, it } from 'vitest';
import type { ChapterSource } from '@/glossa/context/types';
import {
  createReadingScope,
  getOutline,
  readPassage,
  readingScopeSchema,
  searchBook,
} from '@/glossa/harness/scope';

const source = (sourceId: string, text: string): ChapterSource => ({
  sourceId,
  text,
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: `epubcfi(/6/2!/4/${sourceId.length * 2})`,
    quote: { exact: text, prefix: '', suffix: '' },
  },
});
const sources = [
  { ...source('heading', 'Freedom'), kind: 'heading' as const },
  source('definition', 'Freedom requires an institution.'),
  source('example', 'Institutions provide a framework for freedom.'),
  source('other', 'The next argument concerns taxation.'),
];
const scope = () =>
  createReadingScope({ documentHash: 'book-a', kind: 'passage', title: 'Chapter one', sources });

describe('reading scope tools', () => {
  it('serializes a stable snapshot and binds its identity to the document and original sources', () => {
    const first = scope();
    expect(readingScopeSchema.parse(JSON.parse(JSON.stringify(first)))).toEqual(first);
    expect(scope().id).toBe(first.id);
    expect(createReadingScope({ ...first, documentHash: 'book-b' }).id).not.toBe(first.id);
    sources[0]!.anchor.quote.prefix = 'changed outside snapshot';
    expect(first.sources[0]!.anchor.quote.prefix).toBe('');
    sources[0]!.anchor.quote.prefix = '';
  });

  it('reads only requested in-scope blocks and rejects any invented or out-of-scope ID', () => {
    expect(readPassage(scope(), ['example', 'definition', 'example'])).toEqual([
      sources[2],
      sources[1],
    ]);
    expect(() => readPassage(scope(), ['definition', 'unread-chapter'])).toThrow();
    expect(() => readPassage(scope(), [])).toThrow();
  });

  it('searches complete scoped blocks case-insensitively, with phrase ranking and bounded results', () => {
    expect(searchBook(scope(), 'FREEDOM requires').map((item) => item.sourceId)).toEqual([
      'definition',
      'heading',
      'example',
    ]);
    expect(searchBook(scope(), 'freedom', 1)).toEqual([sources[0]]);
    expect(searchBook(scope(), 'secret from another chapter')).toEqual([]);
    expect(searchBook(scope(), '.*')).toEqual([]);
    expect(() => searchBook(scope(), ' ')).toThrow();
    expect(() => searchBook(scope(), 'freedom', 201)).toThrow();
  });

  it('outlines only the selected scope without exposing other book headings', () => {
    expect(getOutline(scope())).toEqual({
      title: 'Chapter one',
      headings: [{ sourceId: 'heading', text: 'Freedom' }],
      sourceIds: ['heading', 'definition', 'example', 'other'],
    });
  });

  it('rejects oversized, duplicate, empty and text-anchor inconsistent scopes', () => {
    for (const invalid of [
      [],
      [sources[0]!, sources[0]!],
      [source('long', 'x'.repeat(20001))],
      [{ ...source('bad', 'original'), text: 'model replacement' }],
    ]) {
      expect(() =>
        createReadingScope({
          documentHash: 'book-a',
          kind: 'page',
          title: 'Page',
          sources: invalid,
        }),
      ).toThrow();
    }
  });

  it('honors cancellation even for local read, search and outline', () => {
    const controller = new AbortController();
    controller.abort();
    for (const operation of [
      () => readPassage(scope(), ['definition'], controller.signal),
      () => searchBook(scope(), 'freedom', 5, controller.signal),
      () => getOutline(scope(), controller.signal),
    ])
      expect(operation).toThrow(expect.objectContaining({ name: 'AbortError' }));
  });
});
