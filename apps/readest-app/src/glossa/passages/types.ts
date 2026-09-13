import type { ChapterSource } from '@/glossa/context/types';

export interface ReadingPassage {
  id: string;
  index: number;
  title: string;
  sources: ChapterSource[];
  characterCount: number;
  unavailable: boolean;
}

export class PassageError extends Error {
  constructor(
    public readonly code: 'empty' | 'unavailable' | 'invalid-response' | 'storage',
    message: string,
  ) {
    super(message);
    this.name = 'PassageError';
  }
}

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Generation cancelled.', 'AbortError');
};
