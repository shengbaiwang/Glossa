import { webcrypto } from 'node:crypto';
import { StrictMode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  login: vi.fn(),
  getCurrent: vi.fn(),
  setSession: vi.fn(),
  getUser: vi.fn(),
  removeUrl: vi.fn(),
  removeInstance: vi.fn(),
  urls: null as null | ((urls: string[]) => void),
  instance: null as null | ((event: { payload: { args: string[] } }) => void),
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ login: mocks.login }) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/supabase', () => ({
  supabase: { auth: { setSession: mocks.setSession, getUser: mocks.getUser } },
}));
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: mocks.getCurrent,
  onOpenUrl: vi.fn(async (receive: typeof mocks.urls) => {
    mocks.urls = receive;
    return mocks.removeUrl;
  }),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: vi.fn(async (_event: string, receive: typeof mocks.instance) => {
      mocks.instance = receive;
      return mocks.removeInstance;
    }),
  }),
}));

import NativeAuthCallback from '@/components/NativeAuthCallback';
import {
  handleNativeAuthCallback,
  isAppAuthCallbackUrl,
  isAuthCallbackInProgress,
} from '@/helpers/auth';

const recovery = 'glossa://auth-callback#access_token=original&refresh_token=refresh&type=recovery';
const user = { id: 'original-user' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_URL', 'https://auth.glossa.test');
  vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_KEY', 'fixture-public-key');
  vi.stubEnv('NEXT_PUBLIC_GLOSSA_RUNTIME_ID', 'app.glossa.reader');
  sessionStorage.clear();
  mocks.getCurrent.mockResolvedValue(null);
  mocks.setSession.mockResolvedValue({
    data: { session: { access_token: 'verified' } },
    error: null,
  });
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('native identity callbacks across pages and restarts', () => {
  it('accepts only the exact callback of this app, including an optional trailing slash', () => {
    expect(isAppAuthCallbackUrl(recovery)).toBe(true);
    expect(isAppAuthCallbackUrl('glossa://auth-callback/#error=access_denied')).toBe(true);
    for (const url of [
      'glossa-dev://auth-callback#access_token=other',
      'readest://auth-callback#access_token=legacy',
      'glossa://auth-callback.evil/#access_token=other',
      'glossa://auth-callback/other#access_token=other',
      'glossa://user@auth-callback#access_token=other',
    ])
      expect(isAppAuthCallbackUrl(url)).toBe(false);
  });

  it('receives recovery on any page and ignores the consumed URL after a WebView remount', async () => {
    render(
      <StrictMode>
        <NativeAuthCallback />
      </StrictMode>,
    );
    await waitFor(() => expect(mocks.urls).toBeTypeOf('function'));
    expect(mocks.getCurrent).toHaveBeenCalledTimes(1);
    await act(async () => mocks.urls?.([recovery]));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/auth/recovery'));
    expect(mocks.login).toHaveBeenCalledWith('verified', user);
    expect(mocks.setSession).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('glossa-auth-callback')).toMatch(/^[a-f0-9]{64}$/);

    cleanup();
    mocks.router.push.mockClear();
    mocks.getCurrent.mockResolvedValue([recovery]);
    render(<NativeAuthCallback />);
    await act(async () => {
      await handleNativeAuthCallback(recovery, { login: mocks.login, navigate: mocks.router.push });
    });
    expect(mocks.setSession).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it('receives the initial URL when launched from a closed app', async () => {
    mocks.getCurrent.mockResolvedValue([recovery]);
    render(
      <StrictMode>
        <NativeAuthCallback />
      </StrictMode>,
    );
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/auth/recovery'));
    expect(mocks.getCurrent).toHaveBeenCalledTimes(1);
    expect(mocks.setSession).toHaveBeenCalledTimes(1);
  });

  it('deduplicates simultaneous native channels and suppresses the password-login redirect during verification', async () => {
    let finish!: () => void;
    mocks.setSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { session: { access_token: 'verified' } }, error: null });
        }),
    );
    render(<NativeAuthCallback />);
    act(() => {
      mocks.urls?.([recovery]);
      mocks.instance?.({ payload: { args: ['Glossa', recovery] } });
    });
    await waitFor(() => expect(mocks.setSession).toHaveBeenCalledTimes(1));
    expect(isAuthCallbackInProgress()).toBe(true);
    expect(mocks.router.push).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/auth/recovery'));
    expect(isAuthCallbackInProgress()).toBe(false);
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed callback retryable and never navigates after unmount', async () => {
    const options = { login: mocks.login, navigate: mocks.router.push };
    mocks.setSession.mockRejectedValueOnce(new Error('Network unavailable'));
    await handleNativeAuthCallback(recovery, options);
    expect(mocks.router.push).toHaveBeenLastCalledWith('/auth/error');
    expect(sessionStorage.getItem('glossa-auth-callback')).toBeNull();
    await handleNativeAuthCallback(recovery, options);
    expect(mocks.router.push).toHaveBeenLastCalledWith('/auth/recovery');

    sessionStorage.clear();
    mocks.router.push.mockClear();
    mocks.login.mockClear();
    let finish!: () => void;
    mocks.setSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { session: { access_token: 'verified' } }, error: null });
        }),
    );
    const view = render(<NativeAuthCallback />);
    act(() => mocks.urls?.([recovery]));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    view.unmount();
    await act(async () => finish());
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(mocks.removeUrl).toHaveBeenCalled();
    expect(mocks.removeInstance).toHaveBeenCalled();
  });

  it('does not register native listeners when the self-owned service is unconfigured', () => {
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_AUTH_KEY', '');
    render(<NativeAuthCallback />);
    expect(mocks.getCurrent).not.toHaveBeenCalled();
  });
});
