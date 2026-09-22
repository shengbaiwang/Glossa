import type { ChapterSource } from '@/glossa/context/types';

/** Format-independent, local-only book access. Implementations never call a model. */
export interface BookReadingAccess {
  documentHash: string;
  chapters: { id: string; title: string; depth: number }[];
  readChapter: (id: string, signal: AbortSignal) => Promise<ChapterSource[]>;
  readAll: (signal: AbortSignal) => Promise<ChapterSource[]>;
  search: (queries: string[], signal: AbortSignal) => Promise<ChapterSource[]>;
  verifySources: (sources: ChapterSource[], signal: AbortSignal) => Promise<ChapterSource[]>;
}
