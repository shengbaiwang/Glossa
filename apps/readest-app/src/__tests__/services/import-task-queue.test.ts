import { expect, it, vi } from 'vitest';
import { ImportResourceGate, runImportTasks } from '@/services/importTaskQueue';

it('shares four resource slots across overlapping pipeline calls through commit', async () => {
  const gate = new ImportResourceGate();
  let releaseCommits!: () => void;
  const commitGate = new Promise<void>((resolve) => {
    releaseCommits = resolve;
  });
  let active = 0;
  let maximum = 0;
  const prepared = vi.fn();
  const run = () =>
    runImportTasks(
      4,
      async () => {
        const lease = await gate.acquire(1);
        active++;
        maximum = Math.max(maximum, active);
        prepared();
        return lease;
      },
      async (items) => {
        await commitGate;
        for (const item of items) {
          active--;
          item.value.release();
        }
      },
    );
  const first = run();
  const second = run();
  try {
    await vi.waitFor(() => expect(prepared).toHaveBeenCalledTimes(4));
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(prepared).toHaveBeenCalledTimes(4);
  } finally {
    releaseCommits();
  }
  await Promise.all([first, second]);
  expect(prepared).toHaveBeenCalledTimes(8);
  expect(maximum).toBe(4);
  expect(active).toBe(0);
});

it('accounts source bytes and admits oversized and unknown sources exclusively', async () => {
  const gate = new ImportResourceGate(4, 100);
  const first = await gate.acquire(60);
  const entered = vi.fn();
  const second = gate.acquire(60).then((lease) => {
    entered();
    return lease;
  });
  await Promise.resolve();
  expect(entered).not.toHaveBeenCalled();
  first.release();
  const secondLease = await second;
  const oversized = gate.acquire(1000).then((lease) => {
    entered();
    return lease;
  });
  await Promise.resolve();
  expect(entered).toHaveBeenCalledTimes(1);
  secondLease.release();
  const oversizedLease = await oversized;
  const unknown = gate.acquire().then((lease) => {
    entered();
    return lease;
  });
  await Promise.resolve();
  expect(entered).toHaveBeenCalledTimes(2);
  oversizedLease.release();
  oversizedLease.release();
  (await unknown).release();
  expect(entered).toHaveBeenCalledTimes(3);
});

it('removes aborted waiters immediately so the next source can proceed', async () => {
  const gate = new ImportResourceGate(4, 100);
  const first = await gate.acquire(60);
  const controller = new AbortController();
  const cancelled = gate.acquire(1000, controller.signal);
  const entered = vi.fn();
  const next = gate.acquire(30).then((lease) => {
    entered();
    return lease;
  });
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  const nextLease = await next;
  expect(entered).toHaveBeenCalledOnce();
  nextLease.release();
  first.release();
});
