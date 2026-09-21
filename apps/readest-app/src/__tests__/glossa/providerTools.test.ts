import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.fetch }));
vi.mock('@/utils/bridge', () => ({
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
}));

import {
  streamToolCompletion,
  type ToolCall,
  type ToolDefinition,
  type ToolCompletionMessage,
} from '@/glossa/ai/provider';

const config = {
  id: 'tool-test',
  name: 'Synthetic tool service',
  baseUrl: 'https://models.example/v1',
  model: 'reader-model',
};
const messages: ToolCompletionMessage[] = [{ role: 'user', content: 'Find the definition.' }];
const tools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_book',
      description: 'Search the allowed reading range.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
];
const call: ToolCall = {
  id: 'call_1',
  type: 'function',
  function: { name: 'search_book', arguments: '{"query":"自由"}' },
};
const request = { config, messages, tools };

function event(delta: unknown, finishReason?: string) {
  return `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason ?? null }] })}\n\n`;
}

function sse(parts: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

beforeEach(() => {
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('bounded tool completion transport', () => {
  it('accumulates split argument deltas without exposing arguments as text', async () => {
    const middle = event({
      tool_calls: [{ index: 0, id: null, type: null, function: { name: null, arguments: '自由' } }],
    });
    mocks.fetch.mockResolvedValue(
      sse([
        event({
          content: 'Checking.',
          tool_calls: [
            { index: 0, ...call, function: { name: 'search_book', arguments: '{"query":"' } },
          ],
        }),
        middle.slice(0, 15),
        middle.slice(15),
        event({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] }, 'tool_calls'),
      ]),
    );
    const onDelta = vi.fn();
    await expect(streamToolCompletion({ ...request, onDelta })).resolves.toEqual({
      text: 'Checking.',
      toolCalls: [call],
    });
    expect(onDelta.mock.calls).toEqual([['Checking.']]);
    const body = JSON.parse(mocks.fetch.mock.calls[0]![1].body);
    expect(body).toMatchObject({
      model: config.model,
      messages,
      tools,
      tool_choice: 'auto',
      stream: true,
    });
  });

  it('keeps interleaved tool calls in index order', async () => {
    const second = { ...call, id: 'call_2', function: { ...call.function, arguments: '{}' } };
    mocks.fetch.mockResolvedValue(
      sse([
        event({
          tool_calls: [
            { index: 1, ...second },
            { index: 0, ...call },
          ],
        }),
        event({}, 'tool_calls'),
      ]),
    );
    await expect(streamToolCompletion(request)).resolves.toEqual({
      text: '',
      toolCalls: [call, second],
    });
  });

  it('accepts non-streaming responses and sends correlated tool result messages', async () => {
    const followup: ToolCompletionMessage[] = [
      ...messages,
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: call.id, content: '{"matches":[]}' },
    ];
    mocks.fetch.mockResolvedValue(
      Response.json({ choices: [{ message: { content: 'No evidence.' }, finish_reason: 'stop' }] }),
    );
    await expect(
      streamToolCompletion({ ...request, messages: followup, toolChoice: 'none' }),
    ).resolves.toEqual({ text: 'No evidence.', toolCalls: [] });
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body)).toMatchObject({
      messages: followup,
      tool_choice: 'none',
    });
    mocks.fetch.mockResolvedValue(
      Response.json({
        choices: [{ message: { content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }],
      }),
    );
    await expect(streamToolCompletion(request)).resolves.toEqual({ text: '', toolCalls: [call] });
  });

  it.each([
    [{ ...call, function: { ...call.function, name: 'read_any_file' } }],
    [{ ...call, function: { ...call.function, arguments: '{' } }],
    [{ ...call, function: { ...call.function, arguments: '[]' } }],
    [{ ...call, function: { ...call.function, arguments: 'null' } }],
    [
      {
        ...call,
        function: { ...call.function, arguments: JSON.stringify({ query: 'x'.repeat(8192) }) },
      },
    ],
    [{ ...call, id: '' }],
    [call, { ...call }],
    Array.from({ length: 9 }, (_, index) => ({ ...call, id: `call_${index}` })),
  ])('rejects malformed, unknown, duplicate or excessive tool calls', async (...toolCalls) => {
    mocks.fetch.mockResolvedValue(
      Response.json({
        choices: [
          { message: { content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' },
        ],
      }),
    );
    await expect(streamToolCompletion(request)).rejects.toMatchObject({
      name: 'ModelServiceError',
      code: 'service',
    });
  });

  it('rejects calls when the caller requires a final answer', async () => {
    mocks.fetch.mockResolvedValue(
      sse([event({ tool_calls: [{ index: 0, ...call }] }, 'tool_calls')]),
    );
    await expect(streamToolCompletion({ ...request, toolChoice: 'none' })).rejects.toThrow();
  });

  it('rejects argument overflow while streaming and releases the reader immediately', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                event({ tool_calls: [{ index: 0, ...call }] }) +
                  event({ tool_calls: [{ index: 0, function: { arguments: 'x'.repeat(8192) } }] }),
              ),
            );
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    await expect(streamToolCompletion(request)).rejects.toMatchObject({ code: 'service' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('preserves the output-limit error without accepting a partial tool call', async () => {
    mocks.fetch.mockResolvedValue(sse([event({ tool_calls: [{ index: 0, ...call }] }, 'length')]));
    await expect(streamToolCompletion(request)).rejects.toMatchObject({ code: 'length' });
  });

  it.each([
    [event({ tool_calls: [{ index: 0, ...call }] })],
    [
      event({
        tool_calls: [{ index: 0, ...call, function: { name: 'search_book', arguments: '{' } }],
      }),
      'data: [DONE]\n\n',
    ],
    [event({ tool_calls: [{ index: -1, ...call }] }, 'tool_calls')],
    [
      event({ tool_calls: [{ index: 0, ...call }] }),
      event({ tool_calls: [{ index: 0, id: 'different' }] }, 'tool_calls'),
    ],
  ])('never returns an unfinished or corrupt tool call', async (...parts) => {
    mocks.fetch.mockResolvedValue(sse(parts));
    await expect(streamToolCompletion(request)).rejects.toThrow();
  });

  it('ignores post-terminal tool calls and releases a connection that stays open', async () => {
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                event({ tool_calls: [{ index: 0, ...call }] }, 'tool_calls') +
                  event({ tool_calls: [{ index: 1, ...call }] }),
              ),
            );
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    await expect(streamToolCompletion(request)).resolves.toEqual({ text: '', toolCalls: [call] });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a pending tool stream without returning partial calls', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(
              new TextEncoder().encode(
                event({ content: 'Checking.', tool_calls: [{ index: 0, ...call }] }),
              ),
            );
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    await expect(
      streamToolCompletion({
        ...request,
        signal: controller.signal,
        onDelta: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not dispatch a cancelled tool request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamToolCompletion({ ...request, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['Tools are not supported by this model.', 400],
    ["Unknown parameter: 'tool_choice'.", 422],
    ['This endpoint does not support function calling.', 400],
  ])('classifies only explicit tool capability rejection: %s', async (message, status) => {
    mocks.fetch.mockResolvedValue(
      Response.json({ error: { message: `${message} synthetic-private-text` } }, { status }),
    );
    await expect(streamToolCompletion(request)).rejects.toMatchObject({
      code: 'unsupported_tools',
      message: 'This model service does not support reading tools.',
    });
  });

  it.each([
    ['Invalid JSON schema for tool search_book.', 400],
    ['The tools request exceeds the context length.', 400],
    ['Tools are not supported by this model.', 500],
    ['Unauthorized tools request.', 401],
  ])('does not conceal other service errors with a tool fallback: %s', async (message, status) => {
    mocks.fetch.mockResolvedValue(Response.json({ error: { message } }, { status }));
    await expect(streamToolCompletion(request)).rejects.toMatchObject({ code: 'service' });
  });

  it('rejects invalid outgoing tool transcripts before network access', async () => {
    await expect(
      streamToolCompletion({
        ...request,
        messages: [...messages, { role: 'tool', tool_call_id: 'unknown', content: '{}' }],
      }),
    ).rejects.toThrow();
    await expect(
      streamToolCompletion({ ...request, tools: [tools[0]!, tools[0]!] }),
    ).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('accepts a service reusing a call ID after its previous call has been answered', async () => {
    mocks.fetch.mockResolvedValue(sse([event({ content: 'Complete.' }, 'stop')]));
    const batch: ToolCompletionMessage[] = [
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: call.id, content: '{}' },
    ];
    await expect(
      streamToolCompletion({ ...request, messages: [...messages, ...batch, ...batch] }),
    ).resolves.toEqual({ text: 'Complete.', toolCalls: [] });
  });

  it('runs the reading engine through real transport validation and correlated tool results', async () => {
    const { generateReadingConversation } = await import('@/glossa/harness/generate');
    const { createReadingScope } = await import('@/glossa/harness/scope');
    const text = 'Freedom means acting with an understanding of necessity.';
    const scope = createReadingScope({
      documentHash: 'synthetic-book-hash',
      kind: 'passage',
      title: 'Definitions',
      sources: [
        {
          sourceId: 's-1',
          text,
          kind: 'paragraph',
          anchor: {
            sectionIndex: 0,
            cfi: 'epubcfi(/6/2!/4/2)',
            quote: { exact: text, prefix: '', suffix: '' },
          },
        },
      ],
    });
    const outlineCall: ToolCall = {
      id: 'outline-1',
      type: 'function',
      function: { name: 'get_outline', arguments: '{}' },
    };
    mocks.fetch
      .mockResolvedValueOnce(
        sse([event({ tool_calls: [{ index: 0, ...outlineCall }] }, 'tool_calls')]),
      )
      .mockResolvedValueOnce(sse([event({ content: 'Definition [1](#source-s-1).' }, 'stop')]));
    const result = await generateReadingConversation({
      metadata: { bookTitle: 'Synthetic book', author: 'Author', chapterTitle: '' },
      scope,
      question: 'What does freedom mean here?',
      turns: [],
      config,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ text: 'Definition [1](#source-s-1).', mode: 'tools' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const followup = JSON.parse(mocks.fetch.mock.calls[1]![1].body);
    expect(followup.messages.slice(-2)).toEqual([
      { role: 'assistant', content: null, tool_calls: [outlineCall] },
      { role: 'tool', tool_call_id: 'outline-1', content: expect.any(String) },
    ]);
    expect(followup.messages.at(-1).content).toContain('s-1');
  });
});
