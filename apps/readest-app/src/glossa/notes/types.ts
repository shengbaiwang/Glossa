import type { ProviderConfig } from '@/glossa/ai/provider';
import type { ChapterSource } from '@/glossa/context/types';

export interface StudyParagraph {
  text: string;
  sourceIds: string[];
  kind: 'source' | 'inference';
}

export interface StudyNoteBody {
  title: string;
  overview: StudyParagraph[];
  sections: { heading: string; paragraphs: StudyParagraph[] }[];
  questions: { question: string; answer: string; sourceIds: string[] }[];
  insufficientEvidence: boolean;
}

export interface StudyNoteVersion extends StudyNoteBody {
  id: string;
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  createdAt: string;
  cacheKey: string;
  contentHash: string;
  provider: ProviderConfig;
  promptVersion: string;
  schemaVersion: number;
  sources: ChapterSource[];
}

export interface ChapterNotes {
  versions: StudyNoteVersion[];
  personalNote: string;
}

export class NotesError extends Error {
  constructor(
    public readonly code: 'empty' | 'invalid-response' | 'storage',
    message: string,
  ) {
    super(message);
    this.name = 'NotesError';
  }
}

export const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Generation cancelled.', 'AbortError');
};
