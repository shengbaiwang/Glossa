import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/bridge', () => ({
  getSecureItem: vi.fn().mockResolvedValue({}),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
}));

// Keep the real installed HTTP plugin; mock only the Rust IPC boundary.
import { streamCompletion, streamToolCompletion } from '@/glossa/ai/provider';

const config = {
  id: 'native-lifecycle',
  name: 'Synthetic native service',
  baseUrl: 'https://example.invalid/v1',
  model: 'synthetic',
};
const messages = [{ role: 'user' as const, content: 'Synthetic test.' }];
const invoke = vi.fn();
let chunks: string[];
let bodyExists: boolean;
let keepOpen: boolean;
let finishRead: (() => void) | undefined;

beforeEach(() => {
  chunks = [];
  bodyExists = true;
  keepOpen = false;
  finishRead = undefined;
  invoke.mockReset().mockImplementation(async (command: string) => {
    switch (command) {
      case 'plugin:http|fetch':
        return 100;
      case 'plugin:http|fetch_send':
        return {
          status: 200,
          statusText: 'OK',
          url: `${config.baseUrl}/chat/completions`,
          headers: [['content-type', 'text/event-stream']],
          rid: 200,
        };
      case 'plugin:http|fetch_read_body': {
        const chunk = chunks.shift();
        if (chunk) return [...new TextEncoder().encode(chunk), 0];
        if (keepOpen)
          await new Promise<void>((resolve) => {
            finishRead = resolve;
          });
        bodyExists = false;
        return [1];
      }
      case 'plugin:http|fetch_cancel_body':
        if (!bodyExists) throw 'The resource id 200 is invalid.';
        bodyExists = false;
        finishRead?.();
        return;
      default:
        throw new Error(`Unexpected IPC: ${command}`);
    }
  });
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected browser network request');
    }),
  );
});

afterEach(() => {
  finishRead?.();
  vi.unstubAllGlobals();
});

it('finishes native conversation output and removes listeners before a later abort', async () => {
  chunks.push('data: {"choices":[{"delta":{"content":"Complete"},"finish_reason":"stop"}]}\n\n');
  keepOpen = true;
  const controller = new AbortController();
  await expect(streamCompletion({ config, messages, signal: controller.signal })).resolves.toBe(
    'Complete',
  );
  expect(bodyExists).toBe(false);
  const calls = invoke.mock.calls.length;
  controller.abort();
  expect(invoke).toHaveBeenCalledTimes(calls);
});

it('cancels a native response from its last delta without changing AbortError semantics', async () => {
  chunks.push('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n');
  keepOpen = true;
  const controller = new AbortController();
  const onDelta = vi.fn(() => controller.abort());
  await expect(
    streamCompletion({ config, messages, signal: controller.signal, onDelta }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(onDelta.mock.calls).toEqual([['Partial']]);
  expect(bodyExists).toBe(false);
  expect(
    invoke.mock.calls.filter(([name]) => name === 'plugin:http|fetch_cancel_body'),
  ).toHaveLength(1);
});

it('completes consecutive native tool and text responses with the same harness signal', async () => {
  const controller = new AbortController();
  const call = {
    id: 'call_1',
    type: 'function',
    function: { name: 'get_outline', arguments: '{}' },
  };
  chunks.push(
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, ...call }] }, finish_reason: 'tool_calls' }] })}\n\n`,
  );
  const result = await streamToolCompletion({
    config,
    messages,
    signal: controller.signal,
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_outline',
          description: 'Synthetic outline.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
  });
  expect(result.toolCalls).toEqual([call]);
  expect(bodyExists).toBe(false);
  bodyExists = true;
  chunks.push('data: {"choices":[{"delta":{"content":"Answer"},"finish_reason":"stop"}]}\n\n');
  await expect(streamCompletion({ config, messages, signal: controller.signal })).resolves.toBe(
    'Answer',
  );
  expect(bodyExists).toBe(false);
  const calls = invoke.mock.calls.length;
  controller.abort();
  expect(invoke).toHaveBeenCalledTimes(calls);
});
