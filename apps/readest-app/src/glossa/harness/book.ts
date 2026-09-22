import type { ChapterSource } from '@/glossa/context/types';

/** Format-independent, local-only book access. Implementations never call a model. */
export interface BookReadingAccess {
  documentHash: string;
  sourceContext?: (source: ChapterSource) => { sectionTitles: string[]; heading?: string };
  chapters: { id: string; title: string; depth: number }[];
  readChapter: (id: string, signal: AbortSignal) => Promise<ChapterSource[]>;
  readAll: (signal: AbortSignal) => Promise<ChapterSource[]>;
  search: (queries: string[], signal: AbortSignal) => Promise<ChapterSource[]>;
  verifySources: (sources: ChapterSource[], signal: AbortSignal) => Promise<ChapterSource[]>;
}

/** Only semantic location hints travel to the model; navigation anchors stay local. */
export const sourceWire = (source: ChapterSource, access: BookReadingAccess) => ({
  sourceId: source.sourceId,
  text: source.text,
  ...(access.sourceContext ? { kind: source.kind, context: access.sourceContext(source) } : {}),
});
