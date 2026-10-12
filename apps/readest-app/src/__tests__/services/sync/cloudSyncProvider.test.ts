import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/utils/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/access')>();
  return {
    ...actual,
    isCloudSyncAllowed: vi.fn(actual.isCloudSyncAllowed),
  };
});

import {
  applySyncBooksAutoEnable,
  cloudProviderDisplayName,
  cloudProvidersDisplayName,
  getActiveFileSyncBackends,
  getCloudSyncProviders,
  getEnabledFileSyncBackends,
  isReadestCloudEnabled,
  isReadestCloudStorageActive,
  resolveCloudSyncGate,
  setCachedUserPlan,
  settingsKeyForBackend,
} from '@/services/sync/cloudSyncProvider';
import { isCloudSyncAllowed } from '@/utils/access';

const makeSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    webdav: { enabled: false },
    googleDrive: { enabled: false },
    ...overrides,
  }) as SystemSettings;

const s = (partial: Partial<SystemSettings>): SystemSettings => partial as SystemSettings;

beforeEach(() => {
  vi.mocked(isCloudSyncAllowed).mockReturnValue(true);
  setCachedUserPlan('free');
});

describe('resolveCloudSyncGate', () => {
  test('native cloud remains disabled', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    expect(resolveCloudSyncGate(makeSettings(), 'free')).toEqual({
      readest: false,
      backends: [],
      paused: false,
    });
  });

  test('third-party provider stays enabled but paused when disallowed (no silent readest fallback)', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(resolveCloudSyncGate(settings, 'free')).toEqual({
      readest: false,
      backends: ['webdav'],
      paused: true,
    });
  });

  test('third-party provider is active when allowed', () => {
    const settings = makeSettings({ googleDrive: { enabled: true } } as Partial<SystemSettings>);
    expect(resolveCloudSyncGate(settings, 'plus')).toEqual({
      readest: false,
      backends: ['gdrive'],
      paused: false,
    });
  });

  test('falls back to the cached user plan when no plan argument is given', () => {
    vi.mocked(isCloudSyncAllowed).mockImplementation((plan) => plan !== 'free');
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);

    setCachedUserPlan('free');
    expect(resolveCloudSyncGate(settings).paused).toBe(true);

    setCachedUserPlan('pro');
    expect(resolveCloudSyncGate(settings).paused).toBe(false);
  });

  test('undefined cached plan is treated as free', () => {
    vi.mocked(isCloudSyncAllowed).mockImplementation((plan) => plan !== 'free');
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    setCachedUserPlan(undefined);
    expect(resolveCloudSyncGate(settings).paused).toBe(true);
  });
});

describe('applySyncBooksAutoEnable (upgrade migration for already-enabled providers)', () => {
  test('flips syncBooks on for an enabled webdav provider, mutating the given settings', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.webdav?.syncBooks).toBe(true);
  });

  test('flips syncBooks on for an enabled gdrive provider', () => {
    const settings = makeSettings({
      googleDrive: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.googleDrive?.syncBooks).toBe(true);
  });

  test('no-op when readest is the provider', () => {
    const settings = makeSettings();
    expect(applySyncBooksAutoEnable(settings)).toBe(false);
    expect(settings.webdav?.syncBooks).toBeUndefined();
  });

  test('no-op when syncBooks is already on', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: true },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(false);
  });

  test('flips syncBooks on for every enabled provider when multiple are enabled', () => {
    const settings = makeSettings({
      webdav: { enabled: true, syncBooks: false },
      googleDrive: { enabled: true, syncBooks: false },
    } as Partial<SystemSettings>);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.webdav?.syncBooks).toBe(true);
    expect(settings.googleDrive?.syncBooks).toBe(true);
  });
});

