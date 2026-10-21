import { expect, it, vi } from 'vitest';
import { getPDFNoteRanges } from '@/services/pdfNoteRanges';
import { preparePDFAnnotations } from '@/services/pdfWorkspace';
import {
  buildAnnotationIndex,
  selectLocationAnnotations,
} from '@/app/reader/utils/annotationIndex';
import { mergeRestyledAnnotation } from '@/app/reader/utils/annotatorUtil';
import type { BookNote } from '@/types/book';
import type { BookDoc } from '@/libs/document';

const a = 'epubcfi(/6/2!/4/2,/1:0,/1:5)';
const b = 'epubcfi(/6/4!/4/2,/1:0,/1:6)';
const note: BookNote = {
  id: 'across-pages',
  type: 'annotation',
  cfi: a,
  pdfRanges: [a, b],
  text: 'Alpha\nBeta',
  note: 'one personal note',
  style: 'highlight',
  color: 'yellow',
  createdAt: 1,
  updatedAt: 2,
};

it('keeps legacy anchors and validates the whole ordered PDF fragment set', () => {
  expect(getPDFNoteRanges({ cfi: a })).toEqual([a]);
  expect(getPDFNoteRanges(note)).toEqual([a, b]);
  // A blank intervening page has no selectable range, but must not prevent
  // saving the text on either side of it.
  const afterBlank = b.replace('/6/4!', '/6/6!');
  expect(getPDFNoteRanges({ cfi: a, pdfRanges: [a, afterBlank] })).toEqual([a, afterBlank]);
  for (const pdfRanges of [
    [],
    [a],
    [b, a],
    [a, a],
    [a, 'epubcfi(/6/8!/4/2/1:0)'],
    [a, 'broken'],
    [a, 'epubcfi(/6/4!)'],
    [a, 'epubcfi(/6/4!/garbage)'],
    [a, 'epubcfi(/6/4!/4/2/1:0)'],
  ]) {
    expect(() => getPDFNoteRanges({ cfi: a, pdfRanges })).toThrow('pdf_annotation_unresolved');
  }
});

it('finds the same single annotation on either page and preserves fragments when restyling', () => {
  const index = buildAnnotationIndex([note]);
  expect(selectLocationAnnotations(index, 'epubcfi(/6/2!)').annotations).toEqual([note]);
  expect(selectLocationAnnotations(index, 'epubcfi(/6/4!)').annotations).toEqual([note]);
  expect(
    mergeRestyledAnnotation(note, { ...note, pdfRanges: undefined, color: 'green' }),
  ).toMatchObject({
    id: note.id,
    pdfRanges: [a, b],
    note: note.note,
    color: 'green',
  });
});

it('exports every page of one note and rejects a partly unresolved annotation', async () => {
  const resolve = vi.fn(async (cfi: string) => ({ index: cfi === a ? 0 : 1, rects: [] }));
  const book = { getPDFAnnotationRects: resolve } as unknown as BookDoc;
  const exported = await preparePDFAnnotations(book, [note], new AbortController().signal);
  expect(resolve.mock.calls.map(([cfi]) => cfi)).toEqual([a, b]);
  expect(exported.map((x) => x.index)).toEqual([0, 1]);
  resolve.mockRejectedValueOnce(new Error('unresolved'));
  await expect(preparePDFAnnotations(book, [note], new AbortController().signal)).rejects.toThrow(
    'unresolved',
  );
});
