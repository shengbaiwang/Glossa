import { beforeEach, expect, it, vi } from 'vitest';
import { createPDFReadingOCR } from '@/services/pdfReading';
import type { PDFCache } from '@/services/pdfEnhancement';
const native = vi.hoisted(() => ({
  read: vi.fn(),
  start: vi.fn(),
  wait: vi.fn(),
  cancel: vi.fn(),
  status: vi.fn(),
}));
vi.mock('@/services/pdfEnhancement', async (original) => ({
  ...(await original<typeof import('@/services/pdfEnhancement')>()),
  readOCRPage: native.read,
  startPDFOCR: native.start,
  waitForPDFOCR: native.wait,
  cancelPDFOCR: native.cancel,
  getPDFOCRStatus: native.status,
}));
const cache: PDFCache = { id: 'a'.repeat(32), pages: [], outline: null, revision: 0 };
const page = {
  index: 106,
  native: false,
  lines: [],
  recognizer: 'vision-multiscale-1',
};
beforeEach(() => {
  vi.clearAllMocks();
  native.read.mockResolvedValue(null);
  native.start.mockResolvedValue({ cacheId: cache.id });
  native.wait.mockImplementation(async () => {
    native.read.mockResolvedValue(page);
    return { state: 'completed' };
  });
  native.cancel.mockResolvedValue(undefined);
});
it('recognizes only requested reading pages, coalesces zooms and reuses persisted checkpoints', async () => {
  const reader = createPDFReadingOCR('/original.pdf', cache);
  const a = reader.recognize(106, () => true),
    b = reader.recognize(106, () => true);
  expect(a).toBe(b);
  expect(await a).toEqual(page);
  expect(native.start).toHaveBeenCalledWith('/original.pdf', cache.id, [106]);
  expect(await reader.recognize(106, () => true)).toEqual(page);
  expect(native.start).toHaveBeenCalledTimes(1);
  reader.destroy();
});
it('does not start queued recognition after a page or book closes', async () => {
  const reader = createPDFReadingOCR('/original.pdf', cache);
  const task = reader.recognize(106, () => false);
  expect(await task).toBeNull();
  reader.destroy();
  expect(await reader.recognize(1, () => true)).toBeNull();
  expect(native.start).not.toHaveBeenCalled();
});
it('does not automatically loop after an owned worker fails', async () => {
  native.wait.mockRejectedValue(new Error('failed'));
  const reader = createPDFReadingOCR('/original.pdf', cache);
  await expect(reader.recognize(106, () => true)).rejects.toThrow('failed');
  await expect(reader.recognize(106, () => true)).rejects.toThrow('pdf_recognition_failed');
  reader.destroy();
  expect(native.start).toHaveBeenCalledTimes(1);
  expect(native.cancel).toHaveBeenCalledWith(cache.id);
});
it('cancels only its own active recognition on close and ignores late completion', async () => {
  let finish!: (value: unknown) => void;
  native.wait.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const reader = createPDFReadingOCR('/original.pdf', cache);
  const task = reader.recognize(106, () => true);
  await vi.waitFor(() => expect(native.wait).toHaveBeenCalled());
  reader.destroy();
  finish({ state: 'cancelled' });
  await expect(task).rejects.toThrow();
  expect(native.cancel).toHaveBeenCalledWith(cache.id);
});

it('keeps a replacement frame eligible when the first queued frame disappears', async () => {
  const reader = createPDFReadingOCR('/original.pdf', cache);
  let connected = true;
  const first = reader.recognize(106, () => connected);
  connected = false;
  const replacement = reader.recognize(106, () => true);
  expect(await replacement).toEqual(page);
  expect(await first).toEqual(page);
  expect(native.start).toHaveBeenCalledTimes(1);
  reader.destroy();
});
it('does not repeatedly recognize a completed page whose checkpoint cannot be read', async () => {
  native.wait.mockResolvedValue({ state: 'completed' });
  const reader = createPDFReadingOCR('/original.pdf', cache);
  await expect(reader.recognize(106, () => true)).rejects.toThrow('pdf_recognition_failed');
  await expect(reader.recognize(106, () => true)).rejects.toThrow('pdf_recognition_failed');
  expect(native.start).toHaveBeenCalledTimes(1);
  reader.destroy();
});

it('recovers a legacy empty checkpoint once and reuses the new character boxes', async () => {
  const recovered = {
    ...page,
    lines: [{ text: 'Copper', x: 0.2, y: 0.3, width: 0.3, height: 0.04, endLine: true }],
  };
  native.read.mockResolvedValue({ index: 106, native: false, lines: [] });
  native.wait.mockImplementation(async () => {
    native.read.mockResolvedValue(recovered);
    return { state: 'completed' };
  });
  const reader = createPDFReadingOCR('/original.pdf', cache);
  expect(await reader.recognize(106, () => true)).toEqual(recovered);
  expect(await reader.recognize(106, () => true)).toEqual(recovered);
  expect(native.start).toHaveBeenCalledExactlyOnceWith('/original.pdf', cache.id, [106]);
  reader.destroy();
});

it('does not retry a current empty result or alter a legacy nonempty checkpoint', async () => {
  const legacyText = {
    index: 107,
    native: false,
    lines: [{ text: 'Old selection', x: 0.2, y: 0.3, width: 0.3, height: 0.04 }],
  };
  native.read.mockImplementation(async (_id, index: number) => (index === 106 ? page : legacyText));
  const reader = createPDFReadingOCR('/original.pdf', cache);
  expect(await reader.recognize(106, () => true)).toBe(page);
  expect(await reader.recognize(106, () => true)).toBe(page);
  expect(await reader.recognize(107, () => true)).toBe(legacyText);
  expect(native.start).not.toHaveBeenCalled();
  reader.destroy();
});

it('bounds recovery when a completed worker leaves the legacy empty checkpoint unchanged', async () => {
  native.read.mockResolvedValue({ index: 106, native: false, lines: [] });
  native.wait.mockResolvedValue({ state: 'completed' });
  const reader = createPDFReadingOCR('/original.pdf', cache);
  await expect(reader.recognize(106, () => true)).rejects.toThrow('pdf_recognition_failed');
  await expect(reader.recognize(106, () => true)).rejects.toThrow('pdf_recognition_failed');
  expect(native.start).toHaveBeenCalledTimes(1);
  reader.destroy();
});
