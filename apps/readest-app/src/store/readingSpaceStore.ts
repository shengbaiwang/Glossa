import { create } from 'zustand';
import { readReadingSpace, saveReadingSpace, type ReadingSpaceScope } from '@/utils/readingSpaces';
export const useReadingSpaceStore = create<{
  space: ReadingSpaceScope;
  setSpace: (space: ReadingSpaceScope) => void;
}>((set) => ({
  space: readReadingSpace(),
  setSpace: (space) => {
    saveReadingSpace(space);
    set({ space });
  },
}));
