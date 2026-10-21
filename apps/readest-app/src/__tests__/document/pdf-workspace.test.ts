import { expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { BookNote } from '@/types/book';
import { preparePDFAnnotations } from '@/services/pdfWorkspace';

const annotation = {
  type: 'annotation',
  cfi: 'original-cfi',
  style: 'highlight',
  note: 'My note',
  color: '#123456',
} as BookNote;
it('exports live personal annotations while retaining deleted records and bookmarks in local data', async () => {
  const resolve = vi.fn(async () => ({
    index: 2,
    rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }],
  }));
  const notes = [
    annotation,
    { ...annotation, deletedAt: 123 },
    { ...annotation, type: 'bookmark' } as BookNote,
  ];
  const original = structuredClone(notes);
  const result = await preparePDFAnnotations(
    { getPDFAnnotationRects: resolve } as unknown as BookDoc,
    notes,
    new AbortController().signal,
  );
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(result[0]).toMatchObject({
    index: 2,
    text: 'My note',
    color: '#123456',
    style: 'highlight',
  });
  expect(notes).toEqual(original);
});
it('rejects the whole export when an existing annotation cannot be resolved', async () => {
  const resolve = vi
    .fn()
    .mockResolvedValueOnce({ index: 0, rects: [] })
    .mockRejectedValueOnce(new Error('unresolved'));
  await expect(
    preparePDFAnnotations(
      { getPDFAnnotationRects: resolve } as unknown as BookDoc,
      [annotation, annotation],
      new AbortController().signal,
    ),
  ).rejects.toThrow('unresolved');
});
it('stops resolving annotations after cancellation and keeps personal data', async () => {
  const controller = new AbortController();
  const resolve = vi.fn(async () => {
    controller.abort();
    return { index: 0, rects: [] };
  });
  await expect(
    preparePDFAnnotations(
      { getPDFAnnotationRects: resolve } as unknown as BookDoc,
      [annotation, annotation],
      controller.signal,
    ),
  ).rejects.toThrow('Cancelled');
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(annotation.note).toBe('My note');
});
