import { z } from 'zod';
import type { ChapterSource } from '@/glossa/context/types';
import { stubTranslation as _ } from '@/utils/misc';
import { NotesError, type StudyNoteBody } from './types';

const sourceIds = z
  .array(z.string().min(1).max(200))
  .min(1)
  .max(100)
  .transform((ids) => [...new Set(ids)]);
const paragraph = z
  .object({
    text: z.string().trim().min(1).max(12000),
    sourceIds,
    kind: z.enum(['source', 'inference']),
  })
  .strict();

export const studyNoteBodySchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    overview: z.array(paragraph).max(50),
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(300),
            paragraphs: z.array(paragraph).min(1).max(100),
          })
          .strict(),
      )
      .max(100),
    questions: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(2000),
            answer: z.string().trim().min(1).max(8000),
            sourceIds,
          })
          .strict(),
      )
      .max(100),
    insufficientEvidence: z.boolean(),
  })
  .strict()
  .refine((value) => value.insufficientEvidence || value.sections.length > 0);

export function validateStudyNoteSources(body: StudyNoteBody, sources: ChapterSource[]): boolean {
  const allowed = new Set(sources.map((source) => source.sourceId));
  return [
    ...body.overview,
    ...body.sections.flatMap((section) => section.paragraphs),
    ...body.questions,
  ].every((item) => item.sourceIds.every((sourceId) => allowed.has(sourceId)));
}

export function parseStudyNote(raw: string, sources: ChapterSource[]): StudyNoteBody {
  try {
    if (raw.length > 250000) throw new Error('Response too large');
    // Some compatible services wrap JSON in a single code fence. Do not recover
    // arbitrary JSON fragments from prose: that could hide an incomplete result.
    const json = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
    const body = studyNoteBodySchema.parse(JSON.parse(json));
    if (!validateStudyNoteSources(body, sources)) throw new Error('Unknown source');
    return body;
  } catch {
    throw new NotesError(
      'invalid-response',
      _('The model returned incomplete notes or invalid sources. Please try again.'),
    );
  }
}
