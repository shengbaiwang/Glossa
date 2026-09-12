import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NoteEditor from '@/app/reader/components/notebook/NoteEditor';
import { useNotebookStore } from '@/store/notebookStore';
import type { BookNote } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));

const annotation: BookNote = {
  id: 'note-1',
  type: 'annotation',
  cfi: 'epubcfi(/6/2)',
  text: 'Shared words',
  note: 'Saved note',
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  useNotebookStore.setState(useNotebookStore.getInitialState());
  useNotebookStore.getState().setNotebookEditAnnotation({ ...annotation });
});
afterEach(cleanup);

const mountEditor = (bookKey: string, onEdit = vi.fn(() => true)) =>
  render(<NoteEditor bookKey={bookKey} active onSave={() => true} onEdit={onEdit} />);

describe('Notebook annotation drafts', () => {
  it('restores an unsaved edit without requiring blur and does not leak it to another book', () => {
    const first = mountEditor('first-0');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unfinished edit' } });
    first.unmount();
    const second = mountEditor('second-0');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Saved note');
    second.unmount();
    mountEditor('first-0');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Unfinished edit');
  });

  it('preserves a cleared draft and isolates different locations containing the same text', () => {
    const first = mountEditor('first-0');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    first.unmount();
    act(() =>
      useNotebookStore
        .getState()
        .setNotebookEditAnnotation({ ...annotation, id: 'note-2', cfi: 'epubcfi(/6/4)' }),
    );
    const second = mountEditor('first-0');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Saved note');
    second.unmount();
    act(() => useNotebookStore.getState().setNotebookEditAnnotation({ ...annotation }));
    mountEditor('first-0');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('clears the transient draft only after a successful save', () => {
    const onEdit = vi.fn(() => false);
    mountEditor('first-0', onEdit);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New thought' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(Object.values(useNotebookStore.getState().notebookAnnotationDrafts)).toEqual([
      'New thought',
    ]);
    expect(useNotebookStore.getState().notebookEditAnnotation?.note).toBe('Saved note');
    onEdit.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(useNotebookStore.getState().notebookAnnotationDrafts).toEqual({});
  });
});
