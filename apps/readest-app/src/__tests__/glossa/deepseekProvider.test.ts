import { describe, expect, test, vi } from 'vitest';

import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL,
  DeepSeekProvider,
  collectProviderResponse,
  validateGlossaAnswer,
} from '@/glossa/ai';
import { createContextPack } from '@/glossa/context/contextPack';
import type { SourceSegment } from '@/glossa/context/types';

const segment = (text: string, cfi: string): SourceSegment => ({
  text,
  anchor: {
    version: 1,
    documentId: 'fixture-book',
    format: 'epub',
    sectionId: 'chapter-1.xhtml',
    cfi,
    quote: { exact: text },
  },
});

const contextPack = () => {
  const selected = segment('amber mark points to a passage', 'epubcfi(/6/2!/4/3:8)');
  return createContextPack({ selection: selected, selectionContext: [selected] });
};

const response = (events: string[]): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(new TextEncoder().encode(event));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );

const jsonAnswer = (sourceId = 'source_current') =>
  JSON.stringify({
    status: 'answered',
    paragraphs: [
      { text: 'The selected passage is evidence.', sourceIds: [sourceId], basis: 'document' },
    ],
    followups: [],
  });

describe('DeepSeekProvider', () => {
  test('uses the documented chat-completions request with bounded local evidence', async () => {
    const pack = contextPack();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response([
          ': keep-alive\n\n',
          `data: {"choices":[{"delta":{"content":${JSON.stringify(jsonAnswer(pack.segments[0]!.sourceId))}},"finish_reason":"stop"}]}\n\n`,
          'data: [DONE]\n\n',
        ]),
      );
    const provider = new DeepSeekProvider({ fetch, getApiKey: async () => 'test-only-key' });
    const result = await collectProviderResponse(provider, {
      question: 'What does this mean?',
      contextPack: pack,
      history: Array.from({ length: 4 }, (_, index) => ({
        documentId: 'fixture-book',
        contextPackId: pack.segments.map(({ sourceId }) => sourceId).join('|'),
        user: { role: 'user' as const, text: `older question ${index}` },
        assistant: {
          role: 'assistant' as const,
          text: `older answer ${index}`,
          answer: { status: 'insufficient_evidence' as const, paragraphs: [], followups: [] },
        },
      })),
    });

    expect(fetch).toHaveBeenCalledWith(`${DEEPSEEK_BASE_URL}/chat/completions`, expect.any(Object));
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-only-key' });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: DEEPSEEK_MODEL,
      stream: true,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    });
    expect(body.tools).toBeUndefined();
    expect(body.messages).toHaveLength(8); // system + three full history turns + current request
    expect(body.messages.at(-1).content).toContain(pack.segments[0]!.sourceId);
    expect(body.messages.at(-1).content).toContain('amber mark points to a passage');
    expect(body.messages[0].content).toContain('JSON');
    expect(result.text).toBe('');
    expect(validateGlossaAnswer(result.answer, pack)).toMatchObject({ ok: true });
  });

  test('does not display raw JSON deltas while it waits for the validated final answer', async () => {
    const provider = new DeepSeekProvider({
      getApiKey: async () => 'test-only-key',
      fetch: vi
        .fn()
        .mockResolvedValue(
          response([
            `data: ${JSON.stringify({ choices: [{ delta: { content: '{"status":"answered",' }, finish_reason: null }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: '"paragraphs":[{"text":"The selected passage is evidence.","sourceIds":["source_current"],"basis":"document"}],"followups":[]}' }, finish_reason: 'stop' }] })}\n\n`,
            'data: [DONE]\n\n',
          ]),
        ),
    });
    const result = await collectProviderResponse(provider, {
      action: 'explain',
      contextPack: contextPack(),
    });
    expect(result.events.map(({ type }) => type)).toEqual(['complete']);
  });

  test.each([
    [401, 'invalid-auth'],
    [402, 'insufficient-balance'],
    [400, 'invalid-request'],
    [422, 'invalid-request'],
    [429, 'rate-limited'],
    [500, 'server-error'],
    [503, 'overloaded'],
  ] as const)('maps HTTP %s to %s without exposing the response body', async (status, code) => {
    const provider = new DeepSeekProvider({
      getApiKey: async () => 'test-only-key',
      fetch: vi.fn().mockResolvedValue(new Response('sensitive server body', { status })),
    });
    const result = await collectProviderResponse(provider, {
      action: 'explain',
      contextPack: contextPack(),
    });
    expect(result.error).toMatchObject({ code });
    expect(result.error?.message).not.toContain('sensitive');
  });

  test('rejects empty JSON, malformed chunks, interrupted streams, and length truncation', async () => {
    const cases = [
      response(['data: [DONE]\n\n']),
      response(['data: not-json\n\n', 'data: [DONE]\n\n']),
      response([`data: {"choices":[{"delta":{"content":"{}"},"finish_reason":null}]}\n\n`]),
      response([
        `data: {"choices":[{"delta":{"content":${JSON.stringify(jsonAnswer())}},"finish_reason":"length"}]}\n\n`,
        'data: [DONE]\n\n',
      ]),
    ];
    for (const stream of cases) {
      const provider = new DeepSeekProvider({
        getApiKey: async () => 'test-only-key',
        fetch: vi.fn().mockResolvedValue(stream),
      });
      const result = await collectProviderResponse(provider, {
        action: 'explain',
        contextPack: contextPack(),
      });
      expect(result.error).toMatchObject({ code: 'invalid-response' });
    }
  });

  test('keeps source ID validation local, including unknown and duplicate IDs', async () => {
    for (const answer of [
      jsonAnswer('unknown-source'),
      JSON.stringify({
        status: 'answered',
        paragraphs: [
          { text: 'Duplicate', sourceIds: ['source_current', 'source_current'], basis: 'document' },
        ],
        followups: [],
      }),
    ]) {
      const pack = contextPack();
      const provider = new DeepSeekProvider({
        getApiKey: async () => 'test-only-key',
        fetch: vi
          .fn()
          .mockResolvedValue(
            response([
              `data: {"choices":[{"delta":{"content":${JSON.stringify(answer)}},"finish_reason":"stop"}]}\n\n`,
              'data: [DONE]\n\n',
            ]),
          ),
      });
      const result = await collectProviderResponse(provider, {
        action: 'explain',
        contextPack: pack,
      });
      expect(validateGlossaAnswer(result.answer, pack).ok).toBe(false);
    }
  });

  test('leaves external markings for the local ContextPack validator and maps an expired timeout', async () => {
    const pack = contextPack();
    const external = JSON.stringify({
      status: 'answered',
      paragraphs: [
        { text: 'Outside claim', sourceIds: [pack.segments[0]!.sourceId], basis: 'external' },
      ],
      followups: [],
    });
    const externalProvider = new DeepSeekProvider({
      getApiKey: async () => 'test-only-key',
      fetch: vi
        .fn()
        .mockResolvedValue(
          response([
            `data: ${JSON.stringify({ choices: [{ delta: { content: external }, finish_reason: 'stop' }] })}\n\n`,
            'data: [DONE]\n\n',
          ]),
        ),
    });
    const externalResult = await collectProviderResponse(externalProvider, {
      action: 'explain',
      contextPack: pack,
    });
    expect(externalResult).toMatchObject({ answer: expect.any(Object) });
    expect(validateGlossaAnswer(externalResult.answer, pack)).toMatchObject({
      ok: false,
      reason: 'external-basis',
    });

    const timeoutProvider = new DeepSeekProvider({
      getApiKey: async () => 'test-only-key',
      timeoutMs: 1,
      fetch: vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('timeout', 'AbortError')),
            ),
          ),
      ) as unknown as typeof fetch,
    });
    await expect(
      collectProviderResponse(timeoutProvider, { action: 'explain', contextPack: pack }),
    ).resolves.toMatchObject({
      error: { code: 'timeout' },
    });
  });

  test('aborts the underlying HTTP request', async () => {
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        ),
    ) as unknown as typeof globalThis.fetch;
    const provider = new DeepSeekProvider({ fetch, getApiKey: async () => 'test-only-key' });
    const controller = new AbortController();
    const pending = collectProviderResponse(
      provider,
      { action: 'explain', contextPack: contextPack() },
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
  });
});
