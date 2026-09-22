import { expect, it, vi } from 'vitest';
import type { ChapterSource } from '@/glossa/context/types';
import { generateBookConversation } from '@/glossa/harness/bookConversation';
import { createBookReadingScope } from '@/glossa/harness/scope';
import type { ToolCompletionRequest } from '@/glossa/ai/provider';

const source = (sourceId: string, text: string): ChapterSource => ({
  sourceId,
  text,
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: 'epubcfi(/6/2!/4/2)',
    quote: { exact: text, prefix: '', suffix: '' },
  },
});
const credit = source('credit', '林某 著');
const preface = source('preface', '时代动荡使研究中断，作者希望借本书纠正对旧制度的误解。');
const fixture = () => ({
  scope: createBookReadingScope('original-fixture'),
  access: {
    documentHash: 'original-fixture',
    chapters: [{ id: 'preface', title: '序言', depth: 0 }],
    readChapter: vi.fn(async () => [preface]),
    readAll: vi.fn(async () => [credit, preface]),
    search: vi.fn(async () => [credit]),
    verifySources: vi.fn(async (items: ChapterSource[]) => items),
  },
  metadata: { bookTitle: '原创制度史', author: '林某', chapterTitle: '第一章' },
  question: '这本书是在什么历史背景下写作的？',
  turns: [],
  config: { id: 'fixture', name: 'Fixture', baseUrl: 'http://localhost/v1', model: 'fixture' },
  signal: new AbortController().signal,
});
const readCall = (id = 'preface') => ({
  id: 'call-1',
  type: 'function' as const,
  function: {
    name: 'read_chapter',
    arguments: JSON.stringify({ chapterId: id, query: '写作缘由', offset: 0 }),
  },
});

it('can acquire missing evidence even when the first search returned nonempty irrelevant hits', async () => {
  const input = fixture();
  const completeTools = vi.fn(async (request: ToolCompletionRequest) => {
    if (completeTools.mock.calls.length === 1) return { text: '', toolCalls: [readCall()] };
    expect(JSON.stringify(request.messages)).toContain(preface.text);
    return { text: '作者意在纠正误解。[1](#source-preface)', toolCalls: [] };
  });
  const answer = await generateBookConversation(input, { completeTools });
  expect(input.access.readChapter).toHaveBeenCalledWith('preface', expect.any(AbortSignal));
  expect(answer.sources).toContainEqual(preface);
  expect(answer.text).toContain('#source-preface');
  expect(input.access.readAll).not.toHaveBeenCalled();
  expect(completeTools).toHaveBeenCalledTimes(2);
});

it('rejects invented chapter IDs locally and bounds repeated tool requests', async () => {
  const input = fixture();
  const completeTools = vi.fn(async (request: ToolCompletionRequest) =>
    request.toolChoice === 'none'
      ? { text: '现有证据不足。', toolCalls: [] }
      : { text: '', toolCalls: [readCall('outside-book')] },
  );
  await generateBookConversation(input, { completeTools });
  expect(input.access.readChapter).not.toHaveBeenCalled();
  expect(completeTools.mock.calls.length).toBeLessThanOrEqual(4);
});

it('falls back to one bounded evidence plan when native tools are unsupported', async () => {
  const input = fixture();
  const { ModelServiceError } = await import('@/glossa/ai/provider');
  const completeTools = vi.fn(async () => {
    throw new ModelServiceError('unsupported', 'unsupported_tools');
  });
  const complete = vi.fn(async (request: import('@/glossa/ai/provider').CompletionRequest) => {
    if (complete.mock.calls.length === 1)
      return JSON.stringify({ queries: [], chapterIds: ['preface'] });
    expect(JSON.stringify(request.messages)).toContain(preface.text);
    return '作者意在纠正误解。[1](#source-preface)';
  });
  const answer = await generateBookConversation(input, { complete, completeTools });
  expect(completeTools).toHaveBeenCalledOnce();
  expect(complete).toHaveBeenCalledTimes(2);
  expect(answer.sources).toContainEqual(preface);
});

