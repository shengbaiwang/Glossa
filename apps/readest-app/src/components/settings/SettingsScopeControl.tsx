import React, { useState } from 'react';
import clsx from 'clsx';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';

const SettingsScopeControl: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings, setViewSettings } = useReaderStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const isGlobal = getViewSettings(bookKey)?.isGlobal ?? true;
  const selectScope = async (global: boolean) => {
    if (saving || global === isGlobal) return;
    setSaving(true);
    setError(false);
    try {
      await saveViewSettings(envConfig, bookKey, 'isGlobal', global, true, false, true);
    } catch {
      const current = getViewSettings(bookKey);
      if (current) setViewSettings(bookKey, { ...current, isGlobal });
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className='glossa-settings-scope'>
      <div
        role='radiogroup'
        aria-label={_('Apply Settings To')}
        aria-busy={saving}
        className='glossa-font-segments'
      >
        {[
          { global: false, label: _('This Book Only') },
          { global: true, label: _('All Books Default') },
        ].map(({ global, label }) => (
          <button
            key={String(global)}
            type='button'
            role='radio'
            aria-checked={isGlobal === global}
            aria-disabled={saving}
            tabIndex={isGlobal === global ? 0 : -1}
            className={clsx('glossa-button', isGlobal === global && 'glossa-scope-selected')}
            onClick={() => void selectScope(global)}
            onKeyDownCapture={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                void selectScope(!isGlobal);
                const buttons =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button');
                buttons?.[isGlobal ? 0 : 1]?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role='alert' className='glossa-supporting-text'>
          {_('Failed to save settings')}
        </p>
      )}
    </div>
  );
};

export default SettingsScopeControl;
