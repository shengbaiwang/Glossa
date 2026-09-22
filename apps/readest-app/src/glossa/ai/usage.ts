import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const tokenUsageSchema = z
  .object({
    inputTokens: count.optional(),
    outputTokens: count.optional(),
    totalTokens: count.optional(),
    cachedTokens: count.optional(),
    reasoningTokens: count.optional(),
  })
  .strict();
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

const amount = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const providerCostSchema = z
  .object({ amount, currency: z.literal('USD').optional() })
  .strict();
export type ProviderCost = z.infer<typeof providerCostSchema>;

/** usage.cost is the account charge, not the additional cost_details upstream breakdown. */
export function readProviderCost(value: unknown, baseUrl: string): ProviderCost | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const parsed = amount.safeParse((value as Record<string, unknown>)['cost']);
  if (!parsed.success) return;
  // OpenRouter credits are USD. Compatible relays may use another currency or credits;
  // their name/model alone is not evidence of a dollar-denominated charge.
  let currency: 'USD' | undefined;
  try {
    if (new URL(baseUrl).hostname === 'openrouter.ai') currency = 'USD';
  } catch {
    // Optional metadata must never invalidate a usable answer.
  }
  return { amount: parsed.data, ...(currency ? { currency } : {}) };
}

export const completionMetricsSchema = z
  .object({
    id: z.string().min(1).max(100),
    outputBudget: count.min(1).max(65536),
    elapsedMs: z.number().finite().nonnegative(),
    finished: z.boolean(),
    usage: tokenUsageSchema.optional(),
    cost: providerCostSchema.optional(),
  })
  .strict();
export type CompletionMetrics = z.infer<typeof completionMetricsSchema>;

/** Provider usage is optional metadata, never a reason to discard an otherwise valid answer. */
export function readTokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  const detail = (key: string, field: string) => {
    const nested = raw[key];
    return nested && typeof nested === 'object' && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)[field]
      : undefined;
  };
  const usage: TokenUsage = {};
  const fields = {
    inputTokens: raw['prompt_tokens'],
    outputTokens: raw['completion_tokens'],
    totalTokens: raw['total_tokens'],
    cachedTokens:
      detail('prompt_tokens_details', 'cached_tokens') ?? raw['prompt_cache_hit_tokens'],
    reasoningTokens: detail('completion_tokens_details', 'reasoning_tokens'),
  };
  for (const key of Object.keys(fields) as (keyof TokenUsage)[]) {
    const parsed = count.safeParse(fields[key]);
    if (parsed.success) usage[key] = parsed.data;
  }
  if (usage.inputTokens !== undefined && (usage.cachedTokens ?? 0) > usage.inputTokens)
    delete usage.cachedTokens;
  if (usage.outputTokens !== undefined && (usage.reasoningTokens ?? 0) > usage.outputTokens)
    delete usage.reasoningTokens;
  if (
    usage.totalTokens === undefined &&
    usage.inputTokens !== undefined &&
    usage.outputTokens !== undefined
  ) {
    const total = usage.inputTokens + usage.outputTokens;
    if (Number.isSafeInteger(total)) usage.totalTokens = total;
  }
  return Object.keys(usage).length ? usage : undefined;
}
