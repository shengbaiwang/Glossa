import { expect, it, vi } from 'vitest';
import { generateConversation } from '@/glossa/conversation/generate';
import type { CompletionRequest } from '@/glossa/ai/provider';
const config = {
  id: 'fixture',
  name: 'Fixture',
  baseUrl: 'http://localhost:1234/v1',
  model: 'fixture',
};
it('sends no system instructions by default and prepends a saved custom prompt when selected', async () => {
  const complete = vi.fn(async (_request: CompletionRequest) => 'OK');
  const input = {
    metadata: { bookTitle: '', author: '', chapterTitle: '' },
    question: 'What does this concept mean?',
    turns: [],
    config,
    signal: new AbortController().signal,
  };
  await generateConversation(input, { complete });
  const plain = complete.mock.calls[0]![0].messages;
  expect(plain.some((message) => message.role === 'system')).toBe(false);
  expect(plain[0]).toEqual({
    role: 'user',
    content: JSON.stringify({ bookTitle: '', author: '', chapterTitle: '' }),
  });
  await generateConversation({ ...input, prompt: 'Answer in one sentence.' }, { complete });
  const withPrompt = complete.mock.calls[1]![0].messages;
  expect(withPrompt[0]).toEqual({ role: 'system', content: 'Answer in one sentence.' });
  expect(JSON.parse(withPrompt[1]!.content)).toEqual({
    bookTitle: '',
    author: '',
    chapterTitle: '',
  });
  await expect(
    generateConversation({ ...input, prompt: ` ${'x'.repeat(8001)} ` }, { complete }),
  ).rejects.toThrow();
});
it('sends only reading identity and normal messages, and streams plain Markdown', async () => {
  const complete = vi.fn(async (r: CompletionRequest) => {
    r.onDelta?.('**Hello**');
    return '**Hello**';
  });
  const onText = vi.fn();
  const result = await generateConversation(
    {
      metadata: { bookTitle: 'Book', author: 'Author', chapterTitle: 'Section' },
      question: 'Hello',
      turns: [],
      config,
      signal: new AbortController().signal,
      onText,
    },
    { complete },
  );
  expect(result).toBe('**Hello**');
  expect(onText).toHaveBeenCalledWith('**Hello**');
  const messages = complete.mock.calls[0]![0].messages;
  expect(JSON.parse(messages[0]!.content)).toEqual({
    bookTitle: 'Book',
    author: 'Author',
    chapterTitle: 'Section',
  });
  expect(messages.at(-1)).toEqual({ role: 'user', content: 'Hello' });
  expect(JSON.stringify(messages)).not.toMatch(/sourceId|epubcfi|"progress"|"budget"/);
});

import { conversationMessages } from '@/glossa/conversation/generate';
import { validateHistory } from '@/glossa/conversation/store';
import { type ConversationTurn, CONVERSATION_PROMPT_VERSION } from '@/glossa/conversation/schema';
const metadata = { bookTitle: 'Book', author: 'Author', chapterTitle: 'Section' };
const chatTurn = (id = 'turn'): ConversationTurn => ({
  id,
  question: 'What is the idea?',
  blocks: [{ kind: 'background', text: 'Here is the idea.', sourceIds: [] }],
  sources: [],
  createdAt: 1,
  provider: config,
  promptVersion: CONVERSATION_PROMPT_VERSION,
  metadata,
  status: 'complete',
});
it('carries complete exchanges across models while excluding legacy material and unfinished replies', () => {
  const legacy = {
    ...chatTurn(),
    promptVersion: 'conversation-2',
    blocks: [{ kind: 'background', text: 'LEGACY_MATERIAL', sourceIds: [] }],
  } as ConversationTurn;
  const stopped = { ...chatTurn(), status: 'stopped' } as ConversationTurn;
  const messages = conversationMessages([
    legacy,
    chatTurn(),
    stopped,
    { ...chatTurn(), provider: { ...config, model: 'other' } },
  ]);
  expect(messages).toHaveLength(4);
  expect(JSON.stringify(messages)).not.toContain('LEGACY_MATERIAL');
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
});
it('bounds history by complete exchanges and total characters without truncating messages', () => {
  expect(
    conversationMessages(Array.from({ length: 40 }, (_, i) => chatTurn(String(i)))),
  ).toHaveLength(24);
  const large = {
    ...chatTurn(),
    blocks: [{ kind: 'background', text: 'x'.repeat(30000), sourceIds: [] }],
  } as ConversationTurn;
  expect(conversationMessages([large, large])).toHaveLength(2);
});
it('ignores extra metadata fields from a stale caller and handles unknown identity', async () => {
  const complete = vi.fn(async () => 'OK');
  await generateConversation(
    {
      metadata: { ...metadata, author: '', chapterTitle: '', sources: ['SECRET'], progress: 0.4 },
      question: 'Hi',
      turns: [],
      config,
      signal: new AbortController().signal,
    } as Parameters<typeof generateConversation>[0],
    { complete },
  );
  const request = complete.mock.calls[0] as unknown as [CompletionRequest];
  expect(JSON.parse(request[0].messages[0]!.content)).toEqual({
    bookTitle: 'Book',
    author: '',
    chapterTitle: '',
  });
});
it('rejects cancelled, empty and oversized requests before transport', async () => {
  const complete = vi.fn();
  const controller = new AbortController();
  controller.abort();
  const input = { metadata, question: 'Hi', turns: [], config, signal: controller.signal };
  await expect(generateConversation(input, { complete })).rejects.toMatchObject({
    name: 'AbortError',
  });
  for (const question of ['', 'x'.repeat(2001)])
    await expect(
      generateConversation(
        { ...input, question, signal: new AbortController().signal },
        { complete },
      ),
    ).rejects.toThrow();
  expect(complete).not.toHaveBeenCalled();
});
it('validates plain chat storage and rejects attached materials, injected credentials and excessive replies', () => {
  const history = {
    version: 1,
    bookId: 'b',
    activeId: 'a',
    sessions: [{ id: 'a', turns: [chatTurn()] }],
  };
  expect(validateHistory(history).sessions[0]!.turns).toHaveLength(1);
  for (const turn of [
    { ...chatTurn(), sources: [{ text: 'SECRET' }] },
    { ...chatTurn(), provider: { ...config, apiKey: 'SECRET' } },
    { ...chatTurn(), blocks: [{ kind: 'background', text: 'x'.repeat(32001), sourceIds: [] }] },
  ])
    expect(() => validateHistory({ ...history, sessions: [{ id: 'a', turns: [turn] }] })).toThrow();
});
