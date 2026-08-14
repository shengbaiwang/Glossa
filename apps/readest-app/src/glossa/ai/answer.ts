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
    if (answer.status === 'answered' && answer.paragraphs.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Answered responses require at least one paragraph',
      });
    }
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

const summaryItemSchema = z
  .object({ text: z.string().trim().min(1), sourceIds: z.array(sourceIdSchema).min(1) })
  .strict();

const conceptSchema = z
  .object({
    term: z.string().trim().min(1),
    explanation: z.string().trim().min(1),
    sourceIds: z.array(sourceIdSchema).min(1),
  })
  .strict();

/** Model-neutral F02 protocol. Every document-derived field has local evidence. */
export const glossaChapterSummarySchema = z
  .object({
    status: z.enum(['summarized', 'insufficient_evidence']),
    corePoints: z.array(summaryItemSchema).max(5),
    evidence: z.array(summaryItemSchema).max(5),
    concepts: z.array(conceptSchema).max(8),
    openQuestions: z.array(summaryItemSchema).max(5),
  })
  .strict()
  .superRefine((summary, context) => {
    const items = [summary.corePoints, summary.evidence, summary.concepts, summary.openQuestions];
    if (summary.status === 'insufficient_evidence' && items.some((item) => item.length > 0)) {
      context.addIssue({
        code: 'custom',
        message: 'Insufficient-evidence summaries cannot include content',
      });
    }
    if (
      summary.status === 'summarized' &&
      (summary.corePoints.length === 0 || summary.evidence.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Summaries require core points and evidence',
      });
    }
  });

export type GlossaChapterSummary = z.infer<typeof glossaChapterSummarySchema>;

export type ValidatedGlossaChapterSummary = {
  summary: GlossaChapterSummary;
  citations: LocalCitation[];
  /** Citations are resolved per core point so the UI cannot merge summary sources. */
  corePointCitations: LocalCitation[][];
};

export type ValidatedGlossaResult = ValidatedGlossaAnswer | ValidatedGlossaChapterSummary;

export type GlossaAnswerValidation =
  | { ok: true; answer: GlossaAnswer; citations: LocalCitation[] }
  | {
      ok: false;
      reason: 'invalid-schema' | 'unknown-source-id' | 'duplicate-source-id' | 'external-basis';
    };

export type GlossaChapterSummaryValidation =
  | {
      ok: true;
      summary: GlossaChapterSummary;
      citations: LocalCitation[];
      corePointCitations: LocalCitation[][];
    }
  | {
      ok: false;
      reason: 'invalid-schema' | 'unknown-source-id' | 'duplicate-source-id';
    };

const citationsForSourceLists = (
  sourceLists: string[][],
  contextPack: ContextPack,
):
  | { ok: true; citations: LocalCitation[] }
  | { ok: false; reason: 'unknown-source-id' | 'duplicate-source-id' } => {
  const sources = new Map(contextPack.segments.map((segment) => [segment.sourceId, segment]));
  const citationIds: string[] = [];
  for (const sourceIds of sourceLists) {
    const seenInItem = new Set<string>();
    for (const sourceId of sourceIds) {
      if (seenInItem.has(sourceId)) return { ok: false, reason: 'duplicate-source-id' };
      seenInItem.add(sourceId);
      if (!sources.has(sourceId)) return { ok: false, reason: 'unknown-source-id' };
      if (!citationIds.includes(sourceId)) citationIds.push(sourceId);
    }
  }
  return {
    ok: true,
    citations: citationIds.flatMap((sourceId) => {
      const source = sources.get(sourceId);
      return source
        ? [{ sourceId: source.sourceId, text: source.text, anchor: source.anchor }]
        : [];
    }),
  };
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
  for (const paragraph of parsed.data.paragraphs) {
    if (paragraph.basis === 'external') return { ok: false, reason: 'external-basis' };
  }
  const citations = citationsForSourceLists(
    parsed.data.paragraphs.map((paragraph) => paragraph.sourceIds),
    contextPack,
  );
  if (!citations.ok) return citations;
  return {
    ok: true,
    answer: parsed.data,
    citations: citations.citations,
  };
}

/** Resolve F02 source IDs only from the ContextPack supplied for this request. */
export function validateGlossaChapterSummary(
  value: unknown,
  contextPack: ContextPack,
): GlossaChapterSummaryValidation {
  const parsed = glossaChapterSummarySchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'invalid-schema' };
  const corePointCitations: LocalCitation[][] = [];
  for (const corePoint of parsed.data.corePoints) {
    const citations = citationsForSourceLists([corePoint.sourceIds], contextPack);
    if (!citations.ok) return citations;
    corePointCitations.push(citations.citations);
  }
  const citations = citationsForSourceLists(
    [
      ...parsed.data.corePoints.map((item) => item.sourceIds),
      ...parsed.data.evidence.map((item) => item.sourceIds),
      ...parsed.data.concepts.map((item) => item.sourceIds),
      ...parsed.data.openQuestions.map((item) => item.sourceIds),
    ],
    contextPack,
  );
  if (!citations.ok) return citations;
  return {
    ok: true,
    summary: parsed.data,
    citations: citations.citations,
    corePointCitations,
  };
}
