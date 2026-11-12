import { useState } from 'react';
import type { ZoteroSource } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { isPluginEnabled } from '@/glossa/plugins/registry';
import { isTauriAppPlatform } from '@/services/environment';
/** A saved source snapshot remains readable while offline or with the plugin disabled. */
export default function ZoteroSourceInfo({ source }: { source: ZoteroSource }) {
  const _ = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const [failed, setFailed] = useState(false);
  return (
    <div className='space-y-1 py-2 text-sm'>
      <p className='font-medium'>{_('Zotero reference')}</p>
      <p className='break-words'>{source.title}</p>
      <p>{[source.creators, source.date, source.publicationTitle].filter(Boolean).join(' · ')}</p>
      {source.DOI && <p className='break-all'>DOI: {source.DOI}</p>}
      {isTauriAppPlatform() &&
        isPluginEnabled(settings, 'zotero') &&
        /^[A-Z0-9]{8}$/.test(source.itemKey) && (
          <button
            type='button'
            className='glossa-button eink-bordered'
            onClick={async () => {
              setFailed(false);
              try {
                const { openUrl } = await import('@tauri-apps/plugin-opener');
                await openUrl(`zotero://select/library/items/${source.itemKey}`);
              } catch {
                setFailed(true);
              }
            }}
          >
            {_('Show in Zotero')}
          </button>
        )}
      {failed && <p role='alert'>{_('Could not open Zotero. Please retry.')}</p>}
    </div>
  );
}
