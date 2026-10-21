import { useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getFolderImportReadInPlace } from '@/helpers/settings';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import type { SystemSettings } from '@/types/settings';
import WatchedFoldersPane from '@/app/library/components/WatchedFoldersPane';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';

const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');

const FolderImportSettings = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const readInPlace = getFolderImportReadInPlace(settings);

  const save = async (patch: Partial<SystemSettings>) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(false);
    const store = useSettingsStore.getState();
    const previous = store.settings;
    const next = { ...previous, ...patch };
    store.setSettings(next);
    try {
      await store.saveSettings(envConfig, next);
      if ('autoImportFolderGroups' in patch)
        void broadcastGlobalSettings(next, { includeLibraryFolders: true });
    } catch {
      // Restore only this edit, preserving unrelated settings changed meanwhile.
      const current = useSettingsStore.getState().settings;
      const restored = { ...current };
      for (const key of Object.keys(patch) as (keyof SystemSettings)[]) {
        if (current[key] === next[key]) Object.assign(restored, { [key]: previous[key] });
      }
      store.setSettings(restored);
      setError(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const folders = (settings.autoImportFolders ?? []).map((path) => ({
    path,
    flatten: (settings.autoImportFlattenFolders ?? []).some(
      (root) => normalize(root) === normalize(path),
    ),
  }));

  return (
    <>
      <BoxedList title={_('Import Books')}>
        <SettingsRow label={_('File handling for new folders')} disabled={saving}>
          <SettingsSelect
            ariaLabel={_('File handling for new folders')}
            value={readInPlace ? 'original' : 'copy'}
            disabled={saving}
            options={[
              { value: 'copy', label: _('Copy into library') },
              { value: 'original', label: _('Read from original location') },
            ]}
            onChange={(event) =>
              void save({ folderImportReadInPlace: event.target.value === 'original' })
            }
          />
        </SettingsRow>
        {readInPlace && (
          <SettingsSwitchRow
            label={_('Watch newly imported folders')}
            checked={!!settings.folderImportAutoImport}
            disabled={saving}
            onChange={() => void save({ folderImportAutoImport: !settings.folderImportAutoImport })}
          />
        )}
      </BoxedList>
      {folders.length > 0 && (
        <WatchedFoldersPane
          folders={folders}
          disabled={saving}
          onUnwatch={(path) =>
            void save({
              autoImportFolders: (settings.autoImportFolders ?? []).filter(
                (root) => normalize(root) !== normalize(path),
              ),
              autoImportFlattenFolders: (settings.autoImportFlattenFolders ?? []).filter(
                (root) => normalize(root) !== normalize(path),
              ),
              autoImportFolderGroups: Object.fromEntries(
                Object.entries(settings.autoImportFolderGroups ?? {}).filter(
                  ([root]) => normalize(root) !== normalize(path),
                ),
              ),
            })
          }
          onSetFlatten={(path, flatten) => {
            const other = (settings.autoImportFlattenFolders ?? []).filter(
              (root) => normalize(root) !== normalize(path),
            );
            void save({ autoImportFlattenFolders: flatten ? [...other, path] : other });
          }}
        />
      )}
      {error && (
        <p role='alert' className='glossa-supporting-text'>
          {_('Couldn’t save import settings. Please try again.')}
        </p>
      )}
    </>
  );
};

export default FolderImportSettings;
