import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { BookNote } from '@/types/book';

// applyAnnotationRange now takes an already-built (DOM-anchored) range instead of
// resolving both ends from window coordinates, so the edited highlight survives a
// corner auto page-turn. This locks that contract: a commit applies the given
// range's CFI/text; a drag does not persist.

const h = vi.hoisted(() => ({
  view: { getCFI: vi.fn((_index: number, _range: Range) => 'new-cfi'), addAnnotation: vi.fn() },
  updateBooknotes: vi.fn((_key: string, notes: BookNote[]) => {
    h.annotations = notes;
    return { booknotes: notes };
  }),
  saveConfig: vi.fn(),
  annotations: [] as BookNote[],
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ booknotes: h.annotations }),
    saveConfig: h.saveConfig,
    updateBooknotes: h.updateBooknotes,
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewsById: () => [h.view],
    getProgress: () => ({ page: 3 }),
  }),
}));
vi.mock('@/app/reader/utils/annotatorUtil', async () => {
  const actual = await vi.importActual<typeof import('@/app/reader/utils/annotatorUtil')>(
    '@/app/reader/utils/annotatorUtil',
  );
  return { ...actual, getHandlePositionsFromRange: () => null };
});

import { NOTE_PREFIX } from '@/types/view';
import { useAnnotationEditor } from '@/app/reader/hooks/useAnnotationEditor';

const annotation = {
  id: 'a1',
  type: 'annotation',
  cfi: 'old-cfi',
  style: 'highlight',
  color: 'yellow',
  text: 'old',
  note: '',
} as unknown as BookNote;

const setup = (edited: BookNote = annotation) => {
  const setSelection = vi.fn();
  const hook = renderHook(() =>
    useAnnotationEditor({
      bookKey: 'book-1',
      annotation: edited,
      getAnnotationText: vi.fn(async () => 'edited text'),
      setSelection: setSelection as never,
    }),
  );
  return { ...hook, setSelection };
};

const range = {} as Range;

beforeEach(() => {
  vi.clearAllMocks();
  h.annotations = [{ ...annotation }];
});

afterEach(() => cleanup());

describe('useAnnotationEditor applyAnnotationRange', () => {
  test('commit applies the given range CFI/text and persists', async () => {
    const { result, setSelection } = setup();

    await result.current.applyAnnotationRange(range, 2, false, false);

    expect(h.view.getCFI).toHaveBeenCalledWith(2, range);
    expect(h.updateBooknotes).toHaveBeenCalledTimes(1);
    expect(h.saveConfig).toHaveBeenCalledTimes(1);
    expect(setSelection).toHaveBeenCalledWith(
      expect.objectContaining({ cfi: 'new-cfi', text: 'edited text', range, annotated: true }),
    );
  });

  test('a drag (isDragging) updates the preview but does not persist', async () => {
    const { result, setSelection } = setup();

    await result.current.applyAnnotationRange(range, 2, false, true);

    expect(h.view.addAnnotation).toHaveBeenCalled();
    expect(h.updateBooknotes).not.toHaveBeenCalled();
    expect(h.saveConfig).not.toHaveBeenCalled();
    expect(setSelection).not.toHaveBeenCalled();
  });

  // Adjusting the boundaries of a highlight that carries a note moves the record
  // to a new CFI, and both of its overlays are keyed by that CFI. Tearing down
  // only the highlight overlay left the note bubble stranded at the old anchor
  // while a fresh one was drawn at the new one, so a single highlight ended up
  // showing several note markers — and the stale ones resolved to no record at
  // all when clicked (#5538).
  test('re-anchors the note bubble overlay instead of stranding it at the old cfi', async () => {
    const noted = { ...annotation, note: 'my note' } as BookNote;
    h.annotations = [{ ...noted }];
    const { result } = setup(noted);

    await result.current.applyAnnotationRange(range, 2, false, false);

    const calls = h.view.addAnnotation.mock.calls as [BookNote & { value?: string }, boolean?][];
    const bubbleCalls = calls.filter(([note]) => note.value?.startsWith(NOTE_PREFIX));
    expect(bubbleCalls).toContainEqual([
      expect.objectContaining({ value: `${NOTE_PREFIX}old-cfi` }),
      true,
    ]);
    expect(bubbleCalls).toContainEqual([
      expect.objectContaining({ value: `${NOTE_PREFIX}new-cfi` }),
    ]);
  });
});

describe('PDF annotation endpoints', () => {
  const fragments = () =>
    [2, 3].map((index) => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.textContent = `page ${index}`;
      const range = doc.createRange();
      range.selectNodeContents(doc.body.firstChild!);
      return { index, range };
    });
  const cfi = (index: number) => `epubcfi(/6/${(index + 1) * 2}!/4/2,/1:0,/1:1)`;

  beforeEach(() => {
    h.view.getCFI.mockImplementation((...args: unknown[]) => cfi(args[0] as number));
  });

  test('updates all fragments as one record while retaining personal note and identity', async () => {
    const noted = { ...annotation, pdfRanges: ['old-cfi', 'other-page'], note: 'my note' };
    h.annotations = [noted];
    const { result, setSelection } = setup(noted);
    expect(await result.current.applyPDFAnnotationRanges(fragments())).toBe(true);
    expect(h.annotations[0]).toMatchObject({
      id: 'a1',
      note: 'my note',
      cfi: cfi(2),
      pdfRanges: [cfi(2), cfi(3)],
      text: 'edited text\nedited text',
      page: 3,
    });
    expect(h.saveConfig).toHaveBeenCalledTimes(1);
    expect(setSelection).toHaveBeenCalledWith(
      expect.objectContaining({
        annotated: true,
        pdfRanges: [cfi(2), cfi(3)],
      }),
    );
  });

  test('shrinking back to one page removes the obsolete multi-page field', async () => {
    const noted = { ...annotation, pdfRanges: ['old-cfi', 'other-page'] };
    h.annotations = [noted];
    const { result } = setup(noted);
    expect(await result.current.applyPDFAnnotationRanges(fragments().slice(0, 1))).toBe(true);
    expect(h.annotations[0]!.pdfRanges).toBeUndefined();
    expect(h.annotations[0]!.cfi).toBe(cfi(2));
  });

  test('does not replace a deleted or concurrently moved annotation', async () => {
    const { result } = setup();
    h.annotations = [{ ...annotation, cfi: 'concurrent-location' }];
    expect(await result.current.applyPDFAnnotationRanges(fragments())).toBe(false);
    expect(h.updateBooknotes).not.toHaveBeenCalled();
    expect(h.saveConfig).not.toHaveBeenCalled();
  });

  test('keeps the original record if the gesture was cancelled during text conversion', async () => {
    const { result } = setup();
    expect(await result.current.applyPDFAnnotationRanges(fragments(), () => false)).toBe(false);
    expect(h.updateBooknotes).not.toHaveBeenCalled();
  });

  test('rejects missing middle pages instead of saving an incomplete range', async () => {
    const { result } = setup();
    const parts = fragments();
    parts[1]!.index = 27;
    expect(await result.current.applyPDFAnnotationRanges(parts)).toBe(false);
    expect(h.updateBooknotes).not.toHaveBeenCalled();
  });

  test('restores the original record and overlays when disk saving fails', async () => {
    h.saveConfig.mockRejectedValueOnce(new Error('disk-full'));
    const { result, setSelection } = setup();
    expect(await result.current.applyPDFAnnotationRanges(fragments())).toBe(false);
    expect(h.annotations[0]).toMatchObject(annotation);
    expect(setSelection).not.toHaveBeenCalled();
  });
});
