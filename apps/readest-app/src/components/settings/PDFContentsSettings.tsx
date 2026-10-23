import { useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import { BoxedList, SettingsSwitchRow } from './primitives';

export default function PDFContentsSettings() {
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
    const previous = store.settings.pdfContentsOnImport;
    const enabled = previous === false;
    const next = { ...store.settings, pdfContentsOnImport: enabled };
    store.setSettings(next);
    try {
      await store.saveSettings(envConfig, next);
      if (useSettingsStore.getState().settings.pdfContentsOnImport === enabled)
        await broadcastGlobalSettings(next, { pdfContentsOnImport: enabled });
    } catch {
      const current = useSettingsStore.getState().settings;
      if (current.pdfContentsOnImport === enabled)
        store.setSettings({ ...current, pdfContentsOnImport: previous });
      setError(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <BoxedList>
      <SettingsSwitchRow
        label={_('Generate contents on import')}
        checked={settings.pdfContentsOnImport !== false}
        disabled={saving}
        onChange={() => void save()}
        data-setting-id='settings.plugins.pdfContentsOnImport'
      />
      {error && (
        <p role='alert' className='glossa-supporting-text px-4 py-2'>
          {_('Couldn’t save module settings. Please try again.')}
        </p>
      )}
    </BoxedList>
  );
}
