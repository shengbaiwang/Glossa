import { useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import {
  OFFICIAL_MODULES,
  isOfficialModuleEnabled,
  type OfficialModuleId,
} from '@/glossa/modules/registry';
import { BoxedList, SettingsSwitchRow } from './primitives';

export default function OfficialModuleSettings() {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const save = async (id: OfficialModuleId) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(false);
    const store = useSettingsStore.getState();
    const previous = store.settings.officialModules?.[id];
    const enabled = !isOfficialModuleEnabled(store.settings, id);
    const next = {
      ...store.settings,
      officialModules: { ...store.settings.officialModules, [id]: enabled },
    };
    store.setSettings(next);
    try {
      await store.saveSettings(envConfig, next);
      // Only explicit changes travel between windows; stale routine saves cannot reactivate a module.
      if (useSettingsStore.getState().settings.officialModules?.[id] === enabled)
        await broadcastGlobalSettings(next, { officialModules: { [id]: enabled } });
    } catch {
      const current = useSettingsStore.getState().settings;
      if (current.officialModules?.[id] === enabled) {
        const restored = { ...current.officialModules };
        if (previous === undefined) delete restored[id];
        else restored[id] = previous;
        store.setSettings({ ...current, officialModules: restored });
      }
      setError(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <>
      <BoxedList title={_('Plugins')}>
        {OFFICIAL_MODULES.map((module) => (
          <SettingsSwitchRow
            key={module.id}
            label={_(module.labelKey)}
            checked={isOfficialModuleEnabled(settings, module.id)}
            disabled={saving}
            onChange={() => void save(module.id)}
            data-setting-id={`settings.general.module.${module.id}`}
          />
        ))}
      </BoxedList>
      {error && (
        <p role='alert' className='glossa-supporting-text'>
          {_('Couldn’t save module settings. Please try again.')}
        </p>
      )}
    </>
  );
}
