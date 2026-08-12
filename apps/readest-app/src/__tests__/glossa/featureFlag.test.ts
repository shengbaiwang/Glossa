import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { isGlossaEnabled } from '@/glossa';

const env = process.env as Record<string, string | undefined>;
const flagName = 'NEXT_PUBLIC_GLOSSA_ENABLED';
const originalFlagValue = env[flagName];

beforeEach(() => {
  delete env[flagName];
});

afterEach(() => {
  if (originalFlagValue === undefined) {
    delete env[flagName];
  } else {
    env[flagName] = originalFlagValue;
  }
});

describe('Glossa feature flag', () => {
  test('is disabled by default', () => {
    expect(isGlossaEnabled()).toBe(false);
  });

  test('is enabled only by an explicit true value', () => {
    env[flagName] = 'true';

    expect(isGlossaEnabled()).toBe(true);
  });
});
