import { create } from 'zustand';

import type { DocumentNavigator } from '../citations/navigation';
import type { ContextPack } from '../context/contextPack';
import type { SelectedText } from '../context/types';

export type GlossaPanelState = {
  isOpen: boolean;
  isPinned: boolean;
  isCollapsed: boolean;
  width: string;
  selection: SelectedText | null;
  contextPack: ContextPack | null;
  chapterContextPack: ContextPack | null;
  chapterContextUnavailableReason: string | null;
  navigator: DocumentNavigator | null;
  open: (
    selection: SelectedText,
    contextPack?: ContextPack,
    navigator?: DocumentNavigator,
    chapterContext?: { pack: ContextPack | null; unavailableReason?: string },
  ) => void;
  close: () => void;
  togglePinned: () => void;
  toggleCollapsed: () => void;
  setWidth: (width: string) => void;
};

/**
 * Ephemeral UI state only. It deliberately has no persistence, notebook, or
 * AI-provider fields: opening or closing Glossa cannot create reader data.
 */
export const useGlossaPanelStore = create<GlossaPanelState>((set) => ({
  isOpen: false,
  isPinned: false,
  isCollapsed: false,
  width: '32%',
  selection: null,
  contextPack: null,
  chapterContextPack: null,
  chapterContextUnavailableReason: null,
  navigator: null,
  open: (selection, contextPack, navigator, chapterContext) =>
    set((state) => {
      if (state.navigator && state.navigator !== navigator) state.navigator.dispose();
      return {
        isOpen: true,
        isCollapsed: false,
        selection,
        contextPack: contextPack ?? null,
        chapterContextPack: chapterContext?.pack ?? null,
        chapterContextUnavailableReason: chapterContext?.unavailableReason ?? null,
        navigator: navigator ?? null,
      };
    }),
  close: () => set({ isOpen: false }),
  togglePinned: () => set((state) => ({ isPinned: !state.isPinned })),
  toggleCollapsed: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
  setWidth: (width) => set({ width }),
}));
