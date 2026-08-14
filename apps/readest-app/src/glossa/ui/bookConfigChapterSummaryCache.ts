import type { BookConfig } from '@/types/book';

import {
  GLOSSA_CHAPTER_SUMMARY_PROMPT_VERSION,
  readChapterSummaryCache,
  writeChapterSummaryCache,
  type ChapterSummaryCache,
} from '../ai/chapterSummaryCache';

/**
 * The only Readest-specific E09 bridge. It keeps cache data in the existing
 * per-book config.json flow while the cache protocol itself remains unaware of
 * reader stores, cloud sync, or EPUB runtime objects.
 */
export function createBookConfigChapterSummaryCache(options: {
  documentHash: string;
  getConfig(): BookConfig | null;
  writeEntries(entries: NonNullable<BookConfig['glossaChapterSummaryCache']>): void;
}): ChapterSummaryCache {
  return {
    read: ({ contextPack, modelVersion }) => {
      const config = options.getConfig();
      if (!config) return null;
      return readChapterSummaryCache({
        entries: config.glossaChapterSummaryCache,
        contextPack,
        modelVersion,
        promptVersion: GLOSSA_CHAPTER_SUMMARY_PROMPT_VERSION,
      });
    },
    write: ({ contextPack, modelVersion, summary }) => {
      const config = options.getConfig();
      if (!config || contextPack.segments[0]?.anchor.documentId !== options.documentHash) return;
      const entries = writeChapterSummaryCache({
        entries: config.glossaChapterSummaryCache,
        contextPack,
        modelVersion,
        summary,
        promptVersion: GLOSSA_CHAPTER_SUMMARY_PROMPT_VERSION,
      });
      if (entries) options.writeEntries(entries);
    },
  };
}
