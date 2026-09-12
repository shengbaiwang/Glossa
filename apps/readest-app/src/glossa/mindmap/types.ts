import type { ReadingGuide } from '@/glossa/guide/types';
import type { MindmapBody } from './schema';

export type ReadingMindmap = MindmapBody &
  Pick<
    ReadingGuide,
    | 'id'
    | 'bookId'
    | 'chapterId'
    | 'passageId'
    | 'createdAt'
    | 'cacheKey'
    | 'contentHash'
    | 'promptVersion'
    | 'schemaVersion'
    | 'provider'
    | 'sources'
  >;
