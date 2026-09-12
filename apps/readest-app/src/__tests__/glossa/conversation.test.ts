import { describe, expect, it, vi } from 'vitest';
import type { ChapterSource } from '@/glossa/context/types';
import { parseConversation, readStreamingBlocks } from '@/glossa/conversation/schema';
import { fitConversationEvidence } from '@/glossa/conversation/context';
import { selectScopeEvidence } from '@/glossa/context/conversationScope';
import { validateHistory } from '@/glossa/conversation/store';
import { generateConversation, summarizeConversation } from '@/glossa/conversation/generate';

const source: ChapterSource = {
  sourceId: 's1',
  text: 'An example depends on its conditions.',
  kind: 'paragraph',
  anchor: {
    sectionIndex: 0,
    cfi: 'epubcfi(/6/2!/4/2)',
    quote: { exact: 'An example depends on its conditions.', prefix: '', suffix: '' },
  },
};
const block = {
  kind: 'source' as const,
  text: 'The conditions limit the example.',
  sourceIds: ['s1'],
};
const raw = JSON.stringify({ blocks: [block] });
const config = {
  id: 'fixture',
  name: 'Fixture',
  baseUrl: 'http://localhost:1234/v1',
  model: 'fixture',
};
const turn = {
  id: 't1',
  question: 'What does this mean?',
  blocks: [block],
  sources: [source],
  createdAt: 1,
  provider: config,
  promptVersion: 'conversation-1' as const,
};

describe('conversation evidence and streaming', () => {
  it('rejects unknown sources, unsourced claims and malformed output', () => {
    expect(parseConversation(raw, [source])).toEqual([block]);
    for (const bad of [
      { ...block, sourceIds: ['invented'] },
      { ...block, sourceIds: [] },
      { ...block, kind: 'inference', sourceIds: [] },
      { ...block, cfi: 'invented' },
    ])
      expect(() => parseConversation(JSON.stringify({ blocks: [bad] }), [source])).toThrow();
    expect(() => parseConversation(raw.slice(0, -1), [source])).toThrow();
  });
  it('allows explicit background and insufficient evidence without pretending to cite a book', () => {
    for (const kind of ['background', 'insufficient']) {
      expect(
        parseConversation(
          JSON.stringify({ blocks: [{ kind, text: 'No book evidence.', sourceIds: [] }] }),
          [],
        ),
      ).toHaveLength(1);
    }
  });
  it('streams only complete validated blocks across every byte boundary including escaped braces', () => {
    const escaped = { ...block, text: 'A brace "}" and a newline\nare text.' };
    const full = JSON.stringify({ blocks: [escaped, block] });
    for (let end = 0; end <= full.length; end++) {
      const blocks = readStreamingBlocks(full.slice(0, end), [source]);
      expect(blocks.every((b) => b.text === escaped.text || b.text === block.text)).toBe(true);
    }
    expect(readStreamingBlocks(full, [source])).toEqual([escaped, block]);
    expect(readStreamingBlocks(full, [])).toEqual([]);
  });
  it('keeps history bounded and excludes other books, removed context and old model output', () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      ...turn,
      id: String(i),
      question: 'q'.repeat(2000),
    }));
    expect(JSON.stringify(summarizeConversation(history, [source], config)).length).toBeLessThan(
      4000,
    );
    expect(summarizeConversation(history, [], config)).toEqual([]);
    expect(summarizeConversation(history, [source], { ...config, model: 'new-model' })).toEqual([]);
    expect(
      summarizeConversation(
        [
          {
            ...turn,
            sources: [
              {
                ...source,
                text: 'OTHER_BOOK',
                anchor: {
                  ...source.anchor,
                  quote: { ...source.anchor.quote, exact: 'OTHER_BOOK' },
                },
              },
            ],
          },
        ],
        [source],
        config,
      ),
    ).toEqual([]);
  });
  it('sends a bounded snapshot through the provider and never sends anchors or a full transcript', async () => {
    const complete = vi.fn().mockImplementation(async (request) => {
      request.onDelta(raw);
      return raw;
    });
    const onBlocks = vi.fn();
    const blocks = await generateConversation(
      {
        bookId: 'book-1',
        bookTitle: 'Fixture book',
        question: 'Explain this',
        sources: [source],
        turns: [turn],
        config,
        signal: new AbortController().signal,
        onBlocks,
      },
      { complete },
    );
    expect(blocks).toEqual([block]);
    expect(onBlocks).toHaveBeenCalledWith([block]);
    const payload = JSON.parse(complete.mock.calls[0]![0].messages[1].content);
    expect(payload.sources).toEqual([{ sourceId: 's1', text: source.text }]);
    expect(JSON.stringify(payload)).not.toContain('epubcfi');
    expect(payload.history).toHaveLength(1);
  });
  it('does not issue a request after cancellation or with an oversized question/context', async () => {
    const complete = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const input = {
      bookId: 'b',
      bookTitle: 'B',
      question: 'why',
      sources: [source],
      turns: [],
      config,
      signal: controller.signal,
    };
    await expect(generateConversation(input, { complete })).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(
      generateConversation(
        { ...input, signal: new AbortController().signal, question: 'x'.repeat(2001) },
        { complete },
      ),
    ).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
});

