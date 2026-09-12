import { create } from 'zustand';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';

export type NotebookTab = 'notes' | 'guide' | 'conversation' | 'mindmap';

interface NotebookState {
  notebookWidth: string;
  isNotebookVisible: boolean;
  isNotebookPinned: boolean;
  notebookActiveTab: NotebookTab;
  notebookNewAnnotation: TextSelection | null;
  // Id of the highlight eagerly created by the "Annotate" action as the anchor
  // for a note in progress. Tracked so a cancelled creation flow can tear that
  // empty placeholder back down instead of leaking it (#4791).
  notebookNewHighlightId: string | null;
  notebookEditAnnotation: BookNote | null;
  notebookAnnotationDrafts: { [key: string]: string };
  getIsNotebookVisible: () => boolean;
  toggleNotebook: () => void;
  toggleNotebookPin: () => void;
  getNotebookWidth: () => string;
  setNotebookWidth: (width: string) => void;
  setNotebookVisible: (visible: boolean) => void;
  setNotebookPin: (pinned: boolean) => void;
  setNotebookActiveTab: (tab: NotebookTab) => void;
  setNotebookNewAnnotation: (selection: TextSelection | null) => void;
  setNotebookNewHighlightId: (id: string | null) => void;
  setNotebookEditAnnotation: (note: BookNote | null) => void;
  saveNotebookAnnotationDraft: (key: string, note: string) => void;
  clearNotebookAnnotationDraft: (key: string) => void;
  getNotebookAnnotationDraft: (key: string) => string | undefined;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebookWidth: '',
  isNotebookVisible: false,
  isNotebookPinned: false,
  notebookActiveTab: 'guide',
  notebookNewAnnotation: null,
  notebookNewHighlightId: null,
  notebookEditAnnotation: null,
  notebookAnnotationDrafts: {},
  getIsNotebookVisible: () => get().isNotebookVisible,
  getNotebookWidth: () => get().notebookWidth,
  setNotebookWidth: (width: string) => set({ notebookWidth: width }),
  toggleNotebook: () => set((state) => ({ isNotebookVisible: !state.isNotebookVisible })),
  toggleNotebookPin: () => set((state) => ({ isNotebookPinned: !state.isNotebookPinned })),
  setNotebookVisible: (visible: boolean) => set({ isNotebookVisible: visible }),
  setNotebookPin: (pinned: boolean) => set({ isNotebookPinned: pinned }),
  setNotebookActiveTab: (tab: NotebookTab) => set({ notebookActiveTab: tab }),
  setNotebookNewAnnotation: (selection: TextSelection | null) =>
    set((state) => ({
      notebookNewAnnotation: selection,
      notebookActiveTab: selection ? 'notes' : state.notebookActiveTab,
    })),
  setNotebookNewHighlightId: (id: string | null) => set({ notebookNewHighlightId: id }),
  setNotebookEditAnnotation: (note: BookNote | null) =>
    set((state) => ({
      notebookEditAnnotation: note,
      notebookActiveTab: note ? 'notes' : state.notebookActiveTab,
    })),
  saveNotebookAnnotationDraft: (key: string, note: string) =>
    set((state) => ({
      notebookAnnotationDrafts: { ...state.notebookAnnotationDrafts, [key]: note },
    })),
  clearNotebookAnnotationDraft: (key: string) =>
    set((state) => {
      const drafts = { ...state.notebookAnnotationDrafts };
      delete drafts[key];
      return { notebookAnnotationDrafts: drafts };
    }),
  getNotebookAnnotationDraft: (key: string) => get().notebookAnnotationDrafts[key],
}));
