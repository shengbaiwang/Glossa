import { beforeEach, expect, it, vi } from 'vitest';
import { generateBookConversation } from '@/glossa/harness/bookConversation';
import { createBookReadingScope } from '@/glossa/harness/scope';
import type { ChapterSource } from '@/glossa/context/types';
import { createReplyUsage, sumReplyCosts, sumReplyTokens } from '@/glossa/conversation/usage';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/utils/bridge', () => ({ getSecureItem: async () => ({}) }));
beforeEach(() => {
  localStorage.clear();
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});

it.each([
  '',
  '前半 [1](#source-original)。',
])('recovers actual SSE length termination after %j through the book harness', async (partial) => {
  const original: ChapterSource = {
    sourceId: 'original',
    text: '制度需要随时代改变。',
    kind: 'paragraph',
    anchor: {
      sectionIndex: 0,
      cfi: 'epubcfi(/6/2!/4/2)',
      quote: { exact: '制度需要随时代改变。', prefix: '', suffix: '' },
    },
  };
  const reply = '后半 [1](#source-original)。';
  const response = (content: string, reason: string) =>
    new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: reason }] })}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,"cost":0.005}}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  mocks.fetch
    .mockResolvedValueOnce(response(partial, 'length'))
    .mockResolvedValueOnce(response(reply, 'stop'));
  const onText = vi.fn();
  const usage = createReplyUsage();
  const result = await generateBookConversation({
    scope: createBookReadingScope('synthetic-book'),
    access: {
      documentHash: 'synthetic-book',
      chapters: [],
      readAll: async () => [original],
      readChapter: async () => [original],
      search: async () => [original],
      verifySources: async (sources) => sources,
    },
    metadata: { bookTitle: '原创测试', author: '', chapterTitle: '' },
    question: '制度为什么改变？',
    turns: [],
    config: {
      id: 'test',
      name: 'Test',
      baseUrl: 'https://models.example/v1',
      model: 'test',
      maxTokens: 256,
    },
    signal: new AbortController().signal,
    onText,
    onMetrics: usage.onMetrics,
  });
  expect(result.text).toBe(partial + reply);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  const first = JSON.parse(mocks.fetch.mock.calls[0]![1].body);
  const retry = JSON.parse(mocks.fetch.mock.calls[1]![1].body);
  expect(first.max_tokens).toBe(256);
  expect(retry.max_tokens).toBe(8192);
  expect(retry.messages[1]).toEqual(first.messages[1]);
  expect(JSON.stringify(retry)).not.toContain('epubcfi');
  expect(onText.mock.lastCall?.[0]).toBe(partial + reply);
  const receipt = usage.snapshot();
  expect(receipt.requests.map((request) => request.outputBudget)).toEqual([256, 8192]);
  expect(sumReplyTokens(receipt, 'totalTokens')).toEqual({ value: 240, partial: false });
  expect(sumReplyCosts(receipt)).toEqual({
    totals: [{ amount: 0.01 }],
    reported: 2,
    partial: false,
  });
});

it('executes a native SSE tool call and supplies verified local evidence in the next request', async () => {
  const text = '作者希望回应当时对旧制度的误解。';
  const original: ChapterSource = {
    sourceId: 'preface',
    text,
    kind: 'paragraph',
    anchor: {
      sectionIndex: 0,
      cfi: 'epubcfi(/6/2!/4/2)',
      quote: { exact: text, prefix: '', suffix: '' },
    },
  };
  const event = (delta: unknown, finish_reason: string) =>
    new Response(
      `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  mocks.fetch
    .mockResolvedValueOnce(
      event(
        {
          tool_calls: [
            {
              index: 0,
              id: 'read-1',
              type: 'function',
              function: {
                name: 'read_chapter',
                arguments: JSON.stringify({ chapterId: 'intro', query: '', offset: 0 }),
              },
            },
          ],
        },
        'tool_calls',
      ),
    )
    .mockResolvedValueOnce(event({ content: '回应时代误解。[1](#source-preface)' }, 'stop'));
  const readChapter = vi.fn(async () => [original]);
  const result = await generateBookConversation({
    scope: createBookReadingScope('synthetic-book'),
    access: {
      documentHash: 'synthetic-book',
      chapters: [{ id: 'intro', title: '序言', depth: 0 }],
      readAll: async () => [],
      readChapter,
      search: async () => [],
      verifySources: async (sources) => sources,
    },
    metadata: { bookTitle: '原创测试', author: '', chapterTitle: '' },
    question: '为什么写这本书？',
    turns: [],
    config: { id: 'test', name: 'Test', baseUrl: 'https://models.example/v1', model: 'test' },
    signal: new AbortController().signal,
  });
  expect(readChapter).toHaveBeenCalledWith('intro', expect.any(AbortSignal));
  const followup = JSON.parse(mocks.fetch.mock.calls[1]![1].body);
  expect(followup.messages.find((m: { role: string }) => m.role === 'tool')).toMatchObject({
    tool_call_id: 'read-1',
  });
  expect(JSON.stringify(followup)).toContain(text);
  expect(JSON.stringify(followup)).not.toContain('epubcfi');
  expect(result.sources).toEqual([original]);
  expect(result.text).toContain('#source-preface');
});
