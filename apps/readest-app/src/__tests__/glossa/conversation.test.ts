import { describe, expect, it } from 'vitest';
import type { ChapterSource } from '@/glossa/context/types';
import { parseConversation, readStreamingBlocks } from '@/glossa/conversation/schema';
import { validateHistory } from '@/glossa/conversation/store';

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
