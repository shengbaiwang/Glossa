import { describe, expect, test } from 'vitest';

import { estimateDeepSeekCost } from '@/glossa/ai';

const usage = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheHitTokens: 500_000,
  cacheMissTokens: 500_000,
};

describe('DeepSeek local pricing', () => {
  test('uses the currently effective V4 Flash rate before the peak/off-peak change', () => {
    expect(
      estimateDeepSeekCost('deepseek-v4-flash', usage, new Date('2026-08-16T15:59:59.999Z')),
    ).toMatchObject({
      currency: 'USD',
      rateVersion: 'deepseek-v4-flash-0731-usd-v1',
      ratePeriod: 'standard',
      cost: 0.3514,
    });
  });

  test.each([
    ['off-peak before the first peak window', '2026-08-17T00:59:59.999Z', 'off-peak', 0.7735],
    ['peak at 01:00 UTC', '2026-08-17T01:00:00.000Z', 'peak', 1.547],
    ['off-peak at 04:00 UTC', '2026-08-17T04:00:00.000Z', 'off-peak', 0.7735],
    ['peak at 06:00 UTC', '2026-08-17T06:00:00.000Z', 'peak', 1.547],
    ['off-peak at 10:00 UTC', '2026-08-17T10:00:00.000Z', 'off-peak', 0.7735],
  ])('uses %s', (_label, timestamp, ratePeriod, cost) => {
    expect(estimateDeepSeekCost('deepseek-v4-flash', usage, new Date(timestamp))).toMatchObject({
      ratePeriod,
      cost,
    });
  });

  test('does not estimate an unsupported model or incomplete actual cache usage', () => {
    expect(estimateDeepSeekCost('mock-v1', usage, new Date('2026-08-17T02:00:00Z'))).toBeNull();
  });
});
