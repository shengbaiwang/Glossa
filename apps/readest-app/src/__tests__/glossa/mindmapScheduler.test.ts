import { afterEach, expect, it, vi } from 'vitest';
import { ModelServiceError } from '@/glossa/ai/provider';
import { scheduleMapRequest } from '@/glossa/mindmap/scheduler';

afterEach(() => vi.useRealTimers());
const config = () => ({
  id: 'test',
  name: 'Test',
  model: 'model',
  baseUrl: `https://${crypto.randomUUID()}.example/v1`,
});
const signal = () => new AbortController().signal;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('shares two slots across jobs and models, refilling a free slot without waiting for its peer', async () => {
  const service = config(),
    gates = Array.from({ length: 4 }, deferred);
  const started: number[] = [];
  const jobs = gates.map((gate, index) =>
    scheduleMapRequest({ ...service, model: `model-${index}` }, signal(), async () => {
      started.push(index);
      await gate.promise;
    }),
  );
  try {
    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    gates[1]!.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    gates[2]!.resolve();
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
  } finally {
    gates.forEach((gate) => gate.resolve());
    await Promise.all(jobs);
  }
});

it('cancels a queued request without dispatching it and frees slots even for an unresponsive transport', async () => {
  const service = config(),
    first = new AbortController(),
    second = new AbortController(),
    queued = new AbortController();
  const work = vi.fn(() => new Promise<void>(() => {}));
  const jobs = [first, second].map((controller) =>
    scheduleMapRequest(service, controller.signal, work).catch((error: unknown) => error),
  );
  await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(2));
  const never = vi.fn();
  const waiting = scheduleMapRequest(service, queued.signal, never).catch(
    (error: unknown) => error,
  );
  queued.abort();
  expect(await waiting).toMatchObject({ name: 'AbortError' });
  expect(never).not.toHaveBeenCalled();
  first.abort();
  second.abort();
  expect(await Promise.all(jobs)).toEqual([
    expect.objectContaining({ name: 'AbortError' }),
    expect.objectContaining({ name: 'AbortError' }),
  ]);
  await expect(scheduleMapRequest(service, signal(), async () => 'available')).resolves.toBe(
    'available',
  );
});

it('honors Retry-After and serializes subsequent requests after rate limiting', async () => {
  vi.useFakeTimers();
  const service = config();
  await expect(
    scheduleMapRequest(service, signal(), async () => {
      throw new ModelServiceError('Busy', 'rate_limit', 3000);
    }),
  ).rejects.toMatchObject({ code: 'rate_limit' });
  const gate = deferred(),
    first = vi.fn(() => gate.promise),
    second = vi.fn(async () => 'done');
  const a = scheduleMapRequest(service, signal(), first);
  const b = scheduleMapRequest(service, signal(), second);
  try {
    await vi.advanceTimersByTimeAsync(2999);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  } finally {
    gate.resolve();
    await Promise.all([a, b]);
  }
  expect(second).toHaveBeenCalledTimes(1);
});
