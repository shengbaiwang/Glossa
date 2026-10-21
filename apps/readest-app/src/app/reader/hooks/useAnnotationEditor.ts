import { useCallback, useRef, useState } from 'react';
import { BookNote } from '@/types/book';
import { NOTE_PREFIX } from '@/types/view';
import { TextSelection } from '@/utils/sel';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { getPDFNoteRanges } from '@/services/pdfNoteRanges';
import type { PDFSelectionFragment } from '@/types/view';
import {
  getHandlePositionsFromRange as getHandlePositionsForBook,
  HandlePositions,
  removeBookNoteOverlays,
} from '../utils/annotatorUtil';

interface UseAnnotationEditorProps {
  bookKey: string;
  annotation?: BookNote;
  getAnnotationText: (range: Range) => Promise<string>;
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>;
}

export const useAnnotationEditor = ({
  bookKey,
  annotation,
  getAnnotationText,
  setSelection,
}: UseAnnotationEditorProps) => {
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getView, getProgress, getViewsById } = useReaderStore();

  const view = getView(bookKey);
  const editingAnnotationRef = useRef(annotation);
  const [handlePositions, setHandlePositions] = useState<HandlePositions | null>(null);

  const getHandlePositionsFromRange = useCallback(
    (range: Range, isVertical: boolean): HandlePositions | null =>
      getHandlePositionsForBook(bookKey, range, isVertical),
    [bookKey],
  );

  // Apply an already-built range (anchored at the non-dragged end in the editor
  // component so it survives a corner auto page-turn) to the edited annotation.
  const applyAnnotationRange = useCallback(
    async (newRange: Range, targetIndex: number, isVertical: boolean, isDragging: boolean) => {
      const editing = editingAnnotationRef.current;
      if (!editing || !view) return;

      const newPositions = getHandlePositionsFromRange(newRange, isVertical);
      if (newPositions) {
        setHandlePositions(newPositions);
      }

      const newCfi = view.getCFI(targetIndex, newRange);
      const newText = await getAnnotationText(newRange);

      if (newCfi && newText) {
        const config = getConfig(bookKey)!;
        const progress = getProgress(bookKey)!;
        const { booknotes: annotations = [] } = config;
        const existingIndex = annotations.findIndex((a) => a.id === editing.id && !a.deletedAt);

        if (existingIndex !== -1) {
          const existingAnnotation = annotations[existingIndex]!;
          const updatedAnnotation: BookNote = {
            ...existingAnnotation,
            cfi: newCfi,
            text: newText,
            updatedAt: Date.now(),
          };

          // Both overlays of a unified record are keyed by its cfi, so a moved
          // range must tear down *both* — dropping only the highlight left the
          // note bubble stranded at the old anchor while a new one was drawn at
          // the new one, so one highlight showed several note markers (#5538).
          const views = getViewsById(bookKey.split('-')[0]!);
          const hasNote = !!existingAnnotation.note?.trim();
          views.forEach((v) => removeBookNoteOverlays(v, editing));
          views.forEach((v) => v?.addAnnotation(updatedAnnotation));
          if (hasNote) {
            views.forEach((v) =>
              v?.addAnnotation({ ...updatedAnnotation, value: `${NOTE_PREFIX}${newCfi}` }),
            );
          }
          editingAnnotationRef.current = updatedAnnotation;

          if (!isDragging) {
            annotations[existingIndex] = updatedAnnotation;
            const updatedConfig = updateBooknotes(bookKey, annotations);
            if (updatedConfig) {
              saveConfig(envConfig, bookKey, updatedConfig, settings);
            }

            setSelection({
              key: bookKey,
              annotated: true,
              text: newText,
              cfi: newCfi,
              index: targetIndex,
              range: newRange,
              page: existingAnnotation.page || progress.page,
            });
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookKey, getHandlePositionsFromRange, getAnnotationText, setSelection],
  );

  // PDF endpoints belong to separate documents. Commit the complete range once,
  // after text conversion; never feed a single fragment into the EPUB editor.
  const applyPDFAnnotationRanges = async (
    fragments: PDFSelectionFragment[],
    current: () => boolean = () => true,
  ): Promise<boolean> => {
    if (!view || !fragments.length || !current()) return false;
    try {
      const cfis = fragments.map(({ index, range }) => {
        if (!range.startContainer.isConnected || range.collapsed)
          throw new Error('pdf_annotation_unresolved');
        return view.getCFI(index, range);
      });
      const cfi = cfis[0]!;
      const pdfRanges = cfis.length > 1 ? cfis : undefined;
      getPDFNoteRanges({ cfi, pdfRanges });
      const texts: string[] = [];
      for (const { range } of fragments) {
        texts.push(await getAnnotationText(range));
        if (!current() || !texts.at(-1)?.trim()) return false;
      }
      const original = editingAnnotationRef.current;
      if (!original) return false;
      const annotations = getConfig(bookKey)?.booknotes ?? [];
      const existing = annotations.find((a) => a.id === original.id && !a.deletedAt);
      if (
        !existing ||
        existing.cfi !== original.cfi ||
        JSON.stringify(existing.pdfRanges) !== JSON.stringify(original.pdfRanges)
      )
        return false;
      const { pdfRanges: _oldRanges, ...base } = existing;
      const updated: BookNote = {
        ...base,
        cfi,
        ...(pdfRanges ? { pdfRanges } : {}),
        text: texts.join('\n'),
        page: fragments[0]!.index + 1,
        updatedAt: Date.now(),
      };
      const next = annotations.map((a) => (a.id === existing.id ? updated : a));
      const config = updateBooknotes(bookKey, next);
      if (!config) return false;
      try {
        await saveConfig(envConfig, bookKey, config, settings);
      } catch {
        const latest = getConfig(bookKey)?.booknotes ?? [];
        const rollback = latest.map((a) => (a === updated ? existing : a));
        updateBooknotes(bookKey, rollback);
        return false;
      }
      for (const v of getViewsById(bookKey.split('-')[0]!)) {
        removeBookNoteOverlays(v, existing);
        await v?.addAnnotation(updated);
        if (updated.note?.trim())
          await v?.addAnnotation({ ...updated, value: `${NOTE_PREFIX}${cfi}` });
      }
      editingAnnotationRef.current = updated;
      if (current())
        setSelection({
          key: bookKey,
          annotated: true,
          text: updated.text!,
          cfi,
          pdfRanges,
          index: fragments.at(-1)!.index,
          range: fragments.at(-1)!.range,
          page: updated.page!,
        });
      return true;
    } catch {
      return false;
    }
  };

  return {
    handlePositions,
    setHandlePositions,
    getHandlePositionsFromRange,
    applyAnnotationRange,
    applyPDFAnnotationRanges,
  };
};
