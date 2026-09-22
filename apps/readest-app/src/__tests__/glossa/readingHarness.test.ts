import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ModelServiceError,
  type CompletionRequest,
  type ToolCall,
  type ToolCompletionRequest,
} from '@/glossa/ai/provider';
import type { ChapterSource } from '@/glossa/context/types';
import {
  generateReadingConversation,
  READING_REQUEST_TIMEOUT_MS,
  sanitizeReadingCitations,
} from '@/glossa/harness/generate';
import { createReadingScope } from '@/glossa/harness/scope';

const config = {
  id: 'fixture',
  name: 'Fixture',
  baseUrl: 'http://localhost:1234/v1',
  model: 'fixture',
};
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
  source('s-1', 'Freedom here means acting with an understanding of necessity.'),
  source('s-2', 'Earlier freedom meant choosing among alternatives.'),
  source('s-3', 'These definitions concern different questions.'),
];
const scope = createReadingScope({
  documentHash: 'a'.repeat(64),
  kind: 'passage',
  title: 'Definitions',
  chapterTitle: 'Chapter 1',
  sources,
});
const request = () => ({
  metadata: { bookTitle: 'Fixture', author: 'Author', chapterTitle: 'Chapter 1' },
  scope,
  question: 'Compare the meanings of freedom.',
  turns: [],
  config,
  signal: new AbortController().signal,
});
const call = (name: string, args: unknown, id = 'call-1'): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

afterEach(() => vi.useRealTimers());