it('always includes reading identity even without book text and respects the chosen budget', async () => {
  const complete = vi.fn().mockResolvedValue(
    JSON.stringify({
      blocks: [{ kind: 'background', text: 'A general explanation.', sourceIds: [] }],
    }),
  );
  const metadata = {
    bookTitle: 'Fixture',
    author: 'Author',
    chapterTitle: 'Chapter two',
    progress: 0.42,
  };
  await generateConversation(
    {
      bookId: 'b',
      bookTitle: 'Fixture',
      metadata,
      budget: 2000,
      includeHistory: false,
      question: 'Why?',
      sources: [],
      turns: [turn],
      config,
      signal: new AbortController().signal,
    },
    { complete },
  );
  const payload = JSON.parse(complete.mock.calls[0]![0].messages[1].content);
  expect(payload.metadata).toEqual(metadata);
  expect(payload.history).toEqual([]);
  const text = 'x'.repeat(2001);
  await expect(
    generateConversation(
      {
        bookId: 'b',
        bookTitle: 'Fixture',
        metadata,
        budget: 2000,
        question: 'Why?',
        sources: [
          {
            ...source,
            text,
            anchor: { ...source.anchor, quote: { ...source.anchor.quote, exact: text } },
          },
        ],
        turns: [],
        config,
        signal: new AbortController().signal,
      },
      { complete },
    ),
  ).rejects.toThrow();
  expect(complete).toHaveBeenCalledTimes(1);
});

it('fits complete blocks and preserves relevant evidence under the lightweight budget', () => {
  const short = { ...source, sourceId: 'short', text: 'A specific keyword: photosynthesis.' };
  const long = { ...source, sourceId: 'long', text: 'x'.repeat(2001) };
  expect(fitConversationEvidence([long, short], 2000)).toEqual([short]);
  expect(fitConversationEvidence([source, short], 2000, ['s1'])).toEqual([short]);
  expect(selectScopeEvidence([long, short], 'photosynthesis', false, 2000)).toEqual([short]);
  expect(source.anchor.quote.exact).toBe(source.text);
});
it('loads older conversation records and rejects receipts containing removed evidence', () => {
  const history = {
    version: 1,
    bookId: 'b',
    sessions: [{ id: 'a', turns: [turn] }],
    activeId: 'a',
  };
  expect(validateHistory(history).sessions[0]!.turns[0]!.promptVersion).toBe('conversation-1');
  const context = {
    metadata: { bookTitle: 'B', author: '', chapterTitle: '', progress: null },
    budget: 2000,
    scope: 'page',
    title: '',
    sampled: false,
    history: [{ question: 'q', summary: 's', sourceIds: ['removed'] }],
  };
  expect(() =>
    validateHistory({ ...history, sessions: [{ id: 'a', turns: [{ ...turn, context }] }] }),
  ).toThrow();
});
