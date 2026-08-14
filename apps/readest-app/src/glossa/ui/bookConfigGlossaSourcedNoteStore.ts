import type { BookConfig } from '@/types/book';

import {
  createGlossaSourcedNoteStore,
  type GlossaSourcedNote,
  type GlossaSourcedNoteStore,
} from '../notes/glossaSourcedNotes';

/**
 * The sole Readest boundary for sourced-note persistence. Domain code receives
 * only a local config value and cannot access stores, sync, or reader state.
 */
export const createBookConfigGlossaSourcedNoteStore = (options: {
  documentId: string;
  getConfig(): BookConfig | null;
  writeEntries(entries: GlossaSourcedNote[]): Promise<void>;
}): GlossaSourcedNoteStore =>
  createGlossaSourcedNoteStore({
    documentId: options.documentId,
    getEntries: () => options.getConfig()?.glossaSourcedNotes,
    writeEntries: options.writeEntries,
  });
