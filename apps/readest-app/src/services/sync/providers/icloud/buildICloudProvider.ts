import { stat } from '@tauri-apps/plugin-fs';
import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';
import { getICloudContainerStatus } from '@/utils/bridge';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { createICloudProvider } from './ICloudProvider';

export const isICloudSupportedPlatform = (): boolean =>
  isTauriAppPlatform() && ['ios', 'macos'].includes(getOSPlatform());

/** A dedicated folder selected through the macOS native picker, never the drive root. */
export const isICloudDriveFolder = (path: string): boolean =>
  /^\/Users\/[^/]+\/Library\/Mobile Documents\/com~apple~CloudDocs\/.+/.test(path) &&
  !path.split('/').some((part) => part === '..' || part === '.') &&
  !path.includes('\0');

export const resolveICloudDocumentsPath = async (selectedPath?: string): Promise<string | null> => {
  if (!isICloudSupportedPlatform()) return null;
  try {
    if (getOSPlatform() === 'macos') {
      if (!selectedPath || !isICloudDriveFolder(selectedPath)) return null;
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
): Promise<FileSyncProvider | null> => {
  const path = await resolveICloudDocumentsPath(selectedPath);
  return path ? createICloudProvider(path) : null;
};
