import { StrictMode } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  login: vi.fn(),
  env: {},
  translation: (key: string) => key,
  authCallback: vi.fn(),
  googleState: vi.fn(),
  microsoftState: vi.fn(),
  persist: vi.fn(),
  exchange: vi.fn(),
  label: vi.fn(),
  token: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ login: mocks.login }) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: mocks.env }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => mocks.translation }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));
vi.mock('@/helpers/auth', async (original) => ({
  ...(await original<typeof import('@/helpers/auth')>()),
  handleAuthCallback: mocks.authCallback,
}));
vi.mock('@/components/settings/integrations/cloudSync', () => ({
  persistCloudProviderEnabled: mocks.persist,
}));
vi.mock('@/services/sync/providers/gdrive/buildGoogleDriveProvider', () => ({
  getGoogleWebClientId: () => 'own-google',
}));
vi.mock('@/services/sync/providers/gdrive/WebDriveAuth', () => ({
  WebDriveAuth: class {
    accountLabel = mocks.label;
  },
}));
vi.mock('@/services/sync/providers/gdrive/auth/webTokenStore', () => ({
  saveWebDriveToken: mocks.token,
}));
vi.mock('@/services/sync/providers/gdrive/auth/webRedirectFlow', () => ({
  consumeReturnPath: () => '/library',
  consumeOAuthState: mocks.googleState,
  parseImplicitRedirect: () => ({ state: 'own-state' }),
  tokenSetFromRedirect: () => ({ accessToken: 'fixture', expiresAt: 1 }),
}));
vi.mock('@/services/sync/providers/onedrive/buildOneDriveProvider', () => ({
  getMicrosoftClientId: () => 'own-microsoft',
}));
vi.mock('@/services/sync/providers/onedrive/onedriveAuth', () => ({
  resolveOneDriveAccountLabel: mocks.label,
}));
vi.mock('@/services/sync/providers/onedrive/webAuthCodeFlow', () => ({
  consumeReturnPath: () => '/library',
  consumeWebOAuthState: mocks.microsoftState,
  consumeWebPkceVerifier: () => 'own-verifier',
  exchangeWebAuthCode: mocks.exchange,
  oneDriveWebRedirectUri: () => 'https://glossa.test/onedrive-callback',
  saveWebOneDriveToken: mocks.token,
}));

import AuthCallback from '@/app/auth/callback/page';
import GDriveCallback from '@/app/gdrive-callback/page';
import OneDriveCallback from '@/app/onedrive-callback/page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.googleState.mockReturnValueOnce('own-state').mockReturnValue(null);
  mocks.microsoftState.mockReturnValueOnce('own-state').mockReturnValue(null);
  mocks.persist.mockResolvedValue(undefined);
  mocks.label.mockResolvedValue('Original fixture');
  mocks.exchange.mockResolvedValue({ accessToken: 'fixture', expiresAt: 1 });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});
it('processes an identity callback once and waits for verification before navigating', async () => {
  window.history.replaceState(
    null,
    '',
    '/auth/callback#access_token=fixture&refresh_token=refresh',
  );
  let finish: (() => void) | undefined;
  mocks.authCallback.mockImplementation(
    ({ navigate }) =>
      new Promise<void>((resolve) => {
        finish = () => {
          navigate('/auth/recovery');
          resolve();
        };
      }),
  );
  render(
    <StrictMode>
      <AuthCallback />
    </StrictMode>,
  );
  expect(mocks.authCallback).toHaveBeenCalledTimes(1);
  expect(window.location.hash).toBe('');
  expect(mocks.router.push).not.toHaveBeenCalled();
  finish!();
  await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/auth/recovery'));
});
it('does not consume Google state twice during strict effect replay', async () => {
  window.history.replaceState(null, '', '/gdrive-callback#access_token=fixture');
  render(
    <StrictMode>
      <GDriveCallback />
    </StrictMode>,
  );
  await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith('/library'));
  expect(mocks.googleState).toHaveBeenCalledTimes(1);
  expect(mocks.token).toHaveBeenCalledTimes(1);
  expect(mocks.persist).toHaveBeenCalledTimes(1);
  expect(window.location.hash).toBe('');
});
it('exchanges a Microsoft authorization code only once during strict effect replay', async () => {
  window.history.replaceState(null, '', '/onedrive-callback?code=fixture&state=own-state');
  render(
    <StrictMode>
      <OneDriveCallback />
    </StrictMode>,
  );
  await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith('/library'));
  expect(mocks.microsoftState).toHaveBeenCalledTimes(1);
  expect(mocks.exchange).toHaveBeenCalledTimes(1);
  expect(mocks.persist).toHaveBeenCalledTimes(1);
  expect(window.location.search).toBe('');
});
