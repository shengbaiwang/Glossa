import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import ConversationUsage from '@/glossa/ui/ConversationUsage';
import type { ReplyUsage } from '@/glossa/conversation/usage';
import {
  createReplyUsage,
  replyUsageSchema,
  sumReplyCosts,
  sumReplyTokens,
} from '@/glossa/conversation/usage';
import { readProviderCost, readTokenUsage } from '@/glossa/ai/usage';
import {
  addAnswerVersion,
  currentAnswerVersion,
  selectAnswerVersion,
  turnSchema,
  type ConversationTurn,
} from '@/glossa/conversation/schema';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  [undefined, ''],
  [{ amount: 0, currency: 'USD' as const }, 'US$0.0000'],
  [{ amount: 0.0971 }, '0.0971 · Currency not provided'],
  [{ amount: 1e-9, currency: 'USD' as const }, 'US$1.000e-9'],
])('renders cost %j without confusing missing, free, unknown units or tiny charges', (cost, expected) => {
  const usage: ReplyUsage = {
    elapsedMs: 100,
    requests: [
      { id: 'one', outputBudget: 1024, elapsedMs: 50, finished: true, ...(cost ? { cost } : {}) },
      { id: 'missing', outputBudget: 1024, elapsedMs: 50, finished: false },
    ],
  };
  render(
    createElement(ConversationUsage, {
      answer: {
        id: 'answer',
        question: 'Test?',
        text: 'Test',
        createdAt: 1,
        status: 'complete',
        usage,
        provider: { id: 'test', name: 'Test', model: 'test', baseUrl: 'https://test.example/v1' },
      },
    }),
  );
  fireEvent.focus(screen.getByRole('button', { name: 'Reply usage' }));
  if (cost) {
    const row = screen.getByText('Cost').parentElement!;
    expect(row.textContent).toContain(expected);
    expect(row.textContent).toContain('≥');
    expect(row.textContent).toContain('Cost reported 1/2');
  } else {
    expect(screen.queryByText('Cost')).toBeNull();
    expect(screen.queryByText('Not provided')).toBeNull();
  }
});

const answer = {
  id: 'test',
  question: 'Test?',
  text: 'Answer',
  createdAt: 1,
  status: 'complete' as const,
  provider: { id: 'test', name: 'Test', model: 'test', baseUrl: 'https://test.example/v1' },
};

