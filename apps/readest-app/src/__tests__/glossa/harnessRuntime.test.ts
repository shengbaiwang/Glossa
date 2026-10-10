import { afterEach, expect, it, vi } from 'vitest';
import { scheduleRequest } from '@/glossa/harness/scheduler';
import { createRunTrace, runTraceSchema } from '@/glossa/harness/trace';
import { readInventory, inventoryPrompt, EvidenceError } from '@/glossa/harness/evidence';
import { chooseReadingTurns } from '@/glossa/harness/history';
import { scheduleMapRequest } from '@/glossa/mindmap/scheduler';
import { generateConversation } from '@/glossa/conversation/generate';

afterEach(() => vi.useRealTimers());
const config = () => ({
  id: 'test',
  name: 'Test',
  model: 'model',
  baseUrl: `https://${crypto.randomUUID()}.example/v1`,
});
const signal = () => new AbortController().signal;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it('queues real conversation dispatch behind active map slots and cancels before transport', async () => {
  const service = config(),
    gates = [deferred(), deferred()];
  const maps = gates.map((gate) => scheduleMapRequest(service, signal(), () => gate.promise));
  const controller = new AbortController(),
    complete = vi.fn(async () => 'Answer');
  const answer = generateConversation(
    {
      config: service,
      metadata: { bookTitle: 'Original', author: '', chapterTitle: '' },
      question: 'Hello',
      turns: [],
      signal: controller.signal,
    },
    { complete },
  );
  try {
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    controller.abort();
    await expect(answer).rejects.toMatchObject({ name: 'AbortError' });
    expect(complete).not.toHaveBeenCalled();
  } finally {
    gates.forEach((gate) => gate.resolve());
    await Promise.all(maps);
  }
});

it('shares map and conversation slots, prioritizes interactive work without starving background work', async () => {
  const service = config();
  const gates = Array.from({ length: 8 }, deferred);
  const started: number[] = [];
  const jobs = gates.map((gate, i) =>
    scheduleRequest(
      service,
      signal(),
      async () => {
        started.push(i);
        await gate.promise;
      },
      i >= 3 ? 'interactive' : 'background',
    ),
  );
  try {
    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    gates[0]!.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 3]));
    gates[3]!.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 3, 4]));
    gates[4]!.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 3, 4, 5]));
    gates[5]!.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 3, 4, 5, 2]));
  } finally {
    gates.forEach((gate) => gate.resolve());
    await Promise.all(jobs);
  }
});

it('keeps bounded safe trace metadata and never accepts arbitrary response fields', () => {
  const trace = createRunTrace();
  for (let i = 0; i < 120; i++) trace.add('inventory', 'cache_hit', { sources: 2, characters: 20 });
  expect(trace.snapshot().events).toHaveLength(96);
  expect(runTraceSchema.safeParse(trace.snapshot()).success).toBe(true);
  expect(runTraceSchema.safeParse({ ...trace.snapshot(), secret: 'private' }).success).toBe(false);
  const copy = trace.snapshot();
  copy.events.length = 0;
  expect(trace.snapshot().events).toHaveLength(96);
});

it('uses the same inventory contract in prompts and rejects missing or invented evidence', () => {
  const sources = [{ sourceId: 'a' }, { sourceId: 'b' }];
  expect(inventoryPrompt()).toContain('coveredSourceIds');
  expect(
    readInventory(
      JSON.stringify({
        coveredSourceIds: ['a', 'b'],
        points: [{ text: 'conditional', sourceIds: ['a'] }],
      }),
      sources,
    ).points,
  ).toHaveLength(1);
  expect(() => readInventory('{', sources)).toThrow(EvidenceError);
  expect(() =>
    readInventory(JSON.stringify({ coveredSourceIds: ['a'], points: [] }), sources),
  ).toThrow(expect.objectContaining({ code: 'coverage' }));
  expect(() =>
    readInventory(
      JSON.stringify({
        coveredSourceIds: ['a', 'b'],
        points: [{ text: 'claim', sourceIds: ['x'] }],
      }),
      sources,
    ),
  ).toThrow(expect.objectContaining({ code: 'sources' }));
});

it('keeps the latest turn and retrieves an older relevant exchange before unrelated recent ones', () => {
  const turns = Array.from({ length: 8 }, (_, i) => ({
    question: i === 0 ? '闸门维护条件' : `普通问题${i}`,
    text: '一个完整回答',
    status: 'complete' as const,
  }));
  const chosen = chooseReadingTurns(turns, '闸门维护条件是什么');
  expect(chosen[0]).toBe(turns[7]);
  expect(chosen[1]).toBe(turns[0]);
  expect(chosen).toHaveLength(8);
});
