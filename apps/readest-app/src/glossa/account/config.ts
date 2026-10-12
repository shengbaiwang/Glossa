import { getRuntimeConfig } from '@/services/runtimeConfig';

export interface GlossaAuthConfig {
  url: string;
  key: string;
  storageKey: string;
}

/** Identity-only configuration. Never inherit upstream service defaults. */
export const getGlossaAuthConfig = (): GlossaAuthConfig | null => {
  const runtime = getRuntimeConfig();
  const rawUrl = runtime?.glossaAuthUrl ?? process.env['NEXT_PUBLIC_GLOSSA_AUTH_URL'];
  const key = (runtime?.glossaAuthKey ?? process.env['NEXT_PUBLIC_GLOSSA_AUTH_KEY'])?.trim();
  if (!rawUrl?.trim() || !key?.trim() || key.startsWith('sb_secret_')) return null;
  if (key.split('.').length === 3) {
    try {
      const claims: unknown = JSON.parse(
        atob(key.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')),
      );
      if (typeof claims !== 'object' || !claims || !('role' in claims) || claims.role !== 'anon')
        return null;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(rawUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return {
      url: url.toString().replace(/\/$/, ''),
      key: key.trim(),
      storageKey: `glossa-auth-${url.host}${url.pathname.replace(/\/$/, '')}`,
    };
  } catch {
    return null;
  }
};

export const isGlossaAuthConfigured = (): boolean => getGlossaAuthConfig() !== null;

/** This product has no first-party cloud storage or server replica service. */
export const isNativeCloudSyncAvailable = (): boolean => false;

export const getGlossaAuthRedirectUrl = (): string | undefined =>
  (
    getRuntimeConfig()?.glossaAuthRedirectUrl ?? process.env['NEXT_PUBLIC_GLOSSA_AUTH_REDIRECT_URL']
  )?.trim() || undefined;

/** Show only providers explicitly enabled on Glossa's own auth project. */
export const getGlossaIdentityProviders = (): Array<'google' | 'apple' | 'azure'> => {
  const configured =
    process.env['NEXT_PUBLIC_GLOSSA_AUTH_PROVIDERS']?.split(',').map((value) => value.trim()) ?? [];
  return (['apple', 'google', 'azure'] as const).filter((provider) =>
    configured.includes(provider),
  );
};

export const getGlossaDeleteAccountFunction = (): string | undefined =>
  process.env['NEXT_PUBLIC_GLOSSA_AUTH_DELETE_FUNCTION'];
