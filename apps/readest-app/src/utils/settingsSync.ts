import {
  mergeLibraryDisplay,
  pickLibraryDisplay,
  type LibraryDisplaySettings,
} from './libraryDisplaySettings';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriAppPlatform } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import { OFFICIAL_MODULES, type OfficialModulePreferences } from '@/glossa/modules/registry';

/**
 * Cross-window global-settings sync.
 *
 * On desktop the app runs multiple windows (one library + one per open book),
 * and each keeps its own in-memory settings loaded once at window open. Global
 * settings persist to a single shared `settings.json`, and every window writes
 * the whole object on save. A window that loaded before the user customized a
 * global setting therefore clobbers that change with its own stale (often
 * default) value the next time it saves — e.g. a reader window reverting
 * "Click to Paginate" back to the default on close (issue #4580).
 *
 * To keep windows consistent, the persisting window broadcasts its global
 * setting blobs and every other window adopts them, so a later save no longer
 * carries stale globals. Reading globals and clocked library display preferences are synced; every
 * device/window-local field (filesystem paths, `lastOpenBooks`, sync cursors,
 * screen brightness, ...) is left untouched on the receiving window. Explicit
 * module switches broadcast only the edited boolean flags; explicit
 * folder mutations also broadcast their catalog so reader windows retain it
 * when they next save settings; routine broadcasts never include that catalog.
 */
export const SETTINGS_SYNC_EVENT = 'global-settings-window-sync';

/**
 * Minimal cloud-sync provider selection payload. ONLY the enabled flags
 * plus the selection timestamp — never credentials (`webdav.password`
 * must not ride window events) and never `lastSyncedAt` (the file-sync
 * engine writes it after every push; if whole slices were broadcast, a
 * reader window's routine cursor save interleaving with a provider
 * switch could win and silently flip the selection back).
 */
export interface CloudSyncProviderFlags {
  webdav: { enabled: boolean; providerSelectedAt?: number };
  googleDrive: { enabled: boolean; providerSelectedAt?: number };
  /** Optional: absent on payloads from pre-S3 windows (treated as unchanged). */
  s3?: { enabled: boolean; providerSelectedAt?: number };
  /** Optional: absent on payloads from pre-OneDrive windows (treated as unchanged). */
  onedrive?: { enabled: boolean; providerSelectedAt?: number };
  /** Optional: absent on payloads from pre-iCloud windows (treated as unchanged). */
  icloud?: { enabled: boolean; providerSelectedAt?: number; documentsPath?: string };
  /**
   * Optional in two senses: absent on payloads from pre-#5062 windows, and
   * absent when the source window has never had the slice written. `enabled`
   * is itself optional because `undefined` is meaningful there (it means
   * "derive from the third-party flags") — coercing it to `false` would
   * silently switch Readest Cloud off on the receiver.
   */
  readestCloud?: { enabled?: boolean; disabledAt?: number };
}

export interface SettingsSyncPayload {
  libraryDisplay?: LibraryDisplaySettings;
  /** Label of the window that persisted the change, so receivers ignore their own echo. */
  sourceLabel: string;
  globalViewSettings: SystemSettings['globalViewSettings'];
  globalReadSettings: SystemSettings['globalReadSettings'];
  /**
   * Present only on provider-switch broadcasts (see
   * `persistCloudProviderEnabled`), NOT on routine saves — so a stale
   * window's ordinary settings write can never carry stale flags that
   * revert someone else's switch.
   */
  cloudSyncProviders?: CloudSyncProviderFlags;
  /** Explicit module edits only; contains no book data or credentials. */
  officialModules?: OfficialModulePreferences;
  pdfContentsOnImport?: boolean;
  /** Only included after an explicit folder mutation; routine stale saves never broadcast it. */
  libraryFolders?: string[];
  /** Same-device import destinations follow explicit group edits, never routine saves. */
  autoImportFolderGroups?: Record<string, string>;
}

/**
 * Merge the global setting blobs broadcast by another window into this window's
 * settings, preserving every device/window-local field on the local copy.
 */
