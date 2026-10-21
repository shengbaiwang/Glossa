import { beforeEach, expect, it, vi } from 'vitest';
import { recognizePDFPages } from '@/services/pdfOCR';

const native = vi.hoisted(() => ({ start: vi.fn(), wait: vi.fn(), cancel: vi.fn() }));
vi.mock('@/services/pdfEnhancement', () => ({
  startPDFOCR: native.start,
  waitForPDFOCR: native.wait,
  cancelPDFOCR: native.cancel,
}));
beforeEach(() => {
  vi.clearAllMocks();
  native.start.mockImplementation(async (_source, cacheId: string) => ({
    cacheId,
    jobId: 'owned',
    state: 'running',
  }));
  native.wait.mockResolvedValue({ state: 'completed' });
  native.cancel.mockResolvedValue(undefined);
});

it('routes independent precise contents evidence through the shared worker queue', async () => {
  await recognizePDFPages(
    '/one.pdf',
    'one',
    [2],
    new AbortController().signal,
    undefined,
    false,
    true,
  );
  expect(native.start).toHaveBeenCalledWith('/one.pdf', 'one', [2], false, true);
  expect(native.wait).toHaveBeenCalledOnce();
});

it('serializes reading, import and menu jobs without cancelling or stealing another job', async () => {
  let finish!: (value: unknown) => void;
  native.wait.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = recognizePDFPages('/one.pdf', 'one', [0], new AbortController().signal);
  await vi.waitFor(() => expect(native.wait).toHaveBeenCalledOnce());
  const abort = new AbortController();
  const cancelled = recognizePDFPages('/two.pdf', 'two', [1], abort.signal);
  const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort();
  await rejection;
  const third = recognizePDFPages('/three.pdf', 'three', [2], new AbortController().signal);
  expect(native.start).toHaveBeenCalledOnce();
  finish({ state: 'completed' });
  await first;
  await third;
  expect(native.start.mock.calls.map((call) => call[1])).toEqual(['one', 'three']);
  expect(native.cancel).not.toHaveBeenCalled();
});

it('bounds busy-worker waiting by cancellation and never cancels the owner', async () => {
  native.start.mockRejectedValue('pdf_ocr_busy');
  const abort = new AbortController();
  const task = recognizePDFPages('/one.pdf', 'one', [0], abort.signal);
  const rejection = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(native.start).toHaveBeenCalledOnce());
  abort.abort();
  await rejection;
  expect(native.wait).not.toHaveBeenCalled();
  expect(native.cancel).not.toHaveBeenCalled();
});

it('cancels a late-started owned job with its token and releases the queue after failure', async () => {
  const abort = new AbortController();
  native.start.mockImplementationOnce(async () => {
    abort.abort();
    return { cacheId: 'one', jobId: 'owned' };
  });
  await expect(recognizePDFPages('/one.pdf', 'one', [0], abort.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(native.cancel).toHaveBeenCalledWith('one', 'owned');
  native.start.mockRejectedValueOnce(new Error('private book text must never become a diagnostic'));
  await expect(
    recognizePDFPages('/one.pdf', 'one', [0], new AbortController().signal),
  ).rejects.toThrow();
  await recognizePDFPages('/two.pdf', 'two', [1], new AbortController().signal);
});

it('caps even a menu job at the native thirty-minute budget', async () => {
  vi.useFakeTimers();
  native.wait.mockImplementationOnce(() => new Promise(() => {}));
  const task = recognizePDFPages('/one.pdf', 'one', [0], new AbortController().signal);
  void task.catch(() => {});
  try {
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(native.cancel).toHaveBeenCalledWith('one', 'owned');
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    vi.useRealTimers();
  }
});
