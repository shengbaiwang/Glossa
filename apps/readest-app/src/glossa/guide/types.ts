import type { ProviderConfig } from '@/glossa/ai/provider';
import type { ChapterSource } from '@/glossa/context/types';

export interface ReadingPassage {
  id: string;
  index: number;
  title: string;
  sources: ChapterSource[];
  characterCount: number;
  unavailable: boolean;
}

export interface GuideText {
  text: string;
  sourceIds: string[];
  kind: 'source' | 'inference' | 'background';
}

export interface ReadingGuideBody {
  orientation: GuideText[];
  difficulties: { title: string; explanation: GuideText }[];
  readingCue: GuideText | null;
  insufficientEvidence: boolean;
}

export interface ReadingGuide extends ReadingGuideBody {
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

export class GuideError extends Error {
  constructor(
    public readonly code: 'empty' | 'unavailable' | 'invalid-response' | 'storage',
    message: string,
  ) {
    super(message);
    this.name = 'GuideError';
  }
}

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Generation cancelled.', 'AbortError');
};
