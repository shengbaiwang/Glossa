import { z } from 'zod';
import {
  completionMetricsSchema,
  type CompletionMetrics,
  type ProviderCost,
  type TokenUsage,
} from '@/glossa/ai/usage';

export const replyUsageSchema = z
  .object({
    elapsedMs: z.number().finite().nonnegative(),
    firstTextMs: z.number().finite().nonnegative().optional(),
    requests: z.array(completionMetricsSchema).max(36),
  })
  .strict()
  .refine((value) => new Set(value.requests.map((item) => item.id)).size === value.requests.length);
export type ReplyUsage = z.infer<typeof replyUsageSchema>;

/** One answer attempt, including hidden reading steps/recovery, excluding the later title request. */
export function createReplyUsage() {
  const start = performance.now();
  const requests = new Map<string, { metrics: CompletionMetrics; updatedAt: number }>();
  let firstTextMs: number | undefined;
  return {
    onMetrics(value: CompletionMetrics) {
      const parsed = completionMetricsSchema.safeParse(value);
      if (!parsed.success || (!requests.has(value.id) && requests.size >= 36)) return;
      requests.set(value.id, { metrics: parsed.data, updatedAt: performance.now() });
    },
    onText(text: string) {
      if (text.trim() && firstTextMs === undefined) firstTextMs = performance.now() - start;
    },
    snapshot(): ReplyUsage {
      const now = performance.now();
      return {
        elapsedMs: now - start,
        ...(firstTextMs !== undefined ? { firstTextMs } : {}),
        requests: [...requests.values()].map(({ metrics, updatedAt }) => ({
          ...metrics,
          elapsedMs: metrics.elapsedMs + (metrics.finished ? 0 : now - updatedAt),
        })),
      };
    },
  };
}

/** Missing values stay unknown; partial sums are explicitly marked by the UI. */
export function sumReplyTokens(usage: ReplyUsage, key: keyof TokenUsage) {
  const values = usage.requests.flatMap((item) =>
    item.usage?.[key] === undefined ? [] : [item.usage[key]!],
  );
  return values.length
    ? {
        value: values.reduce((sum, value) => sum + value, 0),
        partial: values.length < usage.requests.length,
      }
    : undefined;
}

/** Separate unknown units from USD, and never substitute zero for an unreported charge. */
export function sumReplyCosts(usage: ReplyUsage) {
  const totals = new Map<ProviderCost['currency'], ProviderCost>();
  let reported = 0;
  for (const { cost } of usage.requests) {
    if (!cost) continue;
    reported++;
    const previous = totals.get(cost.currency);
    totals.set(cost.currency, { ...cost, amount: (previous?.amount ?? 0) + cost.amount });
  }
  return reported
    ? { totals: [...totals.values()], reported, partial: reported < usage.requests.length }
    : undefined;
}
