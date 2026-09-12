import { create } from 'zustand';

// Transient location only; never keep a live DOM range or a transformed quotation in AI state.
export const useConversationSelection = create<{
  selection: { bookKey: string; cfi: string; revision: number } | null;
  attach: (bookKey: string, cfi: string) => void;
}>((set) => ({
  selection: null,
  attach: (bookKey, cfi) =>
    set((state) => ({
      selection: { bookKey, cfi, revision: (state.selection?.revision ?? 0) + 1 },
    })),
}));
