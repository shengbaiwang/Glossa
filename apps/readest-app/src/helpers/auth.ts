import { User } from '@supabase/supabase-js';
import { isGlossaAuthConfigured } from '@/glossa/account/config';
import { supabase } from '@/utils/supabase';
import { getAppScheme } from '@/services/appIdentity';

interface UseAuthCallbackOptions {
  accessToken?: string | null;
  refreshToken?: string | null;
  login: (accessToken: string, user: User) => void;
  navigate: (path: string) => void;
  type?: string | null;
  next?: string;
  error?: string | null;
  errorCode?: string | null;
  errorDescription?: string | null;
}

export interface OAuthCallbackParams {
  accessToken: string | null;
  refreshToken: string | null;
  type: string | null;
  next: string | null;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}

// OAuth callbacks may carry data in the URL fragment (implicit flow tokens) or
// the query string (provider/GoTrue errors), so we read from both.
export function parseOAuthCallbackUrl(url: string): OAuthCallbackParams {
  const hashParams = new URLSearchParams(url.match(/#(.*)/)?.[1] ?? '');
  const queryParams = new URLSearchParams(url.match(/\?([^#]*)/)?.[1] ?? '');
  const getParam = (key: string) => hashParams.get(key) ?? queryParams.get(key);
  return {
    accessToken: getParam('access_token'),
    refreshToken: getParam('refresh_token'),
    type: getParam('type'),
    next: getParam('next'),
    error: getParam('error'),
    errorCode: getParam('error_code'),
    errorDescription: getParam('error_description'),
  };
}

export const safeAuthReturnPath = (path?: string | null): string =>
  path && /^\/(?![\/\\])[^\\\x00-\x1f]*$/.test(path) ? path : '/library';

/** Match the registered callback, not an arbitrary URL containing tokens. */
export function isAppAuthCallbackUrl(url: string, scheme = getAppScheme()): boolean {
  try {
    const target = new URL(url);
    return (
      target.protocol.toLowerCase() === `${scheme}:` &&
      target.hostname.toLowerCase() === 'auth-callback' &&
      !target.username &&
      !target.password &&
      !target.port &&
      (target.pathname === '' || target.pathname === '/')
    );
  } catch {
    return false;
  }
}

let pendingCallbacks = 0;
export const isAuthCallbackInProgress = (): boolean => pendingCallbacks > 0;

export async function handleAuthCallback({
  accessToken,
  refreshToken,
  login,
  navigate,
  type,
  next,
  error,
}: UseAuthCallbackOptions): Promise<boolean> {
  if (!isGlossaAuthConfigured() || error) {
    navigate('/auth/error');
    return false;
  }
  if (!accessToken || !refreshToken) {
    navigate('/library');
    return false;
  }
  pendingCallbacks++;
  try {
    const { data, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) throw sessionError;
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw new Error('Unable to verify account');
    login(data?.session?.access_token ?? accessToken, user);
    navigate(type === 'recovery' ? '/auth/recovery' : safeAuthReturnPath(next));
    return true;
  } catch {
    navigate('/auth/error');
    return false;
  } finally {
    pendingCallbacks--;
  }
}

// Only retain raw callback URLs while processing; never persist credentials in
// history or sessionStorage. A digest prevents a cold-start URL from restoring
// a session again after an explicit sign-out and WebView reload.
const nativeCallbacks = new Map<string, Promise<void>>();
export function handleNativeAuthCallback(
  url: string,
  options: Pick<UseAuthCallbackOptions, 'login' | 'navigate'>,
): Promise<void> {
  if (!isGlossaAuthConfigured() || !isAppAuthCallbackUrl(url)) return Promise.resolve();
  const existing = nativeCallbacks.get(url);
  if (existing) return existing;
  const task = (async () => {
    let fingerprint: string | undefined;
    try {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
      fingerprint = Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      if (sessionStorage.getItem('glossa-auth-callback') === fingerprint) return;
    } catch {
      // Secure-storage/crypto restrictions must not prevent a live callback.
    }
    const params = parseOAuthCallbackUrl(url);
    const authenticated = await handleAuthCallback({
      ...params,
      ...options,
      next: params.next ?? undefined,
    });
    if (authenticated && fingerprint) {
      try {
        sessionStorage.setItem('glossa-auth-callback', fingerprint);
      } catch {
        // The application-level receiver still consumes the launch URL once.
      }
    }
  })().finally(() => nativeCallbacks.delete(url));
  nativeCallbacks.set(url, task);
  return task;
}
