import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import IntegrationsPanel from '@/components/settings/IntegrationsPanel';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTransferStore } from '@/store/transferStore';
import type { SystemSettings } from '@/types/settings';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: vi.fn() }));
vi.mock('@/hooks/useTransferQueue', () => ({
  useTransferQueue: () => ({
    setIsTransferQueueOpen: useTransferStore.getState().setIsTransferQueueOpen,
  }),
}));
vi.mock('@/services/sync/providers/icloud/buildICloudProvider', () => ({
  isICloudSupportedPlatform: () => false,
  resolveICloudDocumentsPath: vi.fn(),
}));
vi.mock('@/components/settings/integrations/WebDAVForm', () => ({ default: () => null }));
vi.mock('@/components/settings/integrations/GoogleDriveForm', () => ({ default: () => null }));
vi.mock('@/components/settings/integrations/OneDriveForm', () => ({ default: () => null }));
vi.mock('@/components/settings/integrations/ICloudForm', () => ({ default: () => null }));
vi.mock('@/components/settings/integrations/S3Form', () => ({ default: () => null }));

beforeEach(() => {
  useSettingsStore.setState({ settings: {} as SystemSettings, isSettingsDialogOpen: true });
  useLibraryStore.setState({ isSyncing: false });
  useTransferStore.setState({ isTransferQueueOpen: false });
});
afterEach(cleanup);

it('keeps manual library sync reachable and prevents overlapping runs', () => {
  const sync = vi.fn();
  render(<IntegrationsPanel onSyncLibrary={sync} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sync Library' }));
  expect(sync).toHaveBeenCalledOnce();
  act(() => useLibraryStore.setState({ isSyncing: true }));
  const pending = screen.getByRole('button', { name: /Sync Library/ });
  expect(pending.hasAttribute('disabled')).toBe(true);
  fireEvent.click(pending);
  expect(sync).toHaveBeenCalledOnce();
});

it('opens cloud transfers after closing the settings layer', () => {
  render(<IntegrationsPanel />);
  expect(screen.queryByRole('button', { name: 'Sync Library' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cloud File Transfers' }));
  expect(useSettingsStore.getState().isSettingsDialogOpen).toBe(false);
  expect(useTransferStore.getState().isTransferQueueOpen).toBe(true);
});
