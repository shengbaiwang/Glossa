import { z } from 'zod';
import { PASSAGE_MAX_CHARACTERS, PASSAGE_MAX_SOURCES } from './passages';

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
