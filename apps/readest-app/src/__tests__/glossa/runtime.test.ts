import { describe, expect, it } from 'vitest';
import { getGlossaRuntimeSafetyError } from '@/glossa/runtime';

describe('getGlossaRuntimeSafetyError', () => {
  it('does nothing when Glossa is disabled', () => {
    expect(
      getGlossaRuntimeSafetyError({
        enabled: false,
        expectedIdentifier: undefined,
        actualIdentifier: 'com.bilingify.readest',
        portable: true,
      }),
    ).toBeNull();
  });

  it('requires an explicitly declared isolated identity', () => {
    expect(getGlossaRuntimeSafetyError({ enabled: true, portable: false })).toContain(
      'isolated runtime identity',
    );
  });

  it('rejects portable storage before any application data is prepared', () => {
    expect(
      getGlossaRuntimeSafetyError({
        enabled: true,
        expectedIdentifier: 'app.glossa.reader.dev',
        portable: true,
      }),
    ).toContain('cannot use portable storage');
  });

  it('rejects Readest identity when Glossa expects its development identity', () => {
    expect(
      getGlossaRuntimeSafetyError({
        enabled: true,
        expectedIdentifier: 'app.glossa.reader.dev',
        actualIdentifier: 'com.bilingify.readest',
        portable: false,
      }),
    ).toContain('runtime identity mismatch');
  });

  it('accepts the isolated Glossa development identity', () => {
    expect(
      getGlossaRuntimeSafetyError({
        enabled: true,
        expectedIdentifier: 'app.glossa.reader.dev',
        actualIdentifier: 'app.glossa.reader.dev',
        portable: false,
      }),
    ).toBeNull();
  });
});
