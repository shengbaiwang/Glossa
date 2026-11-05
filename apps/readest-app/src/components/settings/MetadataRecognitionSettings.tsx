import { useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import { BoxedList, SettingsSwitchRow } from './primitives';

export default function MetadataRecognitionSettings() {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(false);
    const store = useSettingsStore.getState();
    const previous = store.settings.metadataRecognitionOnImport;
    const enabled = previous !== true;
    const next = { ...store.settings, metadataRecognitionOnImport: enabled };
    store.setSettings(next);
    try {
      await store.saveSettings(envConfig, next);
      if (useSettingsStore.getState().settings.metadataRecognitionOnImport === enabled)
        await broadcastGlobalSettings(next, { metadataRecognitionOnImport: enabled });
    } catch {
      const current = useSettingsStore.getState().settings;
      if (current.metadataRecognitionOnImport === enabled)
        store.setSettings({ ...current, metadataRecognitionOnImport: previous });
      setError(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <BoxedList>
      <SettingsSwitchRow
        label={_('Recognize metadata on import')}
        checked={settings.metadataRecognitionOnImport === true}
        disabled={saving}
        onChange={() => void save()}
        data-setting-id='settings.plugins.metadataRecognitionOnImport'
      />
      {error && (
        <p role='alert' className='glossa-supporting-text px-4 py-2'>
          {_('Couldn’t save module settings. Please try again.')}
        </p>
      )}
    </BoxedList>
  );
}