export const mergeSyncedGlobalSettings = (
  local: SystemSettings,
  payload: Pick<
    SettingsSyncPayload,
    | 'libraryDisplay'
    | 'globalViewSettings'
    | 'globalReadSettings'
    | 'cloudSyncProviders'
    | 'officialModules'
    | 'pdfContentsOnImport'
    | 'libraryFolders'
    | 'autoImportFolderGroups'
  >,
): SystemSettings => {
  const merged: SystemSettings = {
    ...local,
    globalViewSettings: payload.globalViewSettings,
    globalReadSettings: payload.globalReadSettings,
  };
  if (payload.officialModules) {
    merged.officialModules = { ...local.officialModules };
    for (const { id } of OFFICIAL_MODULES) {
      const enabled = payload.officialModules[id];
      if (typeof enabled === 'boolean') merged.officialModules[id] = enabled;
    }
  }
  if (typeof payload.pdfContentsOnImport === 'boolean')
    merged.pdfContentsOnImport = payload.pdfContentsOnImport;
  if (payload.libraryFolders) merged.libraryFolders = payload.libraryFolders;
  if (payload.autoImportFolderGroups)
    merged.autoImportFolderGroups = payload.autoImportFolderGroups;
  if (payload.cloudSyncProviders) {
    merged.webdav = { ...local.webdav, ...payload.cloudSyncProviders.webdav };
    merged.googleDrive = { ...local.googleDrive, ...payload.cloudSyncProviders.googleDrive };
    if (payload.cloudSyncProviders.s3) {
      merged.s3 = { ...local.s3, ...payload.cloudSyncProviders.s3 };
    }
    if (payload.cloudSyncProviders.onedrive) {
      merged.onedrive = { ...local.onedrive, ...payload.cloudSyncProviders.onedrive };
    }
    if (payload.cloudSyncProviders.icloud) {
      merged.icloud = { ...local.icloud, ...payload.cloudSyncProviders.icloud };
    }
    if (payload.cloudSyncProviders.readestCloud) {
      merged.readestCloud = {
        ...local.readestCloud,
        ...payload.cloudSyncProviders.readestCloud,
      };
    }
  }
  return payload.libraryDisplay ? mergeLibraryDisplay(merged, payload.libraryDisplay) : merged;
};

/**
 * Broadcast this window's global settings to all other windows after a
 * settings write. Fire-and-forget and a no-op off Tauri.
 */
export const broadcastGlobalSettings = async (
  settings: SystemSettings,
  opts: {
    includeCloudSyncProviders?: boolean;
    includeLibraryFolders?: boolean;
    officialModules?: OfficialModulePreferences;
    pdfContentsOnImport?: boolean;
  } = {},
): Promise<void> => {
  if (!isTauriAppPlatform()) return;
  if (!settings.globalViewSettings || !settings.globalReadSettings) return;
  try {
    const payload: SettingsSyncPayload = {
      sourceLabel: getCurrentWindow().label,
      libraryDisplay: pickLibraryDisplay(settings),
      globalViewSettings: settings.globalViewSettings,
      globalReadSettings: settings.globalReadSettings,
    };
    if (opts.officialModules) payload.officialModules = opts.officialModules;
    if (typeof opts.pdfContentsOnImport === 'boolean')
      payload.pdfContentsOnImport = opts.pdfContentsOnImport;
    if (opts.includeLibraryFolders) {
      payload.libraryFolders = settings.libraryFolders ?? [];
      payload.autoImportFolderGroups = settings.autoImportFolderGroups ?? {};
    }
    if (opts.includeCloudSyncProviders) {
      payload.cloudSyncProviders = {
        webdav: {
          enabled: !!settings.webdav?.enabled,
          providerSelectedAt: settings.webdav?.providerSelectedAt,
        },
        googleDrive: {
          enabled: !!settings.googleDrive?.enabled,
          providerSelectedAt: settings.googleDrive?.providerSelectedAt,
        },
        s3: {
          enabled: !!settings.s3?.enabled,
          providerSelectedAt: settings.s3?.providerSelectedAt,
        },
        onedrive: {
          enabled: !!settings.onedrive?.enabled,
          providerSelectedAt: settings.onedrive?.providerSelectedAt,
        },
        icloud: {
          enabled: !!settings.icloud?.enabled,
          providerSelectedAt: settings.icloud?.providerSelectedAt,
          documentsPath: settings.icloud?.documentsPath,
        },
      };
      if (settings.readestCloud) {
        payload.cloudSyncProviders.readestCloud = {
          enabled: settings.readestCloud.enabled,
          disabledAt: settings.readestCloud.disabledAt,
        };
      }
    }
    await emit(SETTINGS_SYNC_EVENT, payload);
  } catch (err) {
    console.warn('Failed to broadcast settings to other windows', err);
  }
};

/**
 * Subscribe to global-settings broadcasts from other windows. The callback is
 * invoked only for events emitted by a different window. Returns an unlisten
 * function (a no-op resolver off Tauri).
 */
export const subscribeSettingsSync = async (
  onReceive: (payload: SettingsSyncPayload) => void,
): Promise<UnlistenFn> => {
  if (!isTauriAppPlatform()) return () => {};
  const currentLabel = getCurrentWindow().label;
  return listen<SettingsSyncPayload>(SETTINGS_SYNC_EVENT, ({ payload }) => {
    if (!payload || payload.sourceLabel === currentLabel) return;
    onReceive(payload);
  });
};
