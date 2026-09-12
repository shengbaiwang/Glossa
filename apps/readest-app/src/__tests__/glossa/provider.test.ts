import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: false,
  fetch: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => mocks.native }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.fetch }));
vi.mock('@/utils/bridge', () => ({
  getSecureItem: mocks.get,
  setSecureItem: mocks.set,
  clearSecureItem: mocks.clear,
}));

import {
  getActiveProviderConfig,
  getProviderStatus,
  getSavedProviderConfigs,
  listProviderModels,
  normalizeBaseUrl,
  providerIdentity,
  saveProviderConfig,
  streamCompletion,
  validateProviderConfig,
  type ProviderConfig,
} from '@/glossa/ai/provider';

const config: ProviderConfig = {
  id: 'custom',
  name: 'Local test',
  baseUrl: 'https://models.example/v1',
  model: 'reader-model',
};
const messages = [{ role: 'user' as const, content: 'A synthetic paragraph.' }];

function sse(parts: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.native = false;
  mocks.fetch.mockReset();
  mocks.get.mockReset().mockResolvedValue({});
  mocks.set.mockReset().mockResolvedValue({ success: true });
  mocks.clear.mockReset().mockResolvedValue({ success: true });
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('reading model configuration', () => {
  it('preserves every saved service when the list grows past thirty entries', async () => {
    for (let index = 0; index < 31; index++) {
      await saveProviderConfig({ ...config, id: `custom-${index}` });
    }
    expect(getSavedProviderConfigs()).toHaveLength(31);
    expect(getActiveProviderConfig()?.id).toBe('custom-30');
  });

  it('normalizes a full completion endpoint and rejects credentials and insecure remote endpoints', () => {
    expect(normalizeBaseUrl(' https://models.example/v1/chat/completions/ ')).toBe(config.baseUrl);
    expect(normalizeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    for (const url of [
      'http://models.example/v1',
      'https://key:secret@models.example/v1',
      'https://models.example/v1?key=secret',
      'file:///tmp/key',
    ]) {
      expect(() => normalizeBaseUrl(url)).toThrow();
    }
  });

  it('persists only selected nonsecret fields and keeps web keys out of localStorage', async () => {
    await saveProviderConfig(
      { ...config, apiKey: 'synthetic-secret' } as ProviderConfig,
      'synthetic-secret',
    );
    expect(getActiveProviderConfig()).toEqual(config);
    expect(JSON.stringify(localStorage)).not.toContain('synthetic-secret');
    expect(await getProviderStatus()).toMatchObject({ configured: true, storage: 'session' });
  });

  it('binds native keys to the endpoint so changing hosts cannot reuse a secret', async () => {
    mocks.native = true;
    await saveProviderConfig(config, 'synthetic-secret');
    const key = mocks.set.mock.calls[0]![0].key;
    await getProviderStatus({ ...config, baseUrl: 'https://other.example/v1' });
    expect(mocks.get.mock.calls[0]![0].key).not.toBe(key);
  });

  it('does not replace saved settings when secure storage fails or echo its error', async () => {
    mocks.native = true;
    mocks.set.mockRejectedValue(new Error('synthetic-secret in internal failure'));
    await expect(saveProviderConfig(config, 'synthetic-secret')).rejects.toThrow(
      'Unable to save the API key securely.',
    );
    expect(getActiveProviderConfig()).toBeNull();
  });
});

describe('OpenAI-compatible transport', () => {
  it('streams split SSE events, ignores reasoning text, and uses an authenticated redirect-free request', async () => {
    await saveProviderConfig(config, 'synthetic-secret');
    mocks.fetch.mockResolvedValue(
      sse([
        'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\r\n\r\n',
        'data: {"choices":[{"delta":{"content":"First"}}]}\n',
        '\ndata: {"choices":[{"delta":{"content":" second"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ]),
    );
    const onDelta = vi.fn();
    expect(await streamCompletion({ messages, onDelta })).toBe('First second');
    expect(onDelta.mock.calls).toEqual([['First'], [' second']]);
    const [url, request] = mocks.fetch.mock.calls[0]!;
    expect(url).toBe('https://models.example/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer synthetic-secret');
    expect(request.redirect).toBe('error');
    expect(request.credentials).toBe('omit');
  });

  it('validates model lists and removes duplicate IDs', async () => {
    await saveProviderConfig(config, 'synthetic-secret');
    mocks.fetch.mockResolvedValue(
      Response.json({ data: [{ id: 'a' }, { id: 4 }, { id: 'a' }, { id: 'b' }] }),
    );
    expect(await listProviderModels(config)).toEqual(['a', 'b']);
  });

  it('does not expose server bodies or network errors', async () => {
    await saveProviderConfig(config, 'synthetic-secret');
    mocks.fetch.mockResolvedValue(
      new Response('synthetic-secret and document text', { status: 401 }),
    );
    await expect(streamCompletion({ messages })).rejects.toThrow(
      'The API key was rejected. Check the key and service address.',
    );
    mocks.fetch.mockRejectedValue(new Error('synthetic-secret and document text'));
    await expect(streamCompletion({ messages })).rejects.toThrow(
      'Could not connect to the model service. Check the address and network.',
    );
  });

  it('rejects truncated output instead of treating it as complete notes', async () => {
    await saveProviderConfig(config, 'synthetic-secret');
    mocks.fetch.mockResolvedValue(
      sse([
        'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
      ]),
    );
    await expect(streamCompletion({ messages })).rejects.toThrow(
      'The model response was cut short. Try a smaller chapter or another model.',
    );
  });

  it.each([
    ['data: [DO', 'NE]\n\n'],
    ['data: {"choices":[],"usage":', '{"total_tokens":5}}\n\ndata: [DONE]\n\n'],
  ])('accepts a completed response when the following event is split at %s', async (tail, rest) => {
    const onDelta = vi.fn();
    mocks.fetch.mockResolvedValue(
      sse([
        'data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\n' + tail,
        rest,
      ]),
    );
    expect(await streamCompletion({ config, messages, onDelta })).toBe('complete');
    expect(onDelta.mock.calls).toEqual([['complete']]);
  });

  it.each(['stop', 'done'])('does not parse or deliver events after %s', async (terminal) => {
    const onDelta = vi.fn();
    const completion =
      terminal === 'stop'
        ? 'data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\n'
        : 'data: {"choices":[{"delta":{"content":"complete"}}]}\n\ndata: [DONE]\n\n';
    mocks.fetch.mockResolvedValue(
      sse([
        completion +
          'data: {"choices":[{"delta":{"content":"post-terminal garbage"}}]}\n\ndata: {"error":{"message":"post-terminal error"}}\n\n',
      ]),
    );
    expect(await streamCompletion({ config, messages, onDelta })).toBe('complete');
    expect(onDelta.mock.calls).toEqual([['complete']]);
  });

  it.each([
    ['', 'The model connection ended before the response was complete. Try again.'],
    ['data: {"choices":[{"finish_reason":', 'The model service returned an invalid response.'],
    [
      'data: {"error":{"message":"synthetic server error"}}\n\ndata: [DONE]\n\n',
      'The model service returned an invalid response.',
    ],
    [
      'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n',
      'The model service declined to generate these notes.',
    ],
  ])('rejects incomplete or failed streams before a successful terminal event: %s', async (tail, error) => {
    mocks.fetch.mockResolvedValue(
      sse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n' + tail]),
    );
    await expect(streamCompletion({ config, messages })).rejects.toThrow(error);
  });

  it('recognizes an event stream media type regardless of case', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        'data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\n',
        { headers: { 'Content-Type': 'Text/Event-Stream; charset=utf-8' } },
      ),
    );
    expect(await streamCompletion({ config, messages })).toBe('complete');
  });

  it('does not start a request after cancellation', async () => {
    await saveProviderConfig(config, 'synthetic-secret');
    const controller = new AbortController();
    controller.abort();
    await expect(streamCompletion({ messages, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('releases a stream when the server sends DONE without closing the connection', async () => {
    await saveProviderConfig(config, 'synthetic-secret');
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"complete"}}]}\n\ndata: [DONE]\n\n',
              ),
            );
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    expect(await streamCompletion({ messages })).toBe('complete');
    expect(cancel).toHaveBeenCalledOnce();
  }, 500);

  it('cancels the underlying response reader during generation', async () => {
    await saveProviderConfig(config, 'synthetic-secret');
    const controller = new AbortController();
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(
              new TextEncoder().encode('data: {"choices":[{"delta":{"content":"part"}}]}\n\n'),
            );
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    await expect(
      streamCompletion({ messages, signal: controller.signal, onDelta: () => controller.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('honors cancellation from the final delta and releases the stream', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\n',
              ),
            );
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    await expect(
      streamCompletion({
        config,
        messages,
        signal: controller.signal,
        onDelta: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('reasoning model completion budget', () => {
  it('allows a 65536 token ceiling and rejects requests above it locally', async () => {
    mocks.fetch.mockResolvedValue(
      sse(['data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n']),
    );
    await expect(streamCompletion({ config, messages, maxTokens: 65536 })).resolves.toBe('OK');
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body).max_tokens).toBe(65536);
    mocks.fetch.mockClear();
    await expect(streamCompletion({ config, messages, maxTokens: 65537 })).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([
    'text/event-stream',
    'application/json',
  ])('classifies length exhaustion for %s', async (type) => {
    const payload = {
      choices: [{ finish_reason: 'length', delta: {}, message: { content: 'partial' } }],
    };
    mocks.fetch.mockResolvedValue(
      type === 'text/event-stream'
        ? sse([`data: ${JSON.stringify(payload)}\n\n`])
        : new Response(JSON.stringify(payload), { headers: { 'Content-Type': type } }),
    );
    await expect(streamCompletion({ config, messages })).rejects.toMatchObject({ code: 'length' });
  });
  it.each([
    ['https://open.bigmodel.cn/api/paas/v4', 'glm-5.3-flash', 'low'],
    ['https://api.z.ai/api/paas/v4', 'GLM-5.3', 'low'],
    ['https://models.example/v1', 'glm-5.3-flash', undefined],
    ['https://open.bigmodel.cn/api/paas/v4', 'glm-4.7', undefined],
  ])('scopes short-task reasoning parameters to supported endpoints and models', async (baseUrl, model, effort) => {
    mocks.fetch.mockResolvedValue(
      sse(['data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n']),
    );
    await streamCompletion({ config: { ...config, baseUrl, model }, messages });
    const request = JSON.parse(mocks.fetch.mock.calls[0]![1].body);
    expect(request.reasoning_effort).toBe(effort);
    expect(request.thinking).toBeUndefined();
  });
  it('honors a saved reasoning effort only on an endpoint that accepts it', async () => {
    mocks.fetch.mockResolvedValue(
      sse(['data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n']),
    );
    await streamCompletion({
      config: {
        ...config,
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-5.3-flash',
        reasoningEffort: 'high',
      },
      messages,
    });
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body).reasoning_effort).toBe('high');
    mocks.fetch.mockResolvedValue(
      sse(['data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n']),
    );
    await streamCompletion({ config: { ...config, reasoningEffort: 'high' }, messages });
    expect(JSON.parse(mocks.fetch.mock.calls[1]![1].body).reasoning_effort).toBeUndefined();
  });
  it('uses the service-specific output parameter and the saved cap', async () => {
    mocks.fetch.mockResolvedValue(
      sse(['data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n']),
    );
    await streamCompletion({
      config: { ...config, baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', maxTokens: 2048 },
      messages,
    });
    const body = JSON.parse(mocks.fetch.mock.calls[0]![1].body);
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.max_tokens).toBeUndefined();
  });
  it('stores only provider identity without capability fields', () => {
    expect(providerIdentity({ ...config, reasoningEffort: 'high', maxTokens: 2048 })).toEqual(
      config,
    );
    expect(() => validateProviderConfig({ ...config, reasoningEffort: 'extreme' })).toThrow();
    expect(() => validateProviderConfig({ ...config, maxTokens: 0 })).toThrow();
  });
  it.each([
    ['o3', 'minimal', undefined],
    ['o3-mini', 'high', 'high'],
    ['o1-mini', 'high', undefined],
    ['gpt-5-chat-latest', 'high', undefined],
    ['gpt-5-unknown', 'high', undefined],
    ['gpt-5.1', 'minimal', undefined],
    ['gpt-5.2', 'none', 'none'],
    ['gpt-5.2', 'xhigh', 'xhigh'],
  ])('only sends a verified effort for %s', async (model, effort, expected) => {
    mocks.fetch.mockResolvedValue(
      sse(['data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n']),
    );
    await streamCompletion({
      config: validateProviderConfig({
        ...config,
        baseUrl: 'https://api.openai.com/v1',
        model,
        reasoningEffort: effort,
      }),
      messages,
    });
    expect(JSON.parse(mocks.fetch.mock.calls[0]![1].body).reasoning_effort).toBe(expected);
  });
});
