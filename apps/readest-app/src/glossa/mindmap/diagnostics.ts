import { z } from 'zod';
import type { CompletionMessage } from '@/glossa/ai/provider';
import { PassageError } from '@/glossa/passages/types';
import { stubTranslation as _ } from '@/utils/misc';

const fieldSchema = z.enum([
  'response',
  'map',
  'nodes',
  'id',
  'parentId',
  'label',
  'relation',
  'explanation',
  'sourceIds',
  'kind',
  'insufficientEvidence',
  'coveredSourceIds',
  'points',
  'text',
]);
const ruleSchema = z.enum([
  'invalid_json',
  'invalid_type',
  'too_big',
  'too_small',
  'invalid_value',
  'invalid_format',
  'unrecognized_keys',
  'invalid_union',
  'custom',
  'complete_coverage',
  'source_whitelist',
]);
/** Only known field names, indices and codes may be persisted or put in repair prompts. */
export const mapDiagnosticSchema = z
  .object({
    kind: z.enum(['format', 'structure', 'coverage', 'sources']),
    issues: z
      .array(
        z
          .object({
            path: z.array(z.union([fieldSchema, z.number().int().min(0).max(4800)])).max(8),
            rule: ruleSchema,
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export type MapDiagnostic = z.infer<typeof mapDiagnosticSchema>;

export const mapDiagnosticMessage = (kind: MapDiagnostic['kind']): string => {
  switch (kind) {
    case 'format':
      return _(
        'The model returned unreadable JSON. Continue to retry with corrected instructions.',
      );
    case 'structure':
      return _('The model returned an invalid mind map structure. Continue to repair it.');
    case 'coverage':
      return _('The model omitted part of the reading range. Continue to complete it.');
    case 'sources':
      return _('The model cited a source outside the supplied evidence. Continue to correct it.');
  }
};

export class MapOutputError extends PassageError {
  constructor(public readonly diagnostic: MapDiagnostic) {
    super('invalid-response', mapDiagnosticMessage(diagnostic.kind));
  }
}

export function mapSchemaError(error: z.ZodError): MapOutputError {
  return new MapOutputError({
    kind: error.issues.some((issue) => issue.path[0] === 'coveredSourceIds')
      ? 'coverage'
      : 'structure',
    issues: error.issues.slice(0, 8).map((issue) => ({
      path: issue.path.slice(0, 8).map((part) => {
        if (typeof part === 'number' && Number.isInteger(part) && part >= 0 && part <= 4800)
          return part;
        const parsed = fieldSchema.safeParse(part);
        return parsed.success ? parsed.data : 'response';
      }),
      rule: ruleSchema.safeParse(issue.code).success
        ? (issue.code as MapDiagnostic['issues'][number]['rule'])
        : 'custom',
    })),
  });
}

export function repairMapMessages(
  messages: CompletionMessage[],
  diagnostic?: MapDiagnostic,
): CompletionMessage[] {
  if (!diagnostic) return messages;
  const feedback = diagnostic.issues
    .map((issue) => `${issue.path.join('.') || 'response'}: ${issue.rule}`)
    .join('; ');
  return messages.map((message, i) =>
    i === 0
      ? {
          ...message,
          content: `${message.content}\nPrevious response failed validation (${diagnostic.kind}): ${feedback}. Generate a corrected COMPLETE response using the same supplied material and the exact JSON contract. Keep every required field and all coverage IDs; shorten wording to meet limits without dropping main ideas, conditions or evidence. Cite only IDs actually provided in this request. Never guess a missing source or claim success without completing the contract.`,
        }
      : message,
  );
}
