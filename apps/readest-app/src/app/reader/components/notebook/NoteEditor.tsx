import React, { useEffect, useRef, useState } from 'react';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { TextSelection } from '@/utils/sel';
import { md5Fingerprint } from '@/utils/md5';
import { BookNote } from '@/types/book';
import useShortcuts from '@/hooks/useShortcuts';
import TextEditor, { TextEditorRef } from '@/components/TextEditor';

interface NoteEditorProps {
  onSave: (selection: TextSelection, note: string) => void;
  onEdit: (annotation: BookNote) => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ onSave, onEdit }) => {
  const _ = useTranslation();
  const {
    notebookNewAnnotation,
    notebookEditAnnotation,
    setNotebookNewAnnotation,
    setNotebookEditAnnotation,
    saveNotebookAnnotationDraft,
    getNotebookAnnotationDraft,
  } = useNotebookStore();

  const editorRef = useRef<TextEditorRef>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (notebookEditAnnotation) {
      const noteText = notebookEditAnnotation.note;
      setNote(noteText);
      editorRef.current?.setValue(noteText);
      editorRef.current?.focus();
    } else if (notebookNewAnnotation) {
      const noteText = getAnnotationText();
      if (noteText) {
        const draftNote = getNotebookAnnotationDraft(md5Fingerprint(noteText)) || '';
        setNote(draftNote);
        editorRef.current?.setValue(draftNote);
        editorRef.current?.focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookNewAnnotation, notebookEditAnnotation]);

  const getAnnotationText = () => {
    return notebookEditAnnotation?.text || notebookNewAnnotation?.text || '';
  };

  const handleNoteChange = (value: string) => {
    setNote(value);
  };

  const handleBlur = () => {
    const currentValue = editorRef.current?.getValue();
    if (currentValue) {
      const noteText = getAnnotationText();
      if (noteText) {
        saveNotebookAnnotationDraft(md5Fingerprint(noteText), currentValue);
      }
    }
  };

  const handleSaveNote = () => {
    const currentValue = editorRef.current?.getValue();
    if (currentValue) {
      if (notebookNewAnnotation) {
        onSave(notebookNewAnnotation, currentValue);
      } else if (notebookEditAnnotation) {
        notebookEditAnnotation.note = currentValue;
        onEdit(notebookEditAnnotation);
      }
    }
  };

  const handleEscape = () => {
    if (notebookNewAnnotation) {
      // Clearing the selection ends the creation flow; Notebook reacts to that
      // and tears down the empty placeholder highlight it created (#4791).
      setNotebookNewAnnotation(null);
    }
    if (notebookEditAnnotation) {
      setNotebookEditAnnotation(null);
    }
  };

  useShortcuts({
    onSaveNote: () => {
      const currentValue = editorRef.current?.getValue();
      if (currentValue) {
        handleSaveNote();
      }
    },
    onEscape: handleEscape,
  });

  const canSave = Boolean(note.trim());

  return (
    <div className='content booknote-item note-editor-container glossa-reader-note-editor eink-bordered bg-base-100 mt-2 rounded-xl border p-3'>
      <div className='flex w-full'>
        <TextEditor
          ref={editorRef}
          value={note}
          onChange={handleNoteChange}
          onBlur={handleBlur}
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
