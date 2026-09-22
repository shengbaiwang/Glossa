import { md5 } from 'js-md5';
import { z } from 'zod';
import { checkAborted, normalizeSourceText } from '@/glossa/context/text';
import type { ChapterSource } from '@/glossa/context/types';
import { passageSourcesSchema } from '@/glossa/passages/schema';
import { stubTranslation as _ } from '@/utils/misc';
import { rankSources } from './retrieval';

export class ReadingScopeError extends Error {}

export const MAX_READING_SOURCE_CHARS = 12000;

/** A local snapshot of an explicitly attached range, independent of live reader state. */
export const readingScopeSchema = z
  .object({
    version: z.literal('reading-scope-1'),
    id: z.string().min(1).max(200),
    documentHash: z.string().min(1).max(200),
    kind: z.enum(['page', 'selection', 'passage']),
    title: z.string().trim().min(1).max(500),
    chapterTitle: z.string().max(500),
    sources: passageSourcesSchema,
  })
  .strict();
export type ReadingScope = z.infer<typeof readingScopeSchema>;

/** Permission to query the current book; never a serialized copy of the book. */
export const bookReadingScopeSchema = z
  .object({
    version: z.literal('book-scope-1'),
    id: z.string().min(1).max(200),
    documentHash: z.string().min(1).max(200),
    kind: z.literal('book'),
    title: z.literal('Entire book'),
    chapterTitle: z.literal(''),
    sources: z.array(z.never()).length(0),
  })
  .strict()
  .refine((scope) => scope.id === `book-${md5(scope.documentHash)}`);
export type BookReadingScope = z.infer<typeof bookReadingScopeSchema>;
export const conversationReadingScopeSchema = z.union([readingScopeSchema, bookReadingScopeSchema]);
export type ConversationReadingScope = z.infer<typeof conversationReadingScopeSchema>;
export const createBookReadingScope = (documentHash: string): BookReadingScope =>
  bookReadingScopeSchema.parse({
    version: 'book-scope-1',
    id: `book-${md5(documentHash)}`,
    documentHash,
    kind: 'book',
    title: 'Entire book',
    chapterTitle: '',
    sources: [],
  });

export function createReadingScope(input: {
  documentHash: string;
  kind: ReadingScope['kind'];
  title: string;
  chapterTitle?: string;
  sources: ChapterSource[];
}): ReadingScope {
  const snapshot = {
    documentHash: input.documentHash,
    kind: input.kind,
    title: input.title,
    chapterTitle: input.chapterTitle ?? '',
    sources: input.sources,
  };
  const parsed = readingScopeSchema.safeParse({
    ...snapshot,
    version: 'reading-scope-1',
    id: `scope-${md5(JSON.stringify(snapshot))}`,
  });
  if (!parsed.success)
    throw new ReadingScopeError(_('This reading range is empty or too large. Choose a passage.'));
  // Zod creates a detached copy, so a later reader or passage edit cannot change this scope.
  return parsed.data;
}

export function readPassage(
  scope: ReadingScope,
  sourceIds: string[],
  signal?: AbortSignal,
): ChapterSource[] {
  checkAborted(signal);
  if (!sourceIds.length || sourceIds.length > 5)
    throw new ReadingScopeError(_('Choose up to five reading sources.'));
  const byId = new Map(scope.sources.map((source) => [source.sourceId, source]));
  return [...new Set(sourceIds)].map((id) => {
    const source = byId.get(id);
    if (!source)
      throw new ReadingScopeError(_('The source is outside the attached reading range.'));
    return source;
  });
}

/** Literal, local keyword search over only attached blocks; it never invokes whole-book search. */
export function searchBook(
  scope: ReadingScope,
  query: string,
  limit = 5,
  signal?: AbortSignal,
): ChapterSource[] {
  checkAborted(signal);
  const phrase = normalizeSourceText(query).toLocaleLowerCase();
  if (!phrase || phrase.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 5)
    throw new ReadingScopeError(_('The reading search request is invalid.'));
  return rankSources(scope.sources, query).slice(0, limit);
}

export function getOutline(scope: ReadingScope, signal?: AbortSignal) {
  checkAborted(signal);
  return {
    title: scope.title,
    headings: scope.sources
      .filter((source) => source.kind === 'heading')
      .map((source) => ({ sourceId: source.sourceId, text: source.text.slice(0, 120) })),
    sourceIds: scope.sources.map((source) => source.sourceId),
  };
}
