import { useEffect, useState } from 'react';
import { mkdir } from '@tauri-apps/plugin-fs';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import { getOSPlatform } from '@/utils/misc';
import {
  isICloudDriveFolder,
  resolveICloudDocumentsPath,
} from '@/services/sync/providers/icloud/buildICloudProvider';
import type { ICloudSettings } from '@/types/settings';
import FileSyncForm from './FileSyncForm';
import { persistCloudProviderEnabled } from './cloudSync';

export default function ICloudForm() {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig, appService } = useEnv();
  const stored = settings.icloud;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const macOS = getOSPlatform() === 'macos';

  useEffect(() => {
    let disposed = false;
    setAvailable(null);
    void resolveICloudDocumentsPath(stored?.documentsPath).then((path) => {
      if (!disposed) setAvailable(!!path);
    });
    return () => {
      disposed = true;
    };
  }, [stored?.documentsPath]);

  const persist = async (patch: Partial<ICloudSettings>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, icloud: { ...latest.icloud, ...patch } };
    // Save before displaying success so a filesystem failure can be retried.
    await saveSettings(envConfig, next);
    setSettings(next);
    void broadcastGlobalSettings(next, { includeCloudSyncProviders: true });
  };
  const chooseFolder = async () => {
    if (busy || !appService) return;
    setBusy(true);
    setError('');
    try {
      const selected = (await appService.selectDirectory('write')).replace(/\/+$/, '');
      if (!selected) return;
      // Picking the drive root creates a dedicated Glossa subfolder.
      const path = selected.endsWith('/Library/Mobile Documents/com~apple~CloudDocs')
        ? `${selected}/Glossa`
        : selected;
      if (!isICloudDriveFolder(path)) {
        setError(_('Choose a folder in iCloud Drive.'));
        return;
      }
      await mkdir(path, { recursive: true });
      if (!(await resolveICloudDocumentsPath(path))) throw new Error('Folder unavailable');
      await persist({ documentsPath: path });
      setAvailable(true);
    } catch {
      setError(_('Unable to access this folder. Please choose it again.'));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await persistCloudProviderEnabled(envConfig, 'icloud', enabled);
    } catch {
      setError(_('Unable to save sync settings. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className='space-y-5'>
      {macOS && (
        <div className='flex items-center justify-between gap-4'>
          <span className='text-base-content/70 truncate text-sm'>
            {stored?.documentsPath?.split('/').pop() ?? _('iCloud Drive folder')}
          </span>
          <button
            type='button'
            disabled={busy}
            onClick={() => void chooseFolder()}
            className='btn btn-ghost shrink-0 rounded-lg'
          >
            {_('Choose folder')}
          </button>
        </div>
      )}
      {available === false && (
        <p role='status' className='text-base-content/70 text-sm'>
          {macOS
            ? _('Choose a folder in iCloud Drive.')
            : _('iCloud is not available on this device.')}
        </p>
      )}
      {stored?.enabled && (
        <FileSyncForm
          kind='icloud'
          stored={stored}
          persist={persist}
          syncNowDisabled={available !== true || busy}
        />
      )}
      <div className='flex justify-end'>
        <button
          type='button'
          disabled={busy || (!stored?.enabled && available !== true)}
          onClick={() => void toggle(!stored?.enabled)}
          className='btn btn-contrast rounded-lg'
        >
          {busy ? (
            <span className='loading loading-spinner loading-sm' />
          ) : (
            _(stored?.enabled ? 'Turn Off' : 'Use iCloud')
          )}
        </button>
      </div>
      {error && (
        <p role='alert' className='text-error text-sm'>
          {error}
        </p>
      )}
    </div>
  );
}
