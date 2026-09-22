import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelServiceError, type CompletionRequest } from '@/glossa/ai/provider';
import type { ChapterSource } from '@/glossa/context/types';
import { readingAnswerSchema } from '@/glossa/conversation/schema';
import { createBookReadingScope, createReadingScope } from '@/glossa/harness/scope';
import {
  generateBookConversation as generateBookConversationImpl,
  generateScopeOverview,
  BOOK_REQUEST_TIMEOUT_MS,
  MAX_OVERVIEW_CHARS,
  type BookConversationRequest,
} from '@/glossa/harness/bookConversation';
import { rankSources } from '@/glossa/harness/retrieval';

// Legacy direct-answer fixtures also exercise the native-tools answer path.
const generateBookConversation = (
  input: BookConversationRequest,
  { complete }: { complete: (request: CompletionRequest) => Promise<string> },
) =>
  generateBookConversationImpl(input, {
    complete,
    completeTools: async (request) => ({
      text: await complete({
        ...request,
        messages: request.messages as CompletionRequest['messages'],
      }),
      toolCalls: [],
    }),
  });

const source = (id: string, text: string): ChapterSource => ({
  sourceId: id,
  text,
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: 'epubcfi(/6/2!/4/2)',
    quote: { exact: text, prefix: '', suffix: '' },
  },
});
const originals = [
  source('s1', '一、中央集权。'),
  source('s2', '二、社会力量。'),
  source('s3', '三、皇权变化。'),
  source('s4', '四、制度的条件。'),
  source('s5', '结语：应理解传统并创造新法。'),
];
const fixture = (sources = originals): BookConversationRequest => ({
  scope: createBookReadingScope('fixture-book'),
  access: {
    documentHash: 'fixture-book',
    chapters: [
      { id: 'general', title: '总论', depth: 0 },
      { id: 'later', title: '后记', depth: 0 },
    ],
    readChapter: vi.fn(async () => sources),
    readAll: vi.fn(async () => sources),
    search: vi.fn(async () => sources),
    verifySources: vi.fn(async (items) => items),
  },
  metadata: { bookTitle: '原创书籍', author: '测试', chapterTitle: '总论' },
  config: { id: 'fixture', name: 'Fixture', baseUrl: 'http://localhost:1234/v1', model: 'fixture' },
  question: '总论都表达了哪些观点？这些观点有矛盾吗？',
  turns: [],
  signal: new AbortController().signal,
});
const evidence = (request: CompletionRequest): { sources: { sourceId: string; text: string }[] } =>
  JSON.parse(request.messages[1]!.content);
const citeAll = (request: CompletionRequest) =>
  evidence(request)
    .sources.map((item) => `观点 [1](#source-${item.sourceId})`)
    .join('\n');
const respond = (request: CompletionRequest) =>
  request.messages[0]!.content.includes('Build a complete argument inventory')
    ? JSON.stringify({
        coveredSourceIds: evidence(request).sources.map((s) => s.sourceId),
        points: evidence(request).sources.map((s) => ({
          text: s.text.slice(0, 20),
          sourceIds: [s.sourceId],
        })),
      })
    : citeAll(request);
afterEach(() => vi.useRealTimers());

