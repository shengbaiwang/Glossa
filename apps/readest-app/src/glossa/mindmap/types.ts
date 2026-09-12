import type { ProviderConfig } from '@/glossa/ai/provider';
import type { ChapterSource } from '@/glossa/context/types';
import type { MindmapBody } from './schema';

export interface ReadingMindmap extends MindmapBody {
  id: string;
  bookId: string;
  chapterId: string;
  passageId: string;
  createdAt: string;
  cacheKey: string;
  contentHash: string;
  promptVersion: string;
  schemaVersion: 1;
  provider: ProviderConfig;
  sources: ChapterSource[];
}