it('does not widen a named chapter when the model requests a book-wide search', async () => {
  const input = { ...fixture(), question: '序言为什么这样写？' };
  const completeTools = vi.fn(async () =>
    completeTools.mock.calls.length === 1
      ? {
          text: '',
          toolCalls: [
            {
              id: 'search',
              type: 'function' as const,
              function: {
                name: 'search_book',
                arguments: JSON.stringify({ queries: ['时代'], chapterIds: [] }),
              },
            },
          ],
        }
      : { text: '作者意在纠正误解。[1](#source-preface)', toolCalls: [] },
  );
  await generateBookConversation(input, { completeTools });
  expect(input.access.search).not.toHaveBeenCalled();
  expect(input.access.readChapter).toHaveBeenCalledWith('preface', expect.any(AbortSignal));
});

it('cancels a stalled follow-up read and never publishes its late answer', async () => {
  const input = fixture();
  const controller = new AbortController();
  let finish: () => void = () => {};
  input.access.readChapter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve([preface]);
        controller.abort();
      }),
  );
  const onText = vi.fn();
  const completeTools = vi.fn(async () => ({ text: '', toolCalls: [readCall()] }));
  await expect(
    generateBookConversation({ ...input, signal: controller.signal, onText }, { completeTools }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  finish();
  await Promise.resolve();
  expect(onText).not.toHaveBeenCalled();
  expect(completeTools).toHaveBeenCalledOnce();
});

it('bounds cumulative evidence and reports partial chapter reads with a continuation offset', async () => {
  const input = fixture();
  input.access.readChapter.mockResolvedValue(
    Array.from({ length: 40 }, (_, i) => source(`p${i}`, '原创论述。'.repeat(200))),
  );
  const completeTools = vi.fn(async (request: ToolCompletionRequest) => {
    if (completeTools.mock.calls.length === 1) return { text: '', toolCalls: [readCall()] };
    const result = JSON.parse(request.messages.find((m) => m.role === 'tool')!.content!);
    expect(result.complete).toBe(false);
    expect(result.nextOffset).toBeGreaterThan(0);
    expect(result.sources.length).toBeLessThan(result.totalMatches);
    return { text: '部分段落表明…[1](#source-p0) 无法据此概括全章。', toolCalls: [] };
  });
  const answer = await generateBookConversation(input, { completeTools });
  expect(answer.sources.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(30000);
});

it('uses the current passage for a deictic question without scanning the book first', async () => {
  const input = fixture();
  const readFocus = vi.fn(async () => [preface]);
  const completeTools = vi.fn(async (request: ToolCompletionRequest) => {
    expect(JSON.stringify(request.messages)).toContain(preface.text);
    return { text: '这段说明了作者的关切。[1](#source-preface)', toolCalls: [] };
  });
  const answer = await generateBookConversation(
    { ...input, question: '解释这段话', readFocus },
    { completeTools },
  );
  expect(readFocus).toHaveBeenCalledOnce();
  expect(input.access.search).not.toHaveBeenCalled();
  expect(input.access.readAll).not.toHaveBeenCalled();
  expect(answer.sources).toContainEqual(preface);
});

it('summarizes the referred passage completely instead of upgrading it to a whole-book summary', async () => {
  const input = fixture();
  const complete = vi.fn(async (request: import('@/glossa/ai/provider').CompletionRequest) =>
    request.messages[0]!.content.includes('Build a complete argument inventory')
      ? JSON.stringify({
          coveredSourceIds: ['preface'],
          points: [{ text: '纠正误解', sourceIds: ['preface'] }],
        })
      : '本段提出纠正误解。[1](#source-preface)',
  );
  const result = await generateBookConversation(
    { ...input, question: '总结这段话', readFocus: async () => [preface] },
    { complete },
  );
  expect(input.access.readAll).not.toHaveBeenCalled();
  expect(input.access.readChapter).not.toHaveBeenCalled();
  expect(result.coverage).toMatchObject({
    title: 'Current passage',
    strategy: 'overview',
    readSources: 1,
    totalSources: 1,
  });
});

it('does not substitute the whole book when the referred passage is unavailable', async () => {
  const input = fixture();
  await expect(
    generateBookConversation({ ...input, question: '总结这段话', readFocus: async () => [] }),
  ).rejects.toThrow('current passage is unavailable');
  expect(input.access.readAll).not.toHaveBeenCalled();
  expect(input.access.search).not.toHaveBeenCalled();
});
