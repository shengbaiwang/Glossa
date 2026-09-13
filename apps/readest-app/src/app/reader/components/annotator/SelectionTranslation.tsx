import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { googleProvider } from '@/services/translators/providers/google';
import { TRANSLATOR_LANGS } from '@/services/constants';
import { useSettingsStore } from '@/store/settingsStore';
import { X } from '@/components/GlossaIcons';

export default function SelectionTranslation({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  const _ = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const [target, setTarget] = useState(() => {
    const saved = settings.globalReadSettings.translateTargetLang?.toLowerCase();
    return (
      Object.keys(TRANSLATOR_LANGS).find((key) => key && key.toLowerCase() === saved) ||
      (saved === 'zh' ? 'zh-CN' : 'en')
    );
  });
  const [result, setResult] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 20000);
    let closed = false;
    setStatus('loading');
    setResult('');
    void googleProvider
      .translate([text], 'auto', target, undefined, false, abort.signal)
      .then((items) => {
        if (!closed) {
          setResult(items[0] || '');
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!closed) setStatus('error');
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      closed = true;
      clearTimeout(timeout);
      abort.abort();
    };
  }, [text, target, retry]);
  return (
    <div className='glossa-selection-translation'>
      <div className='flex items-center gap-2'>
        <span className='min-w-0 flex-1 truncate text-sm'>{_('Google Translate')}</span>
        <select
          aria-label={_('Target Language')}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          {Object.entries(TRANSLATOR_LANGS)
            .filter(([value]) => value)
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </select>
        <button
          className='glossa-icon-button touch-target'
          aria-label={_('Close')}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className='mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed' role='status'>
        {status === 'loading'
          ? _('Translating...')
          : status === 'error'
            ? _('Translation failed')
            : result}
      </div>
      {status === 'error' && (
        <button className='glossa-button mt-3' onClick={() => setRetry((value) => value + 1)}>
          {_('Retry')}
        </button>
      )}
    </div>
  );
}
