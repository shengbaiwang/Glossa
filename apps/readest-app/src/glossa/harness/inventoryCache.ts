import { argumentPointsSchema } from './evidence';
import { createDerivedStore } from './derivedStore';

/** Completed interpretations only. Reopening a book must still reread and hash its originals. */
export const readingInventoryStore = createDerivedStore(
  'glossa-reading-inventories',
  argumentPointsSchema,
  {
    entryBytes: 100000,
    entries: 48,
    totalBytes: 1000000,
  },
);
