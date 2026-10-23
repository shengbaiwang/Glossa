import { useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { Ellipsis, ListTree, MessageSquare, Share2 } from '@/components/GlossaIcons';
import { Toggle } from '@/components/primitives/toggle';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import {
  OFFICIAL_MODULES,
  isOfficialModuleEnabled,
  type OfficialModuleId,
} from '@/glossa/modules/registry';
import { SectionTitle } from './primitives';

export default function OfficialModuleSettings({
  onOpenSettings,
}: {
  onOpenSettings: (id: OfficialModuleId) => void;
}) {
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
      <section aria-label={_('Built-in plugins')}>
        <SectionTitle className='mb-2'>{_('Built-in plugins')}</SectionTitle>
        <div className='glossa-plugin-grid'>
          {OFFICIAL_MODULES.map((module) => {
            const enabled = isOfficialModuleEnabled(settings, module.id);
            const Icon =
              module.id === 'conversation'
                ? MessageSquare
                : module.id === 'mindmap'
                  ? Share2
                  : ListTree;
            return (
              <article
                key={module.id}
                className='glossa-plugin-card glossa-group-card eink-bordered'
                data-setting-id={`settings.plugins.${module.id}`}
                aria-label={_(module.labelKey)}
              >
                <div className='glossa-plugin-card-heading'>
                  <Icon aria-hidden='true' size={22} />
                  <button
                    type='button'
                    className='glossa-icon-button glossa-plugin-settings-button'
                    aria-label={`${_(module.labelKey)} - ${_('Settings')}`}
                    title={_('Settings')}
                    data-plugin-settings={module.id}
                    onClick={() => onOpenSettings(module.id)}
                  >
                    <Ellipsis aria-hidden='true' size={18} />
                  </button>
                </div>
                <h4 className='glossa-plugin-name'>{_(module.labelKey)}</h4>
                <label className='glossa-plugin-toggle'>
                  <span className='glossa-supporting-text'>
                    {_(enabled ? 'Enabled' : 'Disabled')}
                  </span>
                  <Toggle
                    aria-label={_(module.labelKey)}
                    checked={enabled}
                    disabled={saving}
                    onChange={() => void save(module.id)}
                  />
                </label>
              </article>
            );
          })}
        </div>
      </section>
      {error && (
        <p role='alert' className='glossa-supporting-text'>
          {_('Couldn’t save module settings. Please try again.')}
        </p>
      )}
    </>
  );
}
