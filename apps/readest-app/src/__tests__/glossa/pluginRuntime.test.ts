import { afterEach, expect, it, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import { runPluginTask } from '@/glossa/plugins/runtime';

const setEnabled = (enabled: boolean) =>
  useSettingsStore.setState({
    settings: { officialModules: { pdfAutoContents: enabled } } as SystemSettings,
  });
afterEach(() => {
  setEnabled(true);
  vi.restoreAllMocks();
});

it('never activates disabled plugins', async () => {
  setEnabled(false);
  const task = vi.fn();
  await runPluginTask('pdfAutoContents', task);
  expect(task).not.toHaveBeenCalled();
});
it('aborts active work once, releases subscriptions and does not resume on re-enable', async () => {
  setEnabled(true);
  const unsubscribe = vi.fn();
  const subscribe = useSettingsStore.subscribe;
  vi.spyOn(useSettingsStore, 'subscribe').mockImplementation((listener) => {
    const release = subscribe(listener);
    return () => {
      unsubscribe();
      release();
    };
  });
  let finish!: () => void;
  let signal!: AbortSignal;
  const task = vi.fn(async (value: AbortSignal) => {
    signal = value;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const run = runPluginTask('pdfAutoContents', task);
  expect(signal.aborted).toBe(false);
  setEnabled(false);
  setEnabled(true);
  expect(signal.aborted).toBe(true);
  finish();
  await run;
  expect(task).toHaveBeenCalledOnce();
  expect(unsubscribe).toHaveBeenCalledOnce();
  const next = vi.fn(async (fresh: AbortSignal) => {
    expect(fresh.aborted).toBe(false);
  });
  await runPluginTask('pdfAutoContents', next);
  expect(next).toHaveBeenCalledOnce();
});
it('releases failed activations and permits a later explicit retry', async () => {
  setEnabled(true);
  let signal!: AbortSignal;
  await expect(
    runPluginTask('pdfAutoContents', async (value) => {
      signal = value;
      throw new Error('fixture');
    }),
  ).rejects.toThrow('fixture');
  expect(signal.aborted).toBe(true);
  const retry = vi.fn(async () => {});
  await runPluginTask('pdfAutoContents', retry);
  expect(retry).toHaveBeenCalledOnce();
});
it('links panel cancellation and ignores a previously cancelled activation', async () => {
  setEnabled(true);
  const controller = new AbortController();
  let finish!: () => void;
  let signal!: AbortSignal;
  const run = runPluginTask(
    'pdfAutoContents',
    async (value) => {
      signal = value;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    controller.signal,
  );
  controller.abort();
  expect(signal.aborted).toBe(true);
  finish();
  await run;
  const task = vi.fn();
  await runPluginTask('pdfAutoContents', task, controller.signal);
  expect(task).not.toHaveBeenCalled();
});
