import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChapterContent, ChapterSource } from '@/glossa/context/types';
import type { ProviderConfig } from '@/glossa/ai/provider';
import { parseStudyNote } from '@/glossa/notes/schema';
import { splitNoteSources } from '@/glossa/notes/chunks';
import { generateStudyNote, getStudyNoteCacheKey } from '@/glossa/notes/generate';
import { exportStudyNoteMarkdown } from '@/glossa/notes/export';

vi.mock('@/glossa/ai/provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/glossa/ai/provider')>()),
  streamCompletion: vi.fn(),
}));
vi.mock('@/glossa/notes/store', () => ({ saveStudyNote: vi.fn() }));

const config: ProviderConfig = {
  id: 'test',
  name: 'Test',
  baseUrl: 'https://example.test/v1',
  model: 'test-model',
};
const source = (
  sourceId = 's1',
  text = 'The author argues that local conditions shape institutions.',
): ChapterSource => ({
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
  characterCount: sources.reduce((total, item) => total + item.text.length, 0),
});
const body = (sourceId = 's1') => ({
  title: 'Institutions',
  overview: [{ text: 'Local context matters.', sourceIds: [sourceId], kind: 'source' }],
  sections: [
    {
      heading: 'Reasoning',
      paragraphs: [
        {
          text: 'Institutions develop within local conditions.',
          sourceIds: [sourceId],
          kind: 'source',
        },
      ],
    },
  ],
  questions: [
    {
      question: 'Why does context matter?',
      answer: 'Institutions reflect local conditions.',
      sourceIds: [sourceId],
    },
  ],
  insufficientEvidence: false,
});

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.clearAllMocks();
});

describe('study note evidence schema', () => {
  it('accepts fenced JSON but preserves only strictly validated fields', () => {
    expect(parseStudyNote('```json\n' + JSON.stringify(body()) + '\n```', [source()])).toEqual(
      body(),
    );
  });
  it.each([
    'not JSON',
    JSON.stringify({ ...body(), instructions: 'run this command' }),
    JSON.stringify(body('unknown')),
  ])('rejects malformed schema and invented source IDs: %s', (text) => {
    expect(() => parseStudyNote(text, [source()])).toThrow();
  });
  it('requires evidence for every paragraph and question', () => {
    const ungrounded = body();
    ungrounded.sections[0]!.paragraphs[0]!.sourceIds = [];
    expect(() => parseStudyNote(JSON.stringify(ungrounded), [source()])).toThrow();
    const question = body();
    question.questions[0]!.sourceIds = ['not-in-this-chunk'];
    expect(() => parseStudyNote(JSON.stringify(question), [source()])).toThrow();
  });
  it('normalizes repeated valid references to one local citation', () => {
    const repeated = body();
    repeated.sections[0]!.paragraphs[0]!.sourceIds = ['s1', 's1'];
    expect(
      parseStudyNote(JSON.stringify(repeated), [source()]).sections[0]!.paragraphs[0]!.sourceIds,
    ).toEqual(['s1']);
  });
  it('accepts an explicit evidence-insufficient result without invented prose', () => {
    expect(
      parseStudyNote(
        JSON.stringify({
          title: 'Unavailable',
          overview: [],
          sections: [],
          questions: [],
          insufficientEvidence: true,
        }),
        [source()],
      ).insufficientEvidence,
    ).toBe(true);
  });
  it('does not mistake a blank successful answer for useful notes', () => {
    expect(() =>
      parseStudyNote(
        JSON.stringify({
          title: 'Unavailable',
          overview: [],
          sections: [],
          questions: [],
          insufficientEvidence: false,
        }),
        [source()],
      ),
    ).toThrow();
  });
});