describe('isReadestCloudStorageActive', () => {
  test('false when no personal cloud is selected', () => {
    expect(isReadestCloudStorageActive(makeSettings())).toBe(false);
  });

  test('false when a third-party provider is selected', () => {
    const settings = makeSettings({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(isReadestCloudStorageActive(settings)).toBe(false);
  });

  test('false while paused: uploads must not silently resume to Readest Cloud', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    const settings = makeSettings({ googleDrive: { enabled: true } } as Partial<SystemSettings>);
    expect(isReadestCloudStorageActive(settings, 'free')).toBe(false);
  });
});

describe('settingsKeyForBackend', () => {
  test('maps each backend kind to its settings slice', () => {
    expect(settingsKeyForBackend('webdav')).toBe('webdav');
    expect(settingsKeyForBackend('gdrive')).toBe('googleDrive');
    expect(settingsKeyForBackend('s3')).toBe('s3');
    expect(settingsKeyForBackend('onedrive')).toBe('onedrive');
  });
});

describe('cloudProviderDisplayName', () => {
  test('names every provider kind', () => {
    expect(cloudProviderDisplayName('webdav')).toBe('WebDAV');
    expect(cloudProviderDisplayName('gdrive')).toBe('Google Drive');
    expect(cloudProviderDisplayName('s3')).toBe('S3');
    expect(cloudProviderDisplayName('onedrive')).toBe('OneDrive');
    expect(cloudProviderDisplayName('readest')).toBe('Cloud');
  });
});

// Moved from src/__tests__/services/sync/file/providerRegistry.test.ts: the
// function itself moved from providerRegistry.ts into this module.
describe('getEnabledFileSyncBackends', () => {
  test('lists only switched-on backends in a stable order', () => {
    expect(getEnabledFileSyncBackends(s({}))).toEqual([]);
    expect(getEnabledFileSyncBackends(s({ webdav: { enabled: true } } as never))).toEqual([
      'webdav',
    ]);
    expect(
      getEnabledFileSyncBackends(
        s({ webdav: { enabled: true }, googleDrive: { enabled: true } } as never),
      ),
    ).toEqual(['webdav', 'gdrive']);
    expect(
      getEnabledFileSyncBackends(
        s({ webdav: { enabled: false }, googleDrive: { enabled: true } } as never),
      ),
    ).toEqual(['gdrive']);
  });

  test("getEnabledFileSyncBackends includes 'onedrive' when enabled", () => {
    expect(getEnabledFileSyncBackends(s({ onedrive: { enabled: true } } as never))).toContain(
      'onedrive',
    );
  });
});

describe('isReadestCloudEnabled (derived default)', () => {
  test('absent field does not enable native cloud', () => {
    expect(isReadestCloudEnabled(s({}))).toBe(false);
  });

  test('absent field with a third-party enabled means Readest Cloud is off (legacy exclusive)', () => {
    expect(isReadestCloudEnabled(s({ googleDrive: { enabled: true } as never }))).toBe(false);
  });

  test('legacy explicit true does not enable native cloud', () => {
    const settings = s({
      googleDrive: { enabled: true } as never,
      readestCloud: { enabled: true },
    });
    expect(isReadestCloudEnabled(settings)).toBe(false);
  });

  test('explicit false wins when nothing else is enabled', () => {
    expect(isReadestCloudEnabled(s({ readestCloud: { enabled: false } }))).toBe(false);
  });
});

describe('getCloudSyncProviders', () => {
  test('returns no native cloud by default', () => {
    expect(getCloudSyncProviders(s({}))).toEqual([]);
  });

  test('returns personal clouds in fixed order', () => {
    const settings = s({
      readestCloud: { enabled: true },
      onedrive: { enabled: true } as never,
      webdav: { enabled: true } as never,
    });
    expect(getCloudSyncProviders(settings)).toEqual(['webdav', 'onedrive']);
  });

  test('returns an empty list when everything is off', () => {
    expect(getCloudSyncProviders(s({ readestCloud: { enabled: false } }))).toEqual([]);
  });
});

describe('resolveCloudSyncGate (readest + backends together)', () => {
  test('reports personal clouds without native cloud', () => {
    const settings = s({
      readestCloud: { enabled: true },
      googleDrive: { enabled: true } as never,
    });
    const gate = resolveCloudSyncGate(settings, 'pro');
    expect(gate).toEqual({ readest: false, backends: ['gdrive'], paused: false });
  });

  test('pauses every backend at once on a plan without cloud sync', () => {
    vi.mocked(isCloudSyncAllowed).mockReturnValue(false);
    const settings = s({
      readestCloud: { enabled: true },
      googleDrive: { enabled: true } as never,
      webdav: { enabled: true } as never,
    });
    const gate = resolveCloudSyncGate(settings, 'free');
    // Readest Cloud keeps running because the user asked for it, not as a fallback.
    expect(gate.readest).toBe(false);
    expect(gate.backends).toEqual(['webdav', 'gdrive']);
    expect(gate.paused).toBe(true);
    expect(getActiveFileSyncBackends(settings, 'free')).toEqual([]);
  });
});

describe('isReadestCloudStorageActive (follows the flag, not exclusivity)', () => {
  test('does not restore native cloud from legacy flags', () => {
    const both = s({ readestCloud: { enabled: true }, webdav: { enabled: true } as never });
    expect(isReadestCloudStorageActive(both)).toBe(false);
    const off = s({ readestCloud: { enabled: false }, webdav: { enabled: true } as never });
    expect(isReadestCloudStorageActive(off)).toBe(false);
  });
});

describe('cloudProvidersDisplayName', () => {
  test('joins provider names for the "synced via" copy', () => {
    expect(cloudProvidersDisplayName(['readest', 'gdrive'])).toBe('Cloud, Google Drive');
  });
});

describe('icloud backend kind', () => {
  test('getEnabledFileSyncBackends appends icloud last', () => {
    expect(
      getEnabledFileSyncBackends(
        s({ webdav: { enabled: true }, icloud: { enabled: true } } as never),
      ),
    ).toEqual(['webdav', 'icloud']);
  });

  test('settingsKeyForBackend maps icloud to its own slice', () => {
    expect(settingsKeyForBackend('icloud')).toBe('icloud');
  });

  test('cloudProviderDisplayName names iCloud', () => {
    expect(cloudProviderDisplayName('icloud')).toBe('iCloud');
  });

  test('applySyncBooksAutoEnable flips syncBooks on for an enabled icloud', () => {
    const settings = s({ icloud: { enabled: true, syncBooks: false } } as never);
    expect(applySyncBooksAutoEnable(settings)).toBe(true);
    expect(settings.icloud?.syncBooks).toBe(true);
  });
});
