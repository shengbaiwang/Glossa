import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  receive: null as null | ((urls: string[]) => void),
  remove: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isAndroidApp: false } }),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: mocks.dispatch } }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ listen: vi.fn(async () => mocks.remove) }),
}));
vi.mock('@tauri-apps/api/core', () => ({ addPluginListener: vi.fn() }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: vi.fn(async (receive: typeof mocks.receive) => {
    mocks.receive = receive;
    return mocks.remove;
  }),
}));

import { useAppUrlIngress } from '@/hooks/useAppUrlIngress';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('authentication URLs never enter book ingress or its log', () => {
  it('drops formal, development and legacy callbacks while forwarding ordinary files', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    renderHook(useAppUrlIngress);
    const authUrls = ['glossa', 'glossa-dev', 'readest'].map(
      (scheme) => `${scheme}://auth-callback#access_token=private&refresh_token=private`,
    );
    act(() => mocks.receive?.(authUrls));
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    act(() => mocks.receive?.([...authUrls, 'file:///tmp/fixture.epub']));
    expect(mocks.dispatch).toHaveBeenCalledWith('app-incoming-url', {
      urls: ['file:///tmp/fixture.epub'],
      action: undefined,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
  });
});
