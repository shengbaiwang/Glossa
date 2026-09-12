import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChapterContent, ChapterSource } from '@/glossa/context/types';
import { ModelServiceError, type ProviderConfig } from '@/glossa/ai/provider';
import { buildReadingPassages } from '@/glossa/guide/passages';
import { parseReadingGuide } from '@/glossa/guide/schema';
import { generateReadingGuide, getReadingGuideCacheKey } from '@/glossa/guide/generate';

const config: ProviderConfig = {
  id: 'test',
  name: 'Test',
  baseUrl: 'https://example.test/v1',
  model: 'model',
};
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
const body = (sourceId = 's1') => ({
  orientation: [
    {
      text: 'The passage explains how conditions shape institutions.',
      sourceIds: [sourceId],
      kind: 'source',
    },
  ],
  difficulties: [
    {
      title: 'Conditions',
      explanation: {
        text: 'Follow the relation between a condition and its effect.',
        sourceIds: [sourceId],
        kind: 'inference',
      },
    },
  ],
  readingCue: {
    text: 'Look for the condition attached to the claim.',
    sourceIds: [sourceId],
    kind: 'inference',
  },
  insufficientEvidence: false,
});
const options = () => ({
  bookId: 'book-hash',
  bookTitle: 'Test Book',
  chapterTitle: 'Institutions',
  chapterId: 'chapter-1',
  passage: buildReadingPassages(content())[0]!,
  config,
});

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.clearAllMocks();
});

