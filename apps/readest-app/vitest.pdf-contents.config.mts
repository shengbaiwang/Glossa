import { mergeConfig } from 'vitest/config';
import base from './vitest.config.mts';

export default mergeConfig(base, {
  test: {
    include: ['scripts/pdf-contents-eval/run.eval.ts'],
    maxWorkers: 1,
    testTimeout: 600_000,
    silent: false,
  },
});
