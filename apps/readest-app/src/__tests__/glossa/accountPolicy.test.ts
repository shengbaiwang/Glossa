import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getGlossaAuthConfig,
  getGlossaAuthRedirectUrl,
  getGlossaIdentityProviders,
} from '@/glossa/account/config';
import { isCloudSyncAllowed } from '@/utils/access';
import { getCloudSyncProviders, resolveCloudSyncGate } from '@/services/sync/cloudSyncProvider';
import type { SystemSettings } from '@/types/settings';

afterEach(() => vi.unstubAllEnvs());

describe('Glossa account and personal cloud boundary', () => {
  it('does not inherit the upstream authentication project', () => {
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_URL', '');
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://legacy.example');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'legacy-key');
    expect(getGlossaAuthConfig()).toBeNull();
  });

  it('uses only an explicitly configured independent project', () => {
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_URL', 'https://glossa.example');
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_KEY', 'publishable-key');
    expect(getGlossaAuthConfig()).toMatchObject({
      url: 'https://glossa.example',
      key: 'publishable-key',
    });
  });

  it('an empty optional redirect uses the platform callback', () => {
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_REDIRECT_URL', '  ');
    expect(getGlossaAuthRedirectUrl()).toBeUndefined();
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_REDIRECT_URL', ' https://glossa.example/auth/callback ');
    expect(getGlossaAuthRedirectUrl()).toBe('https://glossa.example/auth/callback');
  });

  it('rejects incomplete and insecure remote authentication configuration', () => {
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_URL', 'https://glossa.example');
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_KEY', '');
    expect(getGlossaAuthConfig()).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_KEY', 'publishable-key');
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_URL', 'http://remote.example');
    expect(getGlossaAuthConfig()).toBeNull();
  });

  it('rejects secret server keys and shows only enabled identity providers', () => {
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_URL', 'https://glossa.example');
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_KEY', 'sb_secret_private');
    expect(getGlossaAuthConfig()).toBeNull();
    const serviceKey = 'header.' + btoa(JSON.stringify({ role: 'service_role' })) + '.signature';
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_KEY', serviceKey);
    expect(getGlossaAuthConfig()).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_PROVIDERS', 'apple, azure, unknown');
    expect(getGlossaIdentityProviders()).toEqual(['apple', 'azure']);
  });

  it('does not require a paid plan or fall back to native cloud storage', () => {
    expect(isCloudSyncAllowed('free')).toBe(true);
    const settings = {
      readestCloud: { enabled: true },
      googleDrive: { enabled: true },
      onedrive: { enabled: true },
      icloud: { enabled: true },
    } as SystemSettings;
    expect(resolveCloudSyncGate(settings, 'free')).toEqual({
      readest: false,
      backends: ['gdrive', 'onedrive', 'icloud'],
      paused: false,
    });
    expect(getCloudSyncProviders({} as SystemSettings)).toEqual([]);
    expect(settings.readestCloud?.enabled).toBe(true);
  });
});
