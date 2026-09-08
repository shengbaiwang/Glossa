import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { saveViewSettings } from '@/helpers/settings';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { TRANSLATED_LANGS } from '@/services/constants';
import { getDirFromLanguage } from '@/utils/rtl';
import type { SettingsPanelPanelProp } from './SettingsDialog';
import { BoxedList, SettingsRow, SettingsSelect } from './primitives';

const LangPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, applyUILanguage } = useSettingsStore();
  const viewSettings =
    useReaderStore((s) => s.getViewSettings(bookKey)) || settings.globalViewSettings;
  const [uiLanguage, setUILanguage] = useState(viewSettings.uiLanguage);
  const resetToDefaults = useResetViewSettings();

  useEffect(() => {
    onRegisterReset(() => resetToDefaults({ uiLanguage: setUILanguage }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (uiLanguage === viewSettings.uiLanguage) return;
    const sameDir = getDirFromLanguage(uiLanguage) === getDirFromLanguage(viewSettings.uiLanguage);
    applyUILanguage(uiLanguage);
    void saveViewSettings(envConfig, bookKey, 'uiLanguage', uiLanguage, false, false).then(() => {
      if (!sameDir) window.location.reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiLanguage]);

  const options = Object.entries(TRANSLATED_LANGS)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  options.unshift({ value: '', label: _('System Language') });

  return (
    <div className='my-4 w-full'>
      <BoxedList title={_('Language')} data-setting-id='settings.language.interfaceLanguage'>
        <SettingsRow label={_('Language')}>
          <SettingsSelect
            value={uiLanguage}
            onChange={(event) => setUILanguage(event.target.value)}
            ariaLabel={_('Language')}
            options={options}
          />
        </SettingsRow>
      </BoxedList>
    </div>
  );
};

export default LangPanel;
