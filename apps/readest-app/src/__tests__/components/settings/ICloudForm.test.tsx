import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';

const { selectDirectory, saveSettings, mkdir, resolvePath } = vi.hoisted(() => ({
  selectDirectory: vi.fn(),
  saveSettings: vi.fn(),
  mkdir: vi.fn(),
  resolvePath: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: { getAppService: async () => ({ saveSettings }) },
    appService: { selectDirectory },
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => 'macos',
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ mkdir }));
vi.mock('@/services/sync/providers/icloud/buildICloudProvider', () => ({
  isICloudDriveFolder: (path: string) => path.startsWith(`${driveRoot}/`) && !path.includes('/../'),
  resolveICloudDocumentsPath: resolvePath,
}));
vi.mock('@/components/settings/integrations/FileSyncForm', () => ({ default: () => null }));

import ICloudForm from '@/components/settings/integrations/ICloudForm';

const driveRoot = '/Users/reader/Library/Mobile Documents/com~apple~CloudDocs';
const originalSettings = useSettingsStore.getState().settings;

beforeEach(() => {
  vi.clearAllMocks();
  mkdir.mockResolvedValue(undefined);
  saveSettings.mockResolvedValue(undefined);
  resolvePath.mockImplementation(async (path?: string) => path ?? null);
  useSettingsStore.setState({
    settings: {
      version: 1,
      icloud: { enabled: false },
      googleDrive: { enabled: true },
    } as SystemSettings,
  });
});

afterEach(() => {
  cleanup();
  useSettingsStore.setState({ settings: originalSettings });
});

describe('iCloud folder selection', () => {
  it('canceling leaves settings and files untouched', async () => {
    selectDirectory.mockResolvedValue('');
    render(<ICloudForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Choose folder' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(saveSettings).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.icloud.documentsPath).toBeUndefined();
  });

  it('rejects folders outside iCloud before any write', async () => {
    selectDirectory.mockResolvedValue('/Users/reader/Documents');
    render(<ICloudForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByRole('alert');
    expect(saveSettings).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('a failed save keeps the old settings and can be retried', async () => {
    selectDirectory.mockResolvedValue(driveRoot);
    saveSettings.mockRejectedValueOnce(new Error('write unavailable'));
    render(<ICloudForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByRole('alert');
    expect(useSettingsStore.getState().settings.icloud.documentsPath).toBeUndefined();
    expect((screen.getByRole('button', { name: 'Use iCloud' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.icloud.documentsPath).toBe(`${driveRoot}/Glossa`),
    );
    expect(useSettingsStore.getState().settings.googleDrive.enabled).toBe(true);
    expect(saveSettings).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('button', { name: 'Use iCloud' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
