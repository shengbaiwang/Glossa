import { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { saveReadingDefaults } from '@/helpers/settings';

export default function SettingsScopeControl({ bookKey }: { bookKey: string }) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  return (
    <div className='glossa-settings-scope'>
      <span>{_('This Book Only')}</span>
      <button
        type='button'
        className='glossa-button'
        disabled={saving}
        aria-busy={saving}
        onClick={async () => {
          if (saving) return;
          setSaving(true);
          setStatus('idle');
          try {
            await saveReadingDefaults(envConfig, bookKey);
            setStatus('saved');
          } catch {
            setStatus('error');
          } finally {
            setSaving(false);
          }
        }}
      >
        {_('Set as Reading Defaults')}
      </button>
      {status !== 'idle' && (
        <p role={status === 'error' ? 'alert' : 'status'} className='glossa-supporting-text'>
          {status === 'error' ? _('Failed to save settings') : _('Reading defaults saved')}
        </p>
      )}
    </div>
  );
}