describe('reading passages', () => {
  it('accepts twenty thousand input characters across many complete paragraphs', async () => {
    const blocks = Array.from({ length: 200 }, (_, i) => source(`s${i}`, '甲'.repeat(100)));
    const passages = buildReadingPassages(content(blocks));
    expect(passages).toHaveLength(1);
    expect(passages[0]).toMatchObject({ characterCount: 20000, unavailable: false });
    const complete = vi.fn().mockResolvedValue(JSON.stringify(body('s0')));
    const result = await generateReadingGuide(
      { ...options(), passage: passages[0]! },
      { complete },
    );
    expect(JSON.parse(complete.mock.calls[0]![0].messages[1].content).sources).toHaveLength(200);
    expect(result.sources).toEqual(blocks);
    const split = buildReadingPassages(content([...blocks, source('next', '乙')]));
    expect(split.map((p) => p.characterCount)).toEqual([20000, 1]);
  });
  it('stores provider identity without capability parameters', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify(body()));
    const result = await generateReadingGuide(
      { ...options(), config: { ...config, reasoningEffort: 'high', maxTokens: 2048 } },
      { complete },
    );
    expect(result.provider).toEqual(config);
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

describe('reading guide evidence', () => {
  it('accepts a strict supported body and explicitly insufficient empty output', () => {
    expect(parseReadingGuide(JSON.stringify(body()), [source()])).toEqual(body());
    expect(
      parseReadingGuide(
        JSON.stringify({
          orientation: [],
          difficulties: [],
          readingCue: null,
          insufficientEvidence: true,
        }),
        [source()],
      ).insufficientEvidence,
    ).toBe(true);
  });
  it.each([
    'not JSON',
    JSON.stringify(body('future')),
    JSON.stringify({ ...body(), quiz: [] }),
    JSON.stringify({
      orientation: [],
      difficulties: [],
      readingCue: null,
      insufficientEvidence: false,
    }),
  ])('rejects invalid or unsupported output', (raw) => {
    expect(() => parseReadingGuide(raw, [source()])).toThrow();
  });
  it('rejects missing evidence, repeated references and excessive explanation', () => {
    for (const ids of [[], ['s1', 's1'], ['s1', 's2', 's3', 's4', 's5']]) {
      const value = body();
      value.orientation[0]!.sourceIds = ids;
      expect(() => parseReadingGuide(JSON.stringify(value), [source()])).toThrow();
    }
    const value = body();
    value.difficulties[0]!.explanation.text = 'a'.repeat(701);
    expect(() => parseReadingGuide(JSON.stringify(value), [source()])).toThrow();
    expect(() => parseReadingGuide(JSON.stringify(body()), [source(), source()])).toThrow();
  });
  it('allows clearly separate background only for a difficulty tied to related original text', () => {
    const value = body();
    value.difficulties[0]!.explanation.kind = 'background';
    expect(
      parseReadingGuide(JSON.stringify(value), [source()]).difficulties[0]!.explanation.kind,
    ).toBe('background');
    value.orientation[0]!.kind = 'background';
    expect(() => parseReadingGuide(JSON.stringify(value), [source()])).toThrow();
    value.orientation[0]!.kind = 'source';
    value.readingCue.kind = 'background';
    expect(() => parseReadingGuide(JSON.stringify(value), [source()])).toThrow();
    value.readingCue.kind = 'inference';
    value.difficulties[0]!.explanation.sourceIds = [];
    expect(() => parseReadingGuide(JSON.stringify(value), [source()])).toThrow();
  });
  it('rejects an excerpt reusing an anchor for different original text', () => {
    const excerpt = { ...source(), text: 'Conditions' };
    expect(() => parseReadingGuide(JSON.stringify(body()), [excerpt])).toThrow();
  });
});

describe('one explicit passage per generation', () => {
  it('recovers truncation once with more budget and exactly the same selected sources', async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ModelServiceError('cut short', 'length'))
      .mockResolvedValueOnce(JSON.stringify(body()));
    const input = options();
    input.passage = buildReadingPassages(content([source('s1', '甲'.repeat(4698))]))[0]!;
    const onRetry = vi.fn();
    const result = await generateReadingGuide({ ...input, onRetry }, { complete });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(result.orientation).toEqual(body().orientation);
    expect(complete).toHaveBeenCalledTimes(2);
    const [first, second] = complete.mock.calls.map(([request]) => request);
    expect(first.maxTokens).toBe(32768);
    expect(second.maxTokens).toBe(65536);
    expect(second.messages[1]).toEqual(first.messages[1]);
    expect(second.messages).toHaveLength(2);
  });
  it('does not retry other failures or trust invalid sources after recovery', async () => {
    const complete = vi.fn().mockRejectedValue(new ModelServiceError('Busy.'));
    await expect(generateReadingGuide(options(), { complete })).rejects.toMatchObject({
      code: 'service',
    });
    expect(complete).toHaveBeenCalledOnce();
    complete
      .mockReset()
      .mockRejectedValueOnce(new ModelServiceError('cut short', 'length'))
      .mockResolvedValueOnce(JSON.stringify(body('unselected-source')));
    await expect(generateReadingGuide(options(), { complete })).rejects.toMatchObject({
      code: 'invalid-response',
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it('bounds repeated truncation and never retries after cancellation', async () => {
    const error = new ModelServiceError('cut short', 'length');
    const complete = vi.fn().mockRejectedValue(error);
    await expect(generateReadingGuide(options(), { complete })).rejects.toBe(error);
    expect(complete).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    complete.mockReset().mockImplementation(async () => {
      controller.abort();
      throw error;
    });
    await expect(
      generateReadingGuide({ ...options(), signal: controller.signal }, { complete }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(complete).toHaveBeenCalledOnce();
  });
  it('makes one bounded request, reports stream progress and returns a verified result', async () => {
    const complete = vi.fn().mockImplementation(async (request) => {
      request.onDelta('abc');
      request.onDelta('def');
      return JSON.stringify(body());
    });
    const onProgress = vi.fn();
    const result = await generateReadingGuide({ ...options(), onProgress }, { complete });
    expect(complete).toHaveBeenCalledOnce();
    expect(onProgress.mock.calls).toEqual([[3], [6]]);
    const request = complete.mock.calls[0]![0];
    expect(request.messages[0].content).toContain('untrusted');
    expect(request.messages[1].content).not.toContain('epubcfi');
    expect(JSON.parse(request.messages[1].content).sources).toEqual([
      { sourceId: 's1', text: source().text, kind: 'paragraph' },
    ]);
    expect(result).toMatchObject({ schemaVersion: 1, bookId: 'book-hash' });
    expect(result.sources).toEqual([source()]);
  });
  it('never requests unavailable text or an already cancelled passage', async () => {
    const complete = vi.fn();
    await expect(
      generateReadingGuide(
        {
          ...options(),
          passage: buildReadingPassages(content([source('long', 'a'.repeat(20001))]))[0]!,
        },
        { complete },
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateReadingGuide({ ...options(), signal: controller.signal }, { complete }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(complete).not.toHaveBeenCalled();
  });
  it('preserves safe provider errors and does not save malformed or cancelled output', async () => {
    const error = new ModelServiceError('Service is busy.');
    await expect(
      generateReadingGuide(options(), { complete: vi.fn().mockRejectedValue(error) }),
    ).rejects.toBe(error);
    await expect(
      generateReadingGuide(options(), {
        complete: vi.fn().mockResolvedValue(JSON.stringify(body('unknown'))),
      }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    const controller = new AbortController();
    await expect(
      generateReadingGuide(
        { ...options(), signal: controller.signal },
        {
          complete: vi.fn().mockImplementation(async () => {
            controller.abort();
            return JSON.stringify(body());
          }),
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('binds the cache to original text, anchors, book and model service', async () => {
    const { passage } = options();
    const key = await getReadingGuideCacheKey('book-hash', passage, config);
    expect(await getReadingGuideCacheKey('book-hash', passage, config)).toBe(key);
    const changed = structuredClone(passage);
    changed.sources[0]!.anchor.cfi += '/2';
    for (const candidate of [
      getReadingGuideCacheKey('other-book', passage, config),
      getReadingGuideCacheKey('book-hash', changed, config),
      getReadingGuideCacheKey('book-hash', passage, { ...config, model: 'new' }),
      getReadingGuideCacheKey('book-hash', passage, {
        ...config,
        baseUrl: 'https://other.test/v1',
      }),
    ])
      expect(await candidate).not.toBe(key);
  });
  it('does not retain a form secret', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify(body()));
    const result = await generateReadingGuide(
      { ...options(), config: { ...config, apiKey: 'fixture-secret' } as ProviderConfig },
      { complete },
    );
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
  });
  it('keeps request evidence and cache immutable while the caller changes its selection', async () => {
    const input = options();
    const key = await getReadingGuideCacheKey(input.bookId, input.passage, config);
    const complete = vi.fn().mockImplementation(async () => {
      input.passage.sources[0]!.text = 'Changed after request';
      input.passage.sources[0]!.anchor.quote.exact = 'Changed after request';
      return JSON.stringify(body());
    });
    const result = await generateReadingGuide(input, { complete });
    expect(result.sources).toEqual([source()]);
    expect(result.cacheKey).toBe(key);
  });
  it('rejects mismatched passage identity or incomplete settings before a request', async () => {
    const complete = vi.fn();
    await expect(
      generateReadingGuide({ ...options(), chapterId: 'other-chapter' }, { complete }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      generateReadingGuide({ ...options(), config: { ...config, model: '' } }, { complete }),
    ).rejects.toBeInstanceOf(ModelServiceError);
    expect(complete).not.toHaveBeenCalled();
  });
  it('bounds untrusted metadata without cutting any evidence text', async () => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify(body()));
    await generateReadingGuide(
      { ...options(), bookTitle: 'B'.repeat(9000), chapterTitle: 'C'.repeat(9000) },
      { complete },
    );
    const data = JSON.parse(complete.mock.calls[0]![0].messages[1].content);
    expect(data.bookTitle.length).toBeLessThanOrEqual(240);
    expect(data.chapterTitle.length).toBeLessThanOrEqual(240);
    expect(data.sources[0].text).toBe(source().text);
  });
});
