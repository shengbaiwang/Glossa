import { z } from 'zod';

import type { ContextPack, ContextSegment } from '../context/contextPack';

// Shape is intentionally permissive here: a well-formed but unknown ID must
// reach the ContextPack whitelist check and be reported as such.
const sourceIdSchema = z.string().trim().min(1);

export const glossaAnswerSchema = z
  .object({
    status: z.enum(['answered', 'insufficient_evidence']),
    paragraphs: z
      .array(
        z
          .object({
            text: z.string().trim().min(1),
            sourceIds: z.array(sourceIdSchema).min(1),
            basis: z.enum(['document', 'inference', 'external']),
          })
          .strict(),
      )
      .max(8),
    followups: z.array(z.string().trim().min(1)).max(3),
  })
  .strict()
  .superRefine((answer, context) => {
    if (answer.status === 'insufficient_evidence' && answer.paragraphs.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Insufficient-evidence answers cannot include paragraphs',
      });
    }
  });

export type GlossaAnswer = z.infer<typeof glossaAnswerSchema>;

export type LocalCitation = Pick<ContextSegment, 'sourceId' | 'text' | 'anchor'>;

export type ValidatedGlossaAnswer = {
  answer: GlossaAnswer;
  citations: LocalCitation[];
};

export type GlossaAnswerValidation =
  | { ok: true; answer: GlossaAnswer; citations: LocalCitation[] }
  | {
      ok: false;
      reason: 'invalid-schema' | 'unknown-source-id' | 'duplicate-source-id' | 'external-basis';
    };

/**
 * Providers submit source IDs only. This resolves the actual quote and anchor
 * from the locally assembled ContextPack after strict protocol validation.
 */
export function validateGlossaAnswer(
  value: unknown,
  contextPack: ContextPack,
): GlossaAnswerValidation {
  const parsed = glossaAnswerSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'invalid-schema' };
  const sources = new Map(contextPack.segments.map((segment) => [segment.sourceId, segment]));
  const citationIds: string[] = [];
  for (const paragraph of parsed.data.paragraphs) {
    if (paragraph.basis === 'external') return { ok: false, reason: 'external-basis' };
    const seenInParagraph = new Set<string>();
    for (const sourceId of paragraph.sourceIds) {
      if (seenInParagraph.has(sourceId)) return { ok: false, reason: 'duplicate-source-id' };
      seenInParagraph.add(sourceId);
      if (!sources.has(sourceId)) return { ok: false, reason: 'unknown-source-id' };
      if (!citationIds.includes(sourceId)) citationIds.push(sourceId);
    }
  }
  return {
    ok: true,
    answer: parsed.data,
    citations: citationIds.flatMap((sourceId) => {
      const source = sources.get(sourceId);
      return source
        ? [{ sourceId: source.sourceId, text: source.text, anchor: source.anchor }]
        : [];
    }),
  };
}
