/**
 * Retained upstream transport/queue protocol fixtures. They exercise old data
 * compatibility with mocked I/O, not Glossa's production service policy.
 * Production no-network/no-native-cloud behavior is tested in glossa/.
 */
import { vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
vi.mock('@/glossa/account/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/glossa/account/config')>()),
  isNativeCloudSyncAvailable: () => true,
}));
vi.mock('@/services/sync/cloudSyncProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/sync/cloudSyncProvider')>();
  const enabled = (settings: SystemSettings | null | undefined) =>
    settings?.readestCloud?.enabled ?? actual.getEnabledFileSyncBackends(settings).length === 0;
  return { ...actual, isReadestCloudEnabled: enabled, isReadestCloudStorageActive: enabled };
});