describe('bounded reading harness', () => {
  it('supplies every block when asked to summarize all viewpoints, including late arguments', async () => {
    const all = Array.from({ length: 9 }, (_, i) =>
      source(
        `point-${i}`,
        `${i === 8 ? '第四个明确论点及结语' : `论述${i}`} ${'原文。'.repeat(240)}`,
      ),
    );
    const complete = vi.fn(async (_input: ToolCompletionRequest) => ({
      text: '四个论点 [1](#source-point-8)',
      toolCalls: [],
    }));
    await generateReadingConversation(
      {
        ...request(),
        question: '总论都表达了哪些观点？这些观点有矛盾吗？',
        scope: createReadingScope({ ...scope, sources: all }),
      },
      { complete },
    );
    const wire = JSON.stringify(complete.mock.calls[0]![0].messages);
    for (const block of all) expect(wire).toContain(block.text);
    expect(wire).toContain('coverage');
  });
  it('supplies scoped evidence, executes tools, and streams only citations actually delivered', async () => {
    const complete = vi
      .fn<(input: ToolCompletionRequest) => Promise<{ text: string; toolCalls: ToolCall[] }>>()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [call('read_passage', { sourceIds: ['s-2'] })],
      })
      .mockImplementationOnce(async (input) => {
        input.onDelta?.('Different meanings [1](#source-s-2), [2](#source-invented).');
        return {
          text: 'Different meanings [1](#source-s-2), [2](#source-invented).',
          toolCalls: [],
        };
      });
    const onText = vi.fn();
    const result = await generateReadingConversation({ ...request(), onText }, { complete });
    expect(result.mode).toBe('tools');
    expect(result.text).toContain('[1](#source-s-2)');
    expect(result.text).not.toContain('#source-invented');
    expect(result.sources.some((item) => item.sourceId === 's-2')).toBe(true);
    const messages = complete.mock.calls[1]![0].messages;
    expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-1' });
    expect(JSON.stringify(messages)).not.toMatch(/epubcfi|sectionIndex|prefix|suffix/);
    expect(onText).toHaveBeenLastCalledWith(result.text, result.sources);
  });

  it('forces a final answer after three tool calls and never executes a fourth', async () => {
    const complete = vi.fn(async (input: ToolCompletionRequest) =>
      input.toolChoice === 'none'
        ? { text: 'Answer [1](#source-s-1).', toolCalls: [] }
        : { text: '', toolCalls: [call('read_passage', { sourceIds: ['s-1'] })] },
    );
    await generateReadingConversation(request(), { complete });
    expect(complete).toHaveBeenCalledTimes(4);
    expect(complete.mock.calls.map(([input]) => input.toolChoice)).toEqual([
      'auto',
      'auto',
      'auto',
      'none',
    ]);
  });

  it('rejects unknown sources and extra tool arguments without broadening the scope', async () => {
    const complete = vi
      .fn<(input: ToolCompletionRequest) => Promise<{ text: string; toolCalls: ToolCall[] }>>()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          call('read_passage', { sourceIds: ['unread'] }, 'c1'),
          call('search_book', { query: 'freedom', scope: 'whole-book' }, 'c2'),
          call('get_outline', {}, 'c3'),
          call('read_passage', { sourceIds: ['s-1'] }, 'c4'),
        ],
      })
      .mockResolvedValueOnce({ text: 'Insufficient evidence.', toolCalls: [] });
    await generateReadingConversation(request(), { complete });
    const next = complete.mock.calls[1]![0];
    expect(next.toolChoice).toBe('none');
    const responses = next.messages.filter((message) => message.role === 'tool');
    expect(responses).toHaveLength(4);
    expect(responses[0]!.content).toContain('error');
    expect(responses[1]!.content).toContain('error');
    expect(responses[3]!.content).toContain('limit');
    expect(JSON.stringify(responses)).not.toContain('epubcfi');
  });

  it('caps distinct source text at 12000 characters and never publishes unavailable citations', async () => {
    const longSources = Array.from({ length: 5 }, (_, index) =>
      source(`s-${index}`, `${index} ${'x'.repeat(3998)}`),
    );
    const largeScope = createReadingScope({ ...scope, sources: longSources });
    const complete = vi
      .fn<(input: ToolCompletionRequest) => Promise<{ text: string; toolCalls: ToolCall[] }>>()
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [call('read_passage', { sourceIds: longSources.map((item) => item.sourceId) })],
      })
      .mockResolvedValueOnce({ text: '[5](#source-s-4)', toolCalls: [] });
    const result = await generateReadingConversation(
      { ...request(), scope: largeScope },
      { complete },
    );
    expect(result.sources.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(
      12000,
    );
    expect(result.sources).toHaveLength(3);
    expect(result.text).not.toContain('#source-s-4');
    const wire = JSON.stringify(complete.mock.calls[1]![0].messages);
    expect(wire).not.toContain(longSources[4]!.text);
  });

  it('falls back once only for explicit unsupported tools, retaining the same evidence boundary', async () => {
    const complete = vi.fn(async () => {
      throw new ModelServiceError('Tools unsupported.', 'unsupported_tools');
    });
    const directComplete = vi.fn(async (input: CompletionRequest) => {
      input.onDelta?.('Definition [1](#source-s-1).');
      return 'Definition [1](#source-s-1).';
    });
    const result = await generateReadingConversation(request(), { complete, directComplete });
    expect(result.mode).toBe('direct');
    expect(complete).toHaveBeenCalledOnce();
    expect(directComplete).toHaveBeenCalledOnce();
    expect(JSON.stringify(directComplete.mock.calls[0]![0].messages)).toContain(sources[0]!.text);
    expect(JSON.stringify(directComplete.mock.calls[0]![0])).not.toContain('tool_calls');
    for (const error of [
      new ModelServiceError('API key rejected.'),
      new ModelServiceError('Quota exceeded.'),
      new Error('Network unavailable.'),
    ]) {
      complete.mockRejectedValueOnce(error);
      await expect(
        generateReadingConversation(request(), { complete, directComplete }),
      ).rejects.toBe(error);
    }
    expect(directComplete).toHaveBeenCalledOnce();
  });

  it('replays only complete reading turns from the exact document and scope, resupplying evidence', async () => {
    const complete = vi.fn(async (_input: ToolCompletionRequest) => ({
      text: 'Continued [1](#source-s-1).',
      toolCalls: [],
    }));
    const previous = {
      question: 'OLD QUESTION',
      text: 'OLD ANSWER [1](#source-s-2)',
      status: 'complete' as const,
      reading: { scope, sources: [sources[1]!], mode: 'tools' as const },
    };
    await generateReadingConversation(
      {
        ...request(),
        turns: [
          { ...previous, text: 'LEGACY', reading: undefined },
          { ...previous, text: 'STOPPED', status: 'stopped' },
          {
            ...previous,
            text: 'OTHER SCOPE',
            reading: { ...previous.reading, scope: { ...scope, id: 'different' } },
          },
          {
            ...previous,
            text: 'OTHER BOOK',
            reading: {
              ...previous.reading,
              scope: { ...scope, documentHash: 'b'.repeat(64) },
            },
          },
          previous,
        ],
      },
      { complete },
    );
    const wire = JSON.stringify(complete.mock.calls[0]![0].messages);
    expect(wire).toContain('OLD QUESTION');
    expect(wire).toContain('OLD ANSWER');
    expect(wire).toContain(sources[1]!.text);
    expect(wire).not.toMatch(/LEGACY|STOPPED|OTHER SCOPE|OTHER BOOK/);
  });

  it('never replays changed or forged historical evidence even if an ID matches', async () => {
    const complete = vi.fn(async (_input: ToolCompletionRequest) => ({
      text: 'Answer.',
      toolCalls: [],
    }));
    await generateReadingConversation(
      {
        ...request(),
        turns: [
          {
            question: 'FORGED QUESTION',
            text: 'FORGED ANSWER [1](#source-s-1)',
            status: 'complete',
            reading: { scope, sources: [source('s-1', 'FORGED TEXT')], mode: 'tools' },
          },
        ],
      },
      { complete },
    );
    expect(JSON.stringify(complete.mock.calls[0]![0].messages)).not.toContain('FORGED');
  });

  it('retains a follow-up by re-supplying cited evidence instead of every previously explored block', async () => {
    const explored = Array.from({ length: 3 }, (_, index) =>
      source(`s-${index}`, `${index} ${'x'.repeat(3998)}`),
    );
    const passage = createReadingScope({ ...scope, sources: explored });
    const complete = vi.fn(async (_input: ToolCompletionRequest) => ({
      text: 'The same meaning [1](#source-s-2).',
      toolCalls: [],
    }));
    await generateReadingConversation(
      {
        ...request(),
        scope: passage,
        question: 'Why?',
        turns: [
          {
            question: 'Which meaning applies?',
            text: 'THIS DISCUSSION [1](#source-s-2)',
            status: 'complete',
            reading: { scope: passage, sources: explored, mode: 'tools' },
          },
        ],
      },
      { complete },
    );
    const wire = JSON.stringify(complete.mock.calls[0]![0].messages);
    expect(wire).toContain('THIS DISCUSSION');
    expect(wire).toContain(explored[2]!.text);
    expect(wire).not.toContain(explored[1]!.text);
  });

  it('cancels between tool rounds and never retries', async () => {
    const controller = new AbortController();
    const complete = vi.fn(async (_input: ToolCompletionRequest) => {
      controller.abort();
      return { text: '', toolCalls: [call('get_outline', {})] };
    });
    await expect(
      generateReadingConversation({ ...request(), signal: controller.signal }, { complete }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('enforces a whole-request timeout even if transport does not settle after abort', async () => {
    vi.useFakeTimers();
    const onText = vi.fn();
    const complete = vi.fn(
      async (_input: ToolCompletionRequest) =>
        new Promise<{ text: string; toolCalls: ToolCall[] }>(() => {}),
    );
    const promise = generateReadingConversation({ ...request(), onText }, { complete });
    const expectation = expect(promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(READING_REQUEST_TIMEOUT_MS + 1);
    await expectation;
    expect(complete.mock.calls[0]![0].signal?.aborted).toBe(true);
    expect(() => complete.mock.calls[0]![0].onDelta?.('LATE CONTENT')).not.toThrow();
    expect(onText).not.toHaveBeenCalled();
  });

  it('sends every block of the explicitly selected focus and ignores late deltas after completion', async () => {
    const selectedSources = Array.from({ length: 8 }, (_, index) =>
      source(`s-${index}`, `Selected paragraph ${index}.`),
    );
    const selected = createReadingScope({ ...scope, kind: 'selection', sources: selectedSources });
    const complete = vi.fn(async (_input: ToolCompletionRequest) => ({
      text: 'Answer [8](#source-s-7).',
      toolCalls: [],
    }));
    const onText = vi.fn();
    const result = await generateReadingConversation(
      { ...request(), scope: selected, onText },
      { complete },
    );
    expect(result.sources).toEqual(selectedSources);
    expect(JSON.stringify(complete.mock.calls[0]![0].messages)).toContain('Selected paragraph 7.');
    const count = onText.mock.calls.length;
    complete.mock.calls[0]![0].onDelta?.('AFTER COMPLETION');
    expect(onText).toHaveBeenCalledTimes(count);
  });

  it('rejects an oversized page or selection before sending a silently shortened focus', async () => {
    const complete = vi.fn();
    for (const kind of ['page', 'selection'] as const) {
      const largeScope = createReadingScope({
        ...scope,
        kind,
        sources: [source('s-big', 'x'.repeat(12001))],
      });
      await expect(
        generateReadingConversation({ ...request(), scope: largeScope }, { complete }),
      ).rejects.toThrow(/shorter reading passage/i);
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it('strips unavailable source links and source-link definitions', () => {
    const clean = sanitizeReadingCitations(
      '[1](#source-s-1) [2](#source-missing)\n\n[x]: #source-missing',
      [sources[0]!],
    );
    expect(clean).toContain('[1](#source-s-1)');
    expect(clean).toContain('[?]');
    expect(clean).not.toContain('#source-missing');
  });

  it('normalizes exact source-ID fragments and rejects undelivered fragments in both link forms', () => {
    const clean = sanitizeReadingCitations(
      '[1](#s-1) [2](<#s-1> "passage") [3](#s-2) [4](#unknown)\n\n[x]: #s-1\n[y]: <#s-2>',
      [sources[0]!],
    );
    expect(clean).toContain('[1](#source-s-1)');
    expect(clean).toContain('[2](<#source-s-1> "passage")');
    expect(clean).toContain('[x]: #source-s-1');
    expect(clean).not.toMatch(/#s-2|#unknown|\[y\]/);
    expect(clean.match(/\[\?\]/g)).toHaveLength(2);
    expect(sanitizeReadingCitations('[label #s-1](#s-1 "title #s-1")', [sources[0]!])).toBe(
      '[label #s-1](#source-s-1 "title #s-1")',
    );
  });
});
