import { z } from 'zod';

const count = z.number().int().nonnegative().max(10000000);
export const traceStageSchema = z.enum([
  'history',
  'plan',
  'read',
  'search',
  'inventory',
  'answer',
  'validation',
]);
const eventSchema = z
  .object({
    stage: traceStageSchema,
    outcome: z.enum([
      'started',
      'complete',
      'cache_hit',
      'repair',
      'format',
      'structure',
      'coverage',
      'sources',
      'failed',
      'cancelled',
      'timeout',
    ]),
    elapsedMs: z.number().finite().nonnegative(),
    sources: count.optional(),
    characters: count.optional(),
    calls: count.optional(),
  })
  .strict();
export const runTraceSchema = z
  .object({ version: z.literal(1), events: z.array(eventSchema).max(96) })
  .strict();
export type RunTrace = z.infer<typeof runTraceSchema>;
export type TraceStage = z.infer<typeof traceStageSchema>;

/** No free-form strings or source IDs: a diagnostic receipt, never a transcript. */
export function createRunTrace(onChange?: (trace: RunTrace) => void) {
  const started = Date.now();
  const events: RunTrace['events'] = [];
  const snapshot = (): RunTrace => ({ version: 1, events: events.map((event) => ({ ...event })) });
  return {
    snapshot,
    add(
      stage: TraceStage,
      outcome: RunTrace['events'][number]['outcome'],
      counts: { sources?: number; characters?: number; calls?: number } = {},
    ) {
      const parsed = eventSchema.safeParse({
        stage,
        outcome,
        elapsedMs: Math.max(0, Date.now() - started),
        sources: counts.sources,
        characters: counts.characters,
        calls: counts.calls,
      });
      if (!parsed.success) return;
      events.push(parsed.data);
      if (events.length > 96) events.shift();
      onChange?.(snapshot());
    },
  };
}
