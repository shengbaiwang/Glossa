import { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { saveViewSettings } from '@/helpers/settings';
import NumberInput from './NumberInput';
import { BoxedList } from './primitives';

export default function SpeechPanel() {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const [draft, setDraft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const rate = draft ?? settings.globalViewSettings.ttsRate;
  const saveRate = async (value: number) => {
    setDraft(value);
    setSaving(true);
    setFailed(false);
    try {
      await saveViewSettings(envConfig, '', 'ttsRate', value, false, false);
      setDraft(null);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className='my-4'>
      <BoxedList title={_('Read Aloud')}>
        <NumberInput
          label={_('Speed')}
          value={rate ?? 1.3}
          min={0.5}
          max={3}
          step={0.1}
          data-setting-id='settings.speech.rate'
          disabled={saving}
          onChange={(value) => {
            void saveRate(value);
          }}
        />
      </BoxedList>
      {failed && (
        <div role='alert' className='glossa-font-status'>
          <span>{_('Failed to save settings')}</span>
          <button
            type='button'
            className='glossa-button'
            disabled={saving}
            onClick={() => {
              void saveRate(rate);
            }}
          >
            {_('Retry')}
          </button>
        </div>
      )}
    </div>
  );
}
