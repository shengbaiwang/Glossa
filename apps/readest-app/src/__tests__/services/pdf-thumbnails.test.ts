import { expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import { clearPDFThumbnails, createPDFThumbnailQueue } from '@/services/pdfThumbnails';

it('renders visible pages first, aborts stale work, and reuses a thumbnail on remount', async () => {
  const pending = new Map<number, { finish: () => void; signal: AbortSignal }>();
  const blob = new Blob(['thumbnail']);
  const getPDFImage = vi.fn(
    (index: number, _width: number, _region: unknown, signal: AbortSignal) =>
      new Promise<Blob>((resolve, reject) => {
        pending.set(index, { finish: () => resolve(blob), signal });
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  const book = { getPDFImage } as unknown as BookDoc;
  const onImage = vi.fn();
  const queue = createPDFThumbnailQueue(book, onImage, vi.fn());
  queue.update(0, 4, 400);
  await vi.waitFor(() => expect([...pending.keys()]).toEqual([0, 1]));

  queue.update(80, 82, 400);
  expect(pending.get(0)?.signal.aborted).toBe(true);
  expect(pending.get(1)?.signal.aborted).toBe(true);
  await vi.waitFor(() => expect([...pending.keys()]).toEqual([0, 1, 80, 81]));
  pending.get(80)!.finish();
  await vi.waitFor(() => expect(onImage.mock.calls).toEqual([[80, blob]]));
  queue.close();
  expect(pending.get(81)?.signal.aborted).toBe(true);

  const remounted = vi.fn();
  const second = createPDFThumbnailQueue(book, remounted, vi.fn());
  second.update(80, 81, 400);
  expect(remounted).toHaveBeenCalledWith(80, blob);
  expect(getPDFImage.mock.calls.filter(([index]) => index === 80)).toHaveLength(1);
  second.close();
  clearPDFThumbnails(book);
});