describe('source chunking', () => {
  it('keeps paragraphs together and puts a following heading with its text', () => {
    const sources = [
      source('a', 'a'.repeat(60)),
      { ...source('h', 'Title'), kind: 'heading' as const },
      source('b', 'b'.repeat(50)),
    ];
    const chunks = splitNoteSources(sources, 100);
    expect(chunks.map((chunk) => chunk.map((item) => item.sourceId))).toEqual([['a'], ['h', 'b']]);
  });
  it('retains the full text and source anchor of an oversized paragraph', () => {
    const original = source(
      'long',
      '甲'.repeat(60) + '。' + '乙'.repeat(60) + '。' + '😀'.repeat(80),
    );
    const chunks = splitNoteSources([original], 100);
    expect(
      chunks
        .flat()
        .map((item) => item.text)
        .join(''),
    ).toBe(original.text);
    expect(
      chunks.every(
        (chunk) => chunk.reduce((n, item) => n + Array.from(item.text).length, 0) <= 100,
      ),
    ).toBe(true);
    expect(
      chunks.flat().every((item) => item.sourceId === 'long' && item.anchor === original.anchor),
    ).toBe(true);
  });
});

describe('deterministic study note generation', () => {
  it('streams validated partial notes and saves only the complete result', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const partial = vi.fn();
    const complete = vi.fn().mockResolvedValue(JSON.stringify(body()));
    const version = await generateStudyNote(
      {
        bookId: 'book-hash',
        bookTitle: 'Test Book',
        content: content(),
        config,
        onPartial: partial,
      },
      { complete, persist },
    );
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]![0].messages[0].content).toContain('untrusted');
    expect(complete.mock.calls[0]![0].messages[1].content).toContain('s1');
    expect(partial).toHaveBeenCalledWith(expect.objectContaining({ sections: body().sections }));
    expect(persist).toHaveBeenCalledWith(version, undefined);
    expect(version.sources[0]!.anchor.quote.exact).toBe(source().text);
  });
  it('retains details from all chunks and never feeds prior notes back to the model', async () => {
    const sources = [source('s1', 'a'.repeat(12000)), source('s2', 'b'.repeat(12000))];
    const complete = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(body('s1')))
      .mockResolvedValueOnce(JSON.stringify(body('s2')));
    const persist = vi.fn().mockResolvedValue(undefined);
    const version = await generateStudyNote(
      { bookId: 'book', bookTitle: 'Test', content: content(sources), config },
      { complete, persist },
    );
    expect(version.sections.filter((section) => section.heading === 'Reasoning')).toHaveLength(2);
    expect(version.sections.flatMap((section) => section.paragraphs)).toHaveLength(4);
    expect(version.overview).toEqual([]);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![0].messages[1].content).not.toContain('Institutions develop');
  });
  it('carries the preceding local heading into a continuation without including future headings', async () => {
    const sources = [
      { ...source('heading', 'Context'), kind: 'heading' as const },
      source('s1', 'a'.repeat(11993)),
      source('s2', 'b'.repeat(12000)),
      { ...source('later', 'Later topic'), kind: 'heading' as const },
      source('s3', 'A later point.'),
    ];
    const complete = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(body('s1')))
      .mockResolvedValueOnce(JSON.stringify(body('s2')))
      .mockResolvedValueOnce(JSON.stringify(body('s3')));
    await generateStudyNote(
      { bookId: 'book', bookTitle: 'Test', content: content(sources), config },
      { complete, persist: vi.fn().mockResolvedValue(undefined) },
    );
    const second = JSON.parse(complete.mock.calls[1]![0].messages[1].content);
    expect(second.sources.map((item: { sourceId: string }) => item.sourceId)).toEqual([
      'heading',
      's2',
    ]);
    expect(second.sources[0].text).toBe('Context');
    expect(complete.mock.calls[0]![0].messages[1].content).not.toContain('Later topic');
  });
  it('does not save a failed or cancelled generation', async () => {
    const persist = vi.fn();
    await expect(
      generateStudyNote(
        { bookId: 'book', bookTitle: 'Test', content: content(), config },
        { complete: vi.fn().mockResolvedValue(JSON.stringify(body('invented'))), persist },
      ),
    ).rejects.toThrow();
    const controller = new AbortController();
    const complete = vi.fn().mockImplementation(async () => {
      controller.abort();
      return JSON.stringify(body());
    });
    await expect(
      generateStudyNote(
        {
          bookId: 'book',
          bookTitle: 'Test',
          content: content(),
          config,
          signal: controller.signal,
        },
        { complete, persist },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(persist).not.toHaveBeenCalled();
  });
  it('keeps verified partial output visible without saving or retrying when a later part fails', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(body('s1')))
      .mockResolvedValueOnce('{"unfinished":');
    const persist = vi.fn();
    const onPartial = vi.fn();
    await expect(
      generateStudyNote(
        {
          bookId: 'book',
          bookTitle: 'Test',
          content: content([source('s1', 'a'.repeat(12000)), source('s2', 'b'.repeat(12000))]),
          config,
          onPartial,
        },
        { complete, persist },
      ),
    ).rejects.toThrow();
    expect(onPartial).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(persist).not.toHaveBeenCalled();
  });
  it('makes no request for an empty chapter or an already cancelled action', async () => {
    const complete = vi.fn();
    const persist = vi.fn();
    await expect(
      generateStudyNote(
        { bookId: 'book', bookTitle: 'Test', content: content([]), config },
        { complete, persist },
      ),
    ).rejects.toThrow('no readable text');
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateStudyNote(
        {
          bookId: 'book',
          bookTitle: 'Test',
          content: content(),
          config,
          signal: controller.signal,
        },
        { complete, persist },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(complete).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
  it('does not claim success if local persistence fails', async () => {
    await expect(
      generateStudyNote(
        { bookId: 'book', bookTitle: 'Test', content: content(), config },
        {
          complete: vi.fn().mockResolvedValue(JSON.stringify(body())),
          persist: vi.fn().mockRejectedValue(new Error('disk full')),
        },
      ),
    ).rejects.toThrow('could not be saved');
  });
  it('invalidates cache on source text, book, model or endpoint changes', async () => {
    const key = await getStudyNoteCacheKey('book', content(), config);
    expect(await getStudyNoteCacheKey('book', content(), config)).toBe(key);
    for (const changed of [
      getStudyNoteCacheKey('other-book', content(), config),
      getStudyNoteCacheKey('book', content([source('s1', 'Changed chapter')]), config),
      getStudyNoteCacheKey('book', content(), { ...config, model: 'new-model' }),
      getStudyNoteCacheKey('book', content(), { ...config, baseUrl: 'https://other.test/v1' }),
    ])
      expect(await changed).not.toBe(key);
  });
  it('normalizes saved provider metadata and never retains an extra form secret', async () => {
    const supplied = {
      ...config,
      baseUrl: `${config.baseUrl}/chat/completions`,
      apiKey: 'fixture-only-secret',
    };
    const note = await generateStudyNote(
      { bookId: 'book', bookTitle: 'Test', content: content(), config: supplied },
      {
        complete: vi.fn().mockResolvedValue(JSON.stringify(body())),
        persist: vi.fn().mockResolvedValue(undefined),
      },
    );
    expect(note.provider).toEqual(config);
    expect(JSON.stringify(note)).not.toContain('fixture-only-secret');
    expect(await getStudyNoteCacheKey('book', content(), supplied)).toBe(
      await getStudyNoteCacheKey('book', content(), config),
    );
    await expect(
      getStudyNoteCacheKey('book', content(), {
        ...config,
        baseUrl: `${config.baseUrl}?key=fixture`,
      }),
    ).rejects.toThrow();
  });
  it('exports local source quotes with distinct personal notes', async () => {
    const version = await generateStudyNote(
      { bookId: 'book', bookTitle: 'Test', content: content(), config },
      {
        complete: vi.fn().mockResolvedValue(JSON.stringify(body())),
        persist: vi.fn().mockResolvedValue(undefined),
      },
    );
    const markdown = exportStudyNoteMarkdown(version, 'My separate reflection');
    expect(markdown).toContain('[^1]');
    expect(markdown).toContain(source().text);
    expect(markdown).toContain(source().anchor.cfi);
    expect(markdown).toContain('My separate reflection');
    expect(markdown).not.toContain('https://example.test');
  });
});