describe('book-wide reading conversation', () => {
  it('reuses only validated inventories and invalidates on model and original changes', async () => {
    const input = fixture();
    const complete = vi.fn(async (request: CompletionRequest) => respond(request));
    await generateBookConversation(input, { complete });
    await generateBookConversation(input, { complete });
    expect(complete).toHaveBeenCalledTimes(3);
    input.config = { ...input.config, model: 'changed-model' };
    await generateBookConversation(input, { complete });
    expect(complete).toHaveBeenCalledTimes(5);
    vi.mocked(input.access.readChapter).mockResolvedValue([source('new', '新的原文。')]);
    await generateBookConversation(input, { complete });
    expect(complete).toHaveBeenCalledTimes(7);
  });

  it('resumes after a later batch failed without redoing already validated inventories', async () => {
    const input = {
      ...fixture(Array.from({ length: 12 }, (_, i) => source(`r${i}`, '观点。'.repeat(550)))),
      question: '总结全书',
    };
    const complete = vi.fn(async (request: CompletionRequest) => {
      if (complete.mock.calls.length === 2) throw new ModelServiceError('service unavailable');
      return respond(request);
    });
    await expect(generateBookConversation(input, { complete })).rejects.toThrow(
      'service unavailable',
    );
    const answer = await generateBookConversation(input, { complete });
    expect(complete).toHaveBeenCalledTimes(4);
    expect(answer.coverage?.readSources).toBe(12);
  });

  it('keeps inventory budgets independent of the preferred reply limit', async () => {
    const input = fixture();
    input.config.maxTokens = 256;
    const complete = vi.fn(async (request: CompletionRequest) => respond(request));
    await generateBookConversation(input, { complete });
    expect(complete.mock.calls[0]![0].maxTokens).toBeGreaterThanOrEqual(8192);
    expect(complete.mock.calls[1]![0].maxTokens).toBe(256);
  });

  it('answers an ordinary selection question with one visible model request', async () => {
    const input = { ...fixture(), question: '举出三个钱穆先生最为精彩的观点' };
    const complete = vi.fn(async (request: CompletionRequest) => respond(request));
    const answer = await generateBookConversation(input, { complete });
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]![0].onDelta).toBeTypeOf('function');
    expect(input.access.search).toHaveBeenCalledOnce();
    expect(answer.coverage?.strategy).toBe('search');
  });

  it('selects a few points within a named chapter even without topical keywords', async () => {
    const input = { ...fixture(), question: '从总论举出三个精彩观点' };
    const complete = vi.fn(async (request: CompletionRequest) => respond(request));
    const answer = await generateBookConversation(input, { complete });
    expect(complete).toHaveBeenCalledOnce();
    expect(answer.sources).toHaveLength(originals.length);
    expect(input.access.search).not.toHaveBeenCalled();
    expect(input.access.readAll).not.toHaveBeenCalled();
  });

  it('continues a truncated answer with the same evidence without erasing the prefix', async () => {
    const input = { ...fixture(), question: '皇权为什么变化？', onText: vi.fn() };
    const complete = vi.fn(async (request: CompletionRequest) => {
      if (complete.mock.calls.length === 1) {
        request.onDelta?.('先看制度 [1](#source-s1)。');
        throw new ModelServiceError('cut short', 'length');
      }
      request.onDelta?.('再看社会 [2](#source-s2)。');
      return '再看社会 [2](#source-s2)。';
    });
    const answer = await generateBookConversation(input, { complete });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(answer.text).toBe('先看制度 [1](#source-s1)。再看社会 [2](#source-s2)。');
    expect(evidence(complete.mock.calls[1]![0])).toEqual(evidence(complete.mock.calls[0]![0]));
    expect(input.onText.mock.calls.every(([text]) => text.startsWith('先看制度'))).toBe(true);
    expect(complete.mock.calls[1]![0].maxTokens).toBeGreaterThan(
      complete.mock.calls[0]![0].maxTokens!,
    );
  });

  it('splits only the exhausted inventory batch and still covers its tail', async () => {
    const input = fixture();
    const complete = vi.fn(async (request: CompletionRequest) => {
      if (complete.mock.calls.length === 1) throw new ModelServiceError('cut short', 'length');
      return respond(request);
    });
    const answer = await generateBookConversation(input, { complete });
    expect(complete).toHaveBeenCalledTimes(4);
    expect(answer.coverage).toMatchObject({ readSources: 5, totalSources: 5 });
    expect(answer.text).toContain('#source-s5');
  });

  it('bounds repeated truncation, keeping partial text available for retry', async () => {
    const input = { ...fixture(), question: '皇权为什么变化？', onText: vi.fn() };
    const complete = vi.fn(async (request: CompletionRequest) => {
      request.onDelta?.(`片段${complete.mock.calls.length} [1](#source-s1)。`);
      throw new ModelServiceError('cut short', 'length');
    });
    await expect(generateBookConversation(input, { complete })).rejects.toMatchObject({
      code: 'length',
    });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(input.onText.mock.lastCall?.[0]).toContain('片段3');
  });

  it('does not clear a useful answer if its coverage revision fails before streaming', async () => {
    const input = { ...fixture(), onText: vi.fn() };
    const complete = vi.fn(async (request: CompletionRequest) => {
      if (complete.mock.calls.length === 1) return respond(request);
      if (complete.mock.calls.length === 2) return '已有答案 [1](#source-s1)';
      throw new ModelServiceError('service unavailable');
    });
    await expect(generateBookConversation(input, { complete })).rejects.toThrow(
      'service unavailable',
    );
    expect(input.onText.mock.lastCall?.[0]).toBe('已有答案 [1](#source-s1)');
  });

  it('keeps an explicit attachment narrower than whole-book wording and excludes book-wide history', async () => {
    const input = fixture();
    const scope = createReadingScope({
      documentHash: input.scope.documentHash,
      kind: 'selection',
      title: 'Selected text',
      chapterTitle: '总论',
      sources: originals.slice(0, 2),
    });
    const complete = vi.fn(async (request: CompletionRequest) => respond(request));
    const answer = await generateScopeOverview(
      {
        ...input,
        scope,
        question: '总结全书观点',
        turns: [
          {
            question: 'OLD_BOOK_QUESTION',
            text: 'OLD_BOOK_ANSWER [1](#source-s5)',
            status: 'complete',
            reading: { scope: input.scope, sources: originals, mode: 'direct' },
          },
        ],
      },
      { complete },
    );
    expect(complete).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(complete.mock.calls)).not.toMatch(/OLD_BOOK_|皇权变化|结语/);
    expect(answer.sources).toEqual(scope.sources);
    expect(answer.coverage).toMatchObject({ readSources: 2, totalSources: 2 });
    expect(
      readingAnswerSchema.safeParse({
        scope,
        sources: answer.sources,
        mode: answer.mode,
        coverage: answer.coverage,
      }).success,
    ).toBe(true);
  });

  it('reads the named chapter completely before answering, retaining the fourth argument and conclusion', async () => {
    const input = fixture();
    const complete = vi.fn(async (request: CompletionRequest) => respond(request));
    const answer = await generateBookConversation(input, { complete });
    expect(input.access.readChapter).toHaveBeenCalledWith('general', expect.any(AbortSignal));
    expect(input.access.readAll).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(evidence(complete.mock.calls[0]![0]).sources).toEqual(
      originals.map(({ sourceId, text }) => ({ sourceId, text })),
    );
    expect(JSON.stringify(complete.mock.calls[0]![0].messages)).not.toContain('epubcfi');
    expect(answer.coverage).toMatchObject({
      strategy: 'overview',
      readSources: 5,
      totalSources: 5,
      title: '总论',
    });
  });

  it.each([
    'title',
    'angle',
    'reference',
  ])('accepts actual %s-style citations without an unnecessary repair', async (style) => {
    const complete = vi.fn(async (request: CompletionRequest) => {
      if (request.messages[0]!.content.includes('Build a complete argument inventory'))
        return respond(request);
      return evidence(request)
        .sources.map(({ sourceId }) => {
          if (style === 'title') return `观点 [1](#source-${sourceId} "原文")`;
          if (style === 'angle') return `观点 [1](<#source-${sourceId}>)`;
          return `观点 [1][${sourceId}]\n\n[${sourceId}]: #source-${sourceId}`;
        })
        .join('\n\n');
    });
    await generateBookConversation(fixture(), { complete });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('does not mistake source links inside a code example for cited arguments', async () => {
    let answers = 0;
    const complete = vi.fn(async (request: CompletionRequest) => {
      if (request.messages[0]!.content.includes('Build a complete argument inventory'))
        return respond(request);
      return ++answers === 1
        ? `\x60\x60\x60md\n${citeAll(request)}\n\x60\x60\x60`
        : citeAll(request);
    });
    await generateBookConversation(fixture(), { complete });
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it('lets the answer explain a short range without arguments using its original text', async () => {
    const input = fixture([source('front', '版权页：本书为原创测试材料。')]);
    const complete = vi.fn(async (request: CompletionRequest) =>
      request.messages[0]!.content.includes('Build a complete argument inventory')
        ? JSON.stringify({ coveredSourceIds: ['front'], points: [] })
        : '这里只有版权信息，没有可总结的论点。[1](#source-front)',
    );
    const answer = await generateBookConversation(input, { complete });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(evidence(complete.mock.calls[1]![0]).sources[0]?.text).toBe(
      '版权页：本书为原创测试材料。',
    );
    expect(answer.text).toContain('没有可总结的论点');
  });

  it('reads all batches for a long overview, then repairs an omitted argument citation once', async () => {
    const all = Array.from({ length: 12 }, (_, i) =>
      source(`p${i}`, `论点${i} ${'说明。'.repeat(550)}`),
    );
    const input = { ...fixture(all), question: '总结全书所有观点' };
    let final = 0;
    const complete = vi.fn(async (request: CompletionRequest) => {
      const part = evidence(request).sources;
      if (request.messages[0]!.content.includes('Build a complete argument inventory'))
        return JSON.stringify({
          coveredSourceIds: part.map((s) => s.sourceId),
          points: part.map((s) => ({ text: s.text.slice(0, 20), sourceIds: [s.sourceId] })),
        });
      return ++final === 1 ? `不完整 [1](#source-p0)` : citeAll(request);
    });
    const result = await generateBookConversation(input, { complete });
    const mapCalls = complete.mock.calls
      .map(([request]) => request)
      .filter((request) =>
        request.messages[0]!.content.includes('Build a complete argument inventory'),
      );
    expect(mapCalls).toHaveLength(2);
    expect(mapCalls.flatMap((request) => evidence(request).sources.map((s) => s.sourceId))).toEqual(
      all.map((s) => s.sourceId),
    );
    expect(complete).toHaveBeenCalledTimes(4);
    expect(result.text).toContain('#source-p11');
    expect(result.coverage?.readSources).toBe(all.length);
    expect(input.access.readAll).toHaveBeenCalledOnce();
  });

  it('rejects an incomplete or forged inventory instead of claiming full coverage', async () => {
    const all = Array.from({ length: 12 }, (_, i) => source(`p${i}`, '原文。'.repeat(550)));
    const complete = vi.fn(async () =>
      JSON.stringify({
        coveredSourceIds: ['p0'],
        points: [{ text: 'Invented', sourceIds: ['outside'] }],
      }),
    );
    await expect(generateBookConversation(fixture(all), { complete })).rejects.toThrow(
      'inventory was incomplete',
    );
    expect(complete).toHaveBeenCalledOnce();
  });

  it('fails oversized complete summaries before sending any original text', async () => {
    const all = Array.from({ length: Math.ceil(MAX_OVERVIEW_CHARS / 10000) + 1 }, (_, i) =>
      source(`p${i}`, 'x'.repeat(10000)),
    );
    const complete = vi.fn();
    await expect(generateBookConversation(fixture(all), { complete })).rejects.toThrow('too long');
    expect(complete).not.toHaveBeenCalled();
  });

  it('rejects unknown planned chapter IDs and cross-book access', async () => {
    const input = { ...fixture(), question: '概括作者思想' };
    const complete = vi.fn(async () =>
      JSON.stringify({ strategy: 'overview', chapterIds: ['invented'], queries: [] }),
    );
    await expect(generateBookConversation(input, { complete })).rejects.toThrow(
      'chapter is unavailable',
    );
    expect(input.access.readChapter).not.toHaveBeenCalled();
    await expect(
      generateBookConversation(
        { ...input, scope: createBookReadingScope('another') },
        { complete },
      ),
    ).rejects.toThrow('another book');
  });

  it('revalidates same-book history and excludes detached-range or changed evidence', async () => {
    const input = fixture();
    const past = {
      question: '旧问题',
      text: '旧回答 [1](#source-s1)',
      status: 'complete' as const,
      reading: { scope: input.scope, sources: [originals[0]!], mode: 'direct' as const },
    };
    input.turns = [
      past,
      {
        ...past,
        text: 'ATTACHED_ANSWER',
        reading: {
          ...past.reading,
          scope: createReadingScope({
            documentHash: 'fixture-book',
            title: 'page',
            kind: 'page',
            sources: [originals[0]!],
          }),
        },
      },
    ];
    const complete = vi.fn(async (request: CompletionRequest) => respond(request));
    await generateBookConversation(input, { complete });
    const wire = JSON.stringify(complete.mock.calls[1]![0].messages);
    expect(wire).toContain('旧回答');
    expect(wire).not.toContain('ATTACHED_ANSWER');
    input.access.verifySources = vi.fn(async () => []);
    await generateBookConversation(input, { complete });
    expect(JSON.stringify(complete.mock.lastCall![0].messages)).not.toContain('旧回答');
  });

  it('cancels a stuck provider and ignores late streamed content', async () => {
    const controller = new AbortController();
    const onText = vi.fn();
    let active: CompletionRequest | undefined;
    const complete = vi.fn((request: CompletionRequest) => {
      if (request.messages[0]!.content.includes('Build a complete argument inventory'))
        return Promise.resolve(respond(request));
      active = request;
      return new Promise<string>(() => {});
    });
    const result = generateBookConversation(
      { ...fixture(), signal: controller.signal, onText },
      { complete },
    );
    await vi.waitFor(() => expect(active).toBeDefined());
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(() => active!.onDelta?.('late')).toThrow();
    expect(onText).not.toHaveBeenCalled();
  });

  it('enforces the request deadline even when the transport ignores abort', async () => {
    vi.useFakeTimers();
    const complete = vi.fn(async () => new Promise<string>(() => {}));
    const result = generateBookConversation(fixture(), { complete });
    const rejection = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(BOOK_REQUEST_TIMEOUT_MS);
    await rejection;
  });

  it('stores a compact book permission and validates only original evidence snapshots', () => {
    const scope = createBookReadingScope('fixture-book');
    expect(scope.sources).toEqual([]);
    expect(
      readingAnswerSchema.parse({ scope, sources: originals, mode: 'direct' }).sources,
    ).toHaveLength(5);
    expect(
      readingAnswerSchema.safeParse({
        scope,
        sources: [{ ...originals[0], text: 'forged' }],
        mode: 'direct',
      }).success,
    ).toBe(false);
  });

  it('finds Chinese concepts inside a natural question without whitespace', () => {
    const found = rankSources(
      [
        source('unrelated', '天空是蓝色的。'),
        source('relevant', '中央集权有助于统一，也可能削弱地方政治。'),
      ],
      '为什么中央集权会削弱地方政治？',
    );
    expect(found[0]?.sourceId).toBe('relevant');
  });
});
