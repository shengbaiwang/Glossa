import { stat } from '@tauri-apps/plugin-fs';
import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';
import { icloudEnsureDownloaded, getICloudContainerStatus } from '@/utils/bridge';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { createICloudProvider } from './ICloudProvider';

export const isICloudSupportedPlatform = (): boolean =>
  isTauriAppPlatform() && ['ios', 'macos'].includes(getOSPlatform());

const cloudDocs =
  /^(?:\/Users\/[^/]+|(?:\/private)?\/var\/mobile)\/Library\/Mobile Documents\/com~apple~CloudDocs\/.+/;
const fileProviderDirectory =
  /^(?:\/private)?\/var\/mobile\/Containers\/Shared\/AppGroup\/[a-f0-9-]{36}\/File Provider Storage\/.+/i;
/** File Provider domains share a path layout. Foundation must confirm the selected iOS domain. */
export const isICloudDriveFolder = (path: string) =>
  !path.includes('\0') &&
  !path.split('/').some((p) => p === '.' || p === '..') &&
  (cloudDocs.test(path) || (getOSPlatform() === 'ios' && fileProviderDirectory.test(path)));

export const resolveICloudDocumentsPath = async (selectedPath?: string): Promise<string | null> => {
  if (!isICloudSupportedPlatform()) return null;
  try {
    if (selectedPath || getOSPlatform() === 'macos') {
      if (!selectedPath || !isICloudDriveFolder(selectedPath)) return null;
      if (
        fileProviderDirectory.test(selectedPath) &&
        (await icloudEnsureDownloaded({ path: selectedPath, directoryOnly: true })).status !==
          'driveDirectory'
      )
        return null;
      const info = await stat(selectedPath);
      return info.isDirectory ? selectedPath : null;
    }
    // iOS requires a Glossa-owned, provisioned container in the signed build.
    const container = process.env['NEXT_PUBLIC_GLOSSA_ICLOUD_CONTAINER'];
    if (!container?.startsWith('iCloud.') || container === 'iCloud.com.bilingify.readest')
      return null;
    const status = await getICloudContainerStatus();
    // The current native bridge resolves the signed build's default container.
    // A public setting alone must not relabel an upstream entitlement as Glossa's.
    const ownFolder = container.replace(/\./g, '~');
    return status.available && status.documentsPath?.split('/').includes(ownFolder)
      ? status.documentsPath
      : null;
  } catch {
    return null;
  }
};

export const buildICloudProvider = async (
  selectedPath?: string,
  vaultId?: string,
): Promise<FileSyncProvider | null> => {
  const path = await resolveICloudDocumentsPath(selectedPath);
  if (!path) return null;
  const provider = createICloudProvider(path);
  if (vaultId) {
    const { verifyVault, vaultRoot } = await import('./vault');
    await verifyVault(provider, vaultId);
    return { ...provider, rootPath: vaultRoot(vaultId), vaultId };
  }
  return provider;
};
