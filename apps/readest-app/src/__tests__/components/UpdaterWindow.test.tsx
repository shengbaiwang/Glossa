import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { checkMock, fetchMock, installMock } = vi.hoisted(() => ({
  checkMock: vi.fn().mockResolvedValue(null),
  fetchMock: vi.fn(),
  installMock: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: checkMock }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: fetchMock }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { hasUpdater: true } }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('latestVersion=99.0.0'),
}));
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'macos', arch: () => 'aarch64' }));
vi.mock('@/utils/bridge', () => ({ installNightlyUpdate: installMock }));
vi.mock('@/components/Dialog', () => ({ default: () => null }));
vi.mock('@/components/Link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { UpdaterContent } from '@/components/UpdaterWindow';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('Glossa direct update page', () => {
  test('does not fetch or translate upstream release notes from an old release-notes route', () => {
    const webFetch = vi.fn();
    vi.stubGlobal('fetch', webFetch);
    render(<UpdaterContent checkUpdate={false} latestVersion='99.0.0' lastVersion='0.11.0' />);
    expect(screen.getByText('Automatic updates are not configured for Glossa.')).toBeTruthy();
    expect(webFetch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Already the latest version')).toBeNull();
  });

  test('shows the unavailable state without checking or installing upstream releases', () => {
    render(<UpdaterContent latestVersion='99.0.0' />);
    expect(screen.getByText('Automatic updates are not configured for Glossa.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View releases' }).getAttribute('href')).toBe(
      'https://github.com/shengbaiwang/Glossa/releases',
    );
    expect(screen.queryByText('DOWNLOAD & INSTALL')).toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(installMock).not.toHaveBeenCalled();
  });

  test('ignores an upstream nightly passed by a stale window event', () => {
    render(
      <UpdaterContent
        nightlyUpdate={{
          endpoint: 'https://download.readest.com/nightly/latest.json',
          url: 'https://download.readest.com/Readest.tar.gz',
          version: '99.0.0',
          platformKey: 'darwin-aarch64',
          signature: 'old-upstream-signature',
        }}
      />,
    );
    expect(screen.queryByText('DOWNLOAD & INSTALL')).toBeNull();
    expect(checkMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(installMock).not.toHaveBeenCalled();
  });
});
