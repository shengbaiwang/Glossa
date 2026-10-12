import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: true,
  platform: 'macos',
  stat: vi.fn(),
  container: vi.fn(),
  provider: vi.fn(),
}));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => mocks.native,
}));
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => mocks.platform }));
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: mocks.stat }));
vi.mock('@/utils/bridge', () => ({ getICloudContainerStatus: mocks.container }));
vi.mock('@/services/sync/providers/icloud/ICloudProvider', () => ({
  createICloudProvider: mocks.provider,
}));
import {
  buildICloudProvider,
  isICloudDriveFolder,
  resolveICloudDocumentsPath,
} from '@/services/sync/providers/icloud/buildICloudProvider';

const root = '/Users/reader/Library/Mobile Documents/com~apple~CloudDocs';
beforeEach(() => {
  mocks.native = true;
  mocks.platform = 'macos';
  mocks.stat.mockReset().mockResolvedValue({ isDirectory: true });
  mocks.container.mockReset().mockResolvedValue({
    available: true,
    documentsPath: '/Mobile Documents/iCloud~app~glossa~reader/Documents',
  });
  mocks.provider.mockReset().mockReturnValue({ kind: 'icloud' });
});
afterEach(() => vi.unstubAllEnvs());
describe('Glossa iCloud Drive folder boundary', () => {
  it('accepts a selected dedicated folder and never silently selects the drive root', async () => {
    expect(await resolveICloudDocumentsPath()).toBeNull();
    expect(await resolveICloudDocumentsPath(root)).toBeNull();
    expect(await resolveICloudDocumentsPath(`${root}/Glossa`)).toBe(`${root}/Glossa`);
    expect(await buildICloudProvider(`${root}/Glossa`)).toEqual({ kind: 'icloud' });
    expect(mocks.provider).toHaveBeenCalledWith(`${root}/Glossa`);
    expect(mocks.container).not.toHaveBeenCalled();
  });
  it.each([
    `${root}/../other`,
    `${root}/./Glossa`,
    `${root}-other/Glossa`,
    '/Users/reader/Documents/Glossa',
  ])('rejects paths outside the selected iCloud folder: %s', (path) => {
    expect(isICloudDriveFolder(path)).toBe(false);
  });
  it('contains filesystem failures and rejects files', async () => {
    mocks.stat.mockResolvedValueOnce({ isDirectory: false });
    expect(await resolveICloudDocumentsPath(`${root}/Glossa`)).toBeNull();
    mocks.stat.mockRejectedValueOnce(new Error('access denied'));
    expect(await resolveICloudDocumentsPath(`${root}/Glossa`)).toBeNull();
  });
  it('never uses the upstream iOS container without an own container configuration', async () => {
    mocks.platform = 'ios';
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_ICLOUD_CONTAINER', '');
    expect(await resolveICloudDocumentsPath()).toBeNull();
    expect(mocks.container).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PUBLIC_GLOSSA_ICLOUD_CONTAINER', 'iCloud.app.glossa.reader');
    expect(await resolveICloudDocumentsPath()).toBe(
      '/Mobile Documents/iCloud~app~glossa~reader/Documents',
    );
    mocks.container.mockResolvedValueOnce({
      available: true,
      documentsPath: '/Mobile Documents/iCloud~com~bilingify~readest/Documents',
    });
    expect(await resolveICloudDocumentsPath()).toBeNull();
    mocks.container.mockResolvedValueOnce({ available: false });
    expect(await resolveICloudDocumentsPath()).toBeNull();
  });
  it('does not probe the native filesystem from a web build', async () => {
    mocks.native = false;
    expect(await resolveICloudDocumentsPath(`${root}/Glossa`)).toBeNull();
    expect(mocks.stat).not.toHaveBeenCalled();
  });
});
