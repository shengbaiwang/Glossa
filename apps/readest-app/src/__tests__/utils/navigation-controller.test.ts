import { expect, it, vi } from 'vitest';
import { NavigationController } from 'foliate-js/navigation-controller.js';

it('serializes renderer work and only commits the newest absolute target', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = vi.fn();
  const landed: number[] = [];
  const nav = new NavigationController();
  const first = nav.run(async (current) => {
    entered();
    await gate;
    if (current()) landed.push(1);
    return true;
  });
  await Promise.resolve();
  expect(entered).toHaveBeenCalledOnce();
  const second = nav.run((current) => {
    if (current()) landed.push(2);
    return true;
  });
  expect(landed).toEqual([]);
  release();
  expect(await first).toBe('superseded');
  expect(await second).toBe('arrived');
  expect(landed).toEqual([2]);
});

it('preserves relative order and releases later requests after failure or cancellation', async () => {
  const nav = new NavigationController();
  const abort = new AbortController();
  abort.abort();
  const skipped = vi.fn();
  const a = nav.run(
    () => {
      throw new Error('failed');
    },
    { relative: true },
  );
  const b = nav.run(skipped, { relative: true, signal: abort.signal });
  const c = nav.run(() => true, { relative: true });
  expect(await Promise.all([a, b, c])).toEqual(['failed', 'cancelled', 'arrived']);
  expect(skipped).not.toHaveBeenCalled();
});