it('hides missing metrics while retaining returned zeros and keeping technical details collapsed', () => {
  render(
    createElement(ConversationUsage, {
      answer: {
        ...answer,
        usage: {
          elapsedMs: 66800,
          firstTextMs: 834,
          requests: [
            {
              id: 'r1',
              outputBudget: 8192,
              elapsedMs: 66800,
              finished: true,
              usage: { inputTokens: 0, totalTokens: 0 },
            },
          ],
        },
      },
    }),
  );
  fireEvent.focus(screen.getByRole('button', { name: 'Reply usage' }));
  expect(screen.getByRole('dialog', { name: 'Reply usage' })).toBeTruthy();
  expect(screen.getByText('Input').parentElement?.textContent).toContain('0');
  for (const label of [
    'Output',
    'Cost',
    'Reasoning tokens',
    'Cache read tokens',
    'End-to-end throughput',
    'Not provided',
    'Output limit',
    'Model requests',
  ]) {
    expect(screen.queryByText(label)).toBeNull();
  }
  expect(screen.getByText('834 ms')).toBeTruthy();
  expect(screen.getByText('1 min 6.8 s')).toBeTruthy();
  const more = screen.getByRole('button', { name: 'More information' });
  expect(more.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(more);
  expect(more.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Output limit')).toBeTruthy();
  expect(screen.getByText('Model requests')).toBeTruthy();
  fireEvent.click(more);
  expect(screen.queryByText('Output limit')).toBeNull();
});

it('omits the usage trigger for historical answers with no metrics', () => {
  render(createElement(ConversationUsage, { answer }));
  expect(screen.queryByRole('button', { name: 'Reply usage' })).toBeNull();
});

it('reads account charges without double counting upstream cost or guessing a relay currency', () => {
  const usage = { cost: 0.0971, cost_details: { upstream_inference_cost: 2 } };
  expect(readProviderCost(usage, 'https://openrouter.ai/api/v1')).toEqual({
    amount: 0.0971,
    currency: 'USD',
  });
  expect(readProviderCost(usage, 'https://relay.example/v1')).toEqual({ amount: 0.0971 });
  expect(readProviderCost(usage, 'https://openrouter.ai.example/v1')).toEqual({ amount: 0.0971 });
  expect(readProviderCost(usage, 'invalid')).toEqual({ amount: 0.0971 });
  expect(readProviderCost({ cost: 0 }, 'https://openrouter.ai/api/v1')).toEqual({
    amount: 0,
    currency: 'USD',
  });
  expect(readProviderCost({ cost: 1e-9 }, 'https://openrouter.ai/api/v1')?.amount).toBe(1e-9);
});

it.each([
  undefined,
  null,
  -1,
  NaN,
  Infinity,
  '0.1',
  {},
  [],
])('ignores invalid or missing cost %s', (cost) => {
  expect(readProviderCost({ cost }, 'https://openrouter.ai/api/v1')).toBeUndefined();
});

it('aggregates final charges once per request, marks missing charges and keeps different units separate', () => {
  const collector = createReplyUsage();
  const request = { id: 'r1', outputBudget: 1024, elapsedMs: 1, finished: true };
  collector.onMetrics({ ...request, cost: { amount: 0.01, currency: 'USD' } });
  collector.onMetrics({ ...request, cost: { amount: 0.02, currency: 'USD' } });
  collector.onMetrics({ ...request, id: 'recovery', cost: { amount: 0.03, currency: 'USD' } });
  collector.onMetrics({ ...request, id: 'free', cost: { amount: 0, currency: 'USD' } });
  collector.onMetrics({ ...request, id: 'missing' });
  expect(sumReplyCosts(collector.snapshot())).toEqual({
    totals: [{ amount: 0.05, currency: 'USD' }],
    reported: 3,
    partial: true,
  });
  collector.onMetrics({ ...request, id: 'missing', cost: { amount: 1 } });
  expect(sumReplyCosts(collector.snapshot())).toEqual({
    totals: [{ amount: 0.05, currency: 'USD' }, { amount: 1 }],
    reported: 4,
    partial: false,
  });
  expect(sumReplyCosts({ elapsedMs: 0, requests: [request] })).toBeUndefined();
  expect(
    replyUsageSchema.safeParse({ elapsedMs: 0, requests: [{ ...request, cost: { amount: -1 } }] })
      .success,
  ).toBe(false);
});

it('counts each model call once across updates and preserves unfinished time on cancellation', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
  const collector = createReplyUsage();
  collector.onMetrics({ id: 'plan', outputBudget: 4096, elapsedMs: 0, finished: false });
  clock.mockReturnValue(300);
  collector.onMetrics({
    id: 'plan',
    outputBudget: 4096,
    elapsedMs: 200,
    finished: true,
    usage: { totalTokens: 50 },
  });
  collector.onMetrics({ id: 'reply', outputBudget: 8192, elapsedMs: 0, finished: false });
  clock.mockReturnValue(500);
  collector.onText('first visible text');
  clock.mockReturnValue(800);
  collector.onText('continued text');
  const receipt = collector.snapshot();
  expect(receipt.elapsedMs).toBe(700);
  expect(receipt.firstTextMs).toBe(400);
  expect(receipt.requests.map((item) => item.elapsedMs)).toEqual([200, 500]);
  expect(sumReplyTokens(receipt, 'totalTokens')).toEqual({ value: 50, partial: true });
  expect(sumReplyTokens(receipt, 'outputTokens')).toBeUndefined();
  expect(replyUsageSchema.safeParse(receipt).success).toBe(true);
});

it('rejects corrupt receipts and never substitutes zero for missing provider data', () => {
  expect(
    readTokenUsage({ prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 8 }),
  ).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedTokens: 8 });
  expect(
    readTokenUsage({ prompt_tokens: -1, completion_tokens: Infinity, total_tokens: '50' }),
  ).toBeUndefined();
  expect(
    readTokenUsage({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 11 } }),
  ).toEqual({ inputTokens: 10 });
  expect(replyUsageSchema.safeParse({ elapsedMs: -1, requests: [] }).success).toBe(false);
  expect(
    replyUsageSchema.safeParse({ elapsedMs: 1, requests: [], apiKey: 'private' }).success,
  ).toBe(false);
});

it('restores usage per answer version and accepts older records without usage', () => {
  const provider = { id: 'test', name: 'Test', model: 'test', baseUrl: 'http://localhost/v1' };
  const old: ConversationTurn = {
    id: 'old',
    question: 'Why?',
    blocks: [{ kind: 'background', text: 'Answer', sourceIds: [] }],
    sources: [],
    createdAt: 1,
    provider,
    promptVersion: 'conversation-3',
    metadata: { bookTitle: '', author: '', chapterTitle: '' },
    status: 'complete',
  };
  expect(turnSchema.safeParse(old).success).toBe(true);
  const updated = addAnswerVersion(old, {
    id: 'new',
    question: 'Why?',
    text: 'New answer',
    createdAt: 2,
    provider,
    status: 'complete',
    usage: {
      elapsedMs: 500,
      requests: [
        {
          id: 'r1',
          outputBudget: 1024,
          elapsedMs: 400,
          finished: true,
          usage: { totalTokens: 30 },
          cost: { amount: 0.0971, currency: 'USD' },
        },
      ],
    },
  });
  const restored = turnSchema.parse(JSON.parse(JSON.stringify(updated)));
  expect(currentAnswerVersion(restored).usage?.requests[0]?.usage?.totalTokens).toBe(30);
  expect(currentAnswerVersion(restored).usage?.requests[0]?.cost).toEqual({
    amount: 0.0971,
    currency: 'USD',
  });
  const previous = selectAnswerVersion(restored, 'old');
  expect(currentAnswerVersion(previous).usage).toBeUndefined();
  expect('usage' in previous && previous.usage).toBeUndefined();
});
