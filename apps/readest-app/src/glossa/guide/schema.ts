import { z } from 'zod';
import type { ChapterSource } from '@/glossa/context/types';
import { stubTranslation as _ } from '@/utils/misc';
import { PASSAGE_MAX_CHARACTERS, PASSAGE_MAX_SOURCES } from './passages';
import { GuideError, type ReadingGuideBody } from './types';

const sourceIds = z
  .array(z.string().min(1).max(200))
  .min(1)
  .max(4)
  .refine((ids) => new Set(ids).size === ids.length);
const guideText = (limit: number, background = false) =>
  z
    .object({
      text: z.string().trim().min(1).max(limit),
      sourceIds,
      kind: z
        .enum(['source', 'inference', 'background'])
        .refine((kind) => background || kind !== 'background'),
    })
    .strict();

export const readingGuideBodySchema = z
  .object({
    orientation: z.array(guideText(400)).max(3),
    difficulties: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(80),
            explanation: guideText(700, true),
          })
          .strict(),
      )
      .max(2),
    readingCue: guideText(240).nullable(),
    insufficientEvidence: z.boolean(),
  })
  .strict()
  .refine((body) => body.insufficientEvidence || body.orientation.length > 0);

export const passageSourcesSchema = z
  .array(
    z
      .object({
        sourceId: z.string().min(1).max(200),
        text: z.string().min(1).max(PASSAGE_MAX_CHARACTERS),
        kind: z.enum(['heading', 'paragraph', 'list', 'table', 'quote']),
        anchor: z
          .object({
            sectionIndex: z.number().int().nonnegative(),
            cfi: z.string().min(1).max(10000),
            quote: z
              .object({
                exact: z.string().min(1).max(PASSAGE_MAX_CHARACTERS),
                prefix: z.string().max(1000),
                suffix: z.string().max(1000),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
  )
  .min(1)
  .max(PASSAGE_MAX_SOURCES)
  .refine(
    (sources) =>
      new Set(sources.map((source) => source.sourceId)).size === sources.length &&
      sources.reduce((count, source) => count + source.text.length, 0) <= PASSAGE_MAX_CHARACTERS &&
      sources.every((source) => source.text === source.anchor.quote.exact),
  );

export function validateReadingGuideSources(
  body: ReadingGuideBody,
  sources: ChapterSource[],
): boolean {
  const ids = new Set(sources.map((source) => source.sourceId));
  if (ids.size !== sources.length) return false;
  return [
    ...body.orientation,
    ...body.difficulties.map((difficulty) => difficulty.explanation),
    ...(body.readingCue ? [body.readingCue] : []),
  ].every((text) => text.sourceIds.every((id) => ids.has(id)));
}

export function parseReadingGuide(raw: string, sources: ChapterSource[]): ReadingGuideBody {
  try {
    if (raw.length > 24000) throw new Error();
    const json = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
    const body = readingGuideBodySchema.parse(JSON.parse(json));
    if (
      !passageSourcesSchema.safeParse(sources).success ||
      !validateReadingGuideSources(body, sources)
    )
      throw new Error();
    return body;
  } catch {
    throw new GuideError(
      'invalid-response',
      _('The guide was incomplete or cited unavailable sources. Try again.'),
    );
  }
}
