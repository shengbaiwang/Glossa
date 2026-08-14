import type { AIProviderUsage } from './provider';

type DeepSeekRate = {
  cacheHit: number;
  cacheMiss: number;
  output: number;
};

type DeepSeekRatePeriod = 'standard' | 'peak' | 'off-peak';

type DeepSeekRateTable = {
  model: string;
  effectiveAt: string;
  rateVersion: string;
  rates: DeepSeekRate;
  ratePeriod: DeepSeekRatePeriod;
};

export type DeepSeekCostEstimate = {
  cost: number;
  currency: 'USD';
  ratePeriod: DeepSeekRatePeriod;
  rateVersion: string;
};

const TOKENS_PER_MILLION = 1_000_000;

// Source: https://api-docs.deepseek.com/quick_start/pricing/ (captured 2026-08-15).
// The first table reflects the V4-Flash-0731 prices. Its announced successor
// takes effect at 2026-08-16 16:00 UTC and bills 01:00–04:00 and 06:00–10:00
// UTC as peak; all other UTC hours are off-peak. This is intentionally local:
// estimates must never fetch prices or send reading data at runtime.
const STANDARD_RATES: readonly DeepSeekRateTable[] = [
  {
    model: 'deepseek-v4-flash',
    effectiveAt: '2026-07-31T00:00:00.000Z',
    rateVersion: 'deepseek-v4-flash-0731-usd-v1',
    ratePeriod: 'standard',
    rates: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
  },
];

const PEAK_OFF_PEAK_EFFECTIVE_AT = '2026-08-16T16:00:00.000Z';

const isPeakUtcHour = (hour: number): boolean =>
  (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);

const rateFor = (model: string, at: Date): DeepSeekRateTable | null => {
  const timestamp = at.getTime();
  if (!Number.isFinite(timestamp)) return null;
  if (model !== 'deepseek-v4-flash') return null;

  if (timestamp >= Date.parse(PEAK_OFF_PEAK_EFFECTIVE_AT)) {
    const peak = isPeakUtcHour(at.getUTCHours());
    return {
      model,
      effectiveAt: PEAK_OFF_PEAK_EFFECTIVE_AT,
      rateVersion: 'deepseek-v4-flash-peak-off-peak-usd-2026-08-16-v1',
      ratePeriod: peak ? 'peak' : 'off-peak',
      rates: peak
        ? { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 }
        : { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
    };
  }

  const applicable = STANDARD_RATES.filter(
    (rate) => rate.model === model && timestamp >= Date.parse(rate.effectiveAt),
  ).at(-1);
  return applicable ?? null;
};

/** Returns null rather than guessing when the provider/model/rate is unknown. */
export const estimateDeepSeekCost = (
  model: string | null,
  usage: AIProviderUsage,
  at: Date,
): DeepSeekCostEstimate | null => {
  if (!model) return null;
  const rate = rateFor(model, at);
  if (!rate) return null;
  const cost =
    (usage.cacheHitTokens * rate.rates.cacheHit +
      usage.cacheMissTokens * rate.rates.cacheMiss +
      usage.outputTokens * rate.rates.output) /
    TOKENS_PER_MILLION;
  return {
    cost,
    currency: 'USD',
    ratePeriod: rate.ratePeriod,
    rateVersion: rate.rateVersion,
  };
};
