import React, { useEffect, useRef, useState } from 'react';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { TextSelection } from '@/utils/sel';
import { md5Fingerprint } from '@/utils/md5';
import { BookNote } from '@/types/book';
import useShortcuts from '@/hooks/useShortcuts';
import TextEditor, { TextEditorRef } from '@/components/TextEditor';

interface NoteEditorProps {
  bookKey: string;
  active: boolean;
  onSave: (selection: TextSelection, note: string) => boolean;
  onEdit: (annotation: BookNote) => boolean;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ bookKey, active, onSave, onEdit }) => {
  const _ = useTranslation();
  const {
    notebookNewAnnotation,
    notebookEditAnnotation,
    setNotebookNewAnnotation,
    setNotebookEditAnnotation,
    saveNotebookAnnotationDraft,
    clearNotebookAnnotationDraft,
    getNotebookAnnotationDraft,
  } = useNotebookStore();

  const editorRef = useRef<TextEditorRef>(null);
  const [note, setNote] = useState('');
  const draftKey = notebookEditAnnotation
    ? `${bookKey}:note:${notebookEditAnnotation.id}`
    : `${bookKey}:selection:${notebookNewAnnotation?.cfi ?? `${notebookNewAnnotation?.index}:${notebookNewAnnotation?.href ?? ''}:${md5Fingerprint(notebookNewAnnotation?.text ?? '')}`}`;

  useEffect(() => {
    const draft = getNotebookAnnotationDraft(draftKey) ?? notebookEditAnnotation?.note ?? '';
    setNote(draft);
    editorRef.current?.setValue(draft);
  }, [draftKey, notebookEditAnnotation, getNotebookAnnotationDraft]);

  useEffect(() => {
    if (active) editorRef.current?.focus();
  }, [active, draftKey]);

  const getAnnotationText = () => {
    return notebookEditAnnotation?.text || notebookNewAnnotation?.text || '';
  };

  const handleNoteChange = (value: string) => {
    setNote(value);
    // React does not guarantee blur on unmount. Preserve every edit in memory,
    // including an intentionally empty draft, scoped to this book and anchor.
    saveNotebookAnnotationDraft(draftKey, value);
  };

  const handleSaveNote = () => {
    const currentValue = editorRef.current?.getValue();
    if (active && currentValue?.trim()) {
      let saved = false;
      if (notebookNewAnnotation) {
        saved = onSave(notebookNewAnnotation, currentValue);
      } else if (notebookEditAnnotation) {
        saved = onEdit({ ...notebookEditAnnotation, note: currentValue });
      }
      if (saved) clearNotebookAnnotationDraft(draftKey);
    }
  };

  const handleEscape = () => {
    if (!active) return;
    if (notebookNewAnnotation) {
      // Clearing the selection ends the creation flow; Notebook reacts to that
      // and tears down the empty placeholder highlight it created (#4791).
      setNotebookNewAnnotation(null);
    }
    if (notebookEditAnnotation) {
      setNotebookEditAnnotation(null);
    }
  };

  useShortcuts(
    {
      onSaveNote: () => {
        const currentValue = editorRef.current?.getValue();
        if (currentValue) {
          handleSaveNote();
        }
      },
      onEscape: handleEscape,
    },
    [active, draftKey, notebookNewAnnotation, notebookEditAnnotation],
  );

  const canSave = Boolean(note.trim());

  return (
    <div className='content booknote-item note-editor-container glossa-reader-note-editor eink-bordered bg-base-100 mt-2 rounded-xl border p-3'>
      <div className='flex w-full'>
        <TextEditor
          ref={editorRef}
          value={note}
          onChange={handleNoteChange}
          onSave={handleSaveNote}
          onEscape={handleEscape}
          placeholder={_('Add your notes here...')}
          spellCheck={false}
        />
      </div>

      <blockquote className='glossa-reader-note-source my-4 border-s-2 ps-3'>
        <p className='glossa-eyebrow mb-1'>{_('Excerpt')}</p>
        <p className='glossa-reader-muted line-clamp-3 text-sm leading-relaxed'>
          {getAnnotationText()}
        </p>
      </blockquote>

      <div className='flex justify-end gap-2 pt-2'>
        <button type='button' className='glossa-button' onClick={handleEscape}>
          {_('Cancel')}
        </button>
        <button
          type='button'
          className='glossa-button glossa-button-primary'
          onClick={handleSaveNote}
          disabled={!canSave}
        >
          {_('Save')}
        </button>
      </div>
    </div>
  );
};

export default NoteEditor;
