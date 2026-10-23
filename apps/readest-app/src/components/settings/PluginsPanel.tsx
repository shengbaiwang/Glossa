import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from '@/components/GlossaIcons';
import { OFFICIAL_MODULES, type OfficialModuleId } from '@/glossa/modules/registry';
import { useTranslation } from '@/hooks/useTranslation';
import OfficialModuleSettings from './OfficialModuleSettings';
import PDFContentsSettings from './PDFContentsSettings';
import { BoxedList, SettingsRow } from './primitives';

const ModelSettingsPanel = lazy(() => import('@/glossa/ui/ModelSettingsPanel'));
const PromptSettingsPanel = lazy(() => import('@/glossa/ui/PromptSettingsPanel'));
export type PluginSettingsTarget = OfficialModuleId | 'models';

export default function PluginsPanel({
  initialSettings = null,
}: {
  initialSettings?: PluginSettingsTarget | null;
}) {
  const _ = useTranslation();
  const [selected, setSelected] = useState<OfficialModuleId | null>(
    initialSettings === 'models' ? 'conversation' : initialSettings,
  );
  const [section, setSection] = useState(initialSettings === 'models' ? 'models' : 'prompts');
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<OfficialModuleId | null>(null);
  useEffect(() => {
    if (selected) heading.current?.focus();
    else if (returnFocus.current) {
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-plugin-settings="${returnFocus.current}"]`)
        ?.focus();
      returnFocus.current = null;
    }
  }, [selected]);
  const module = OFFICIAL_MODULES.find((item) => item.id === selected);
  return (
    <div ref={root} className='my-4 space-y-6'>
      {module ? (
        <>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              className='glossa-icon-button glossa-plugin-settings-button'
              aria-label={_('Back to plugins')}
              title={_('Back to plugins')}
              onClick={() => {
                returnFocus.current = module.id;
                setSelected(null);
              }}
            >
              <ArrowLeft aria-hidden='true' size={18} className='rtl:rotate-180' />
            </button>
            <h3 ref={heading} tabIndex={-1} className='glossa-dialog-title'>
              {_(module.labelKey)}
            </h3>
          </div>
          {selected === 'conversation' && (
            <div
              className='flex flex-wrap gap-2'
              role='group'
              aria-label={_('Conversation settings')}
            >
              {(['prompts', 'models'] as const).map((tab) => (
                <button
                  key={tab}
                  type='button'
                  className='glossa-button eink-bordered'
                  aria-pressed={section === tab}
                  onClick={() => setSection(tab)}
                >
                  {_(tab === 'prompts' ? 'Prompts' : 'Model Services')}
                </button>
              ))}
            </div>
          )}
          <Suspense fallback={<p role='status'>{_('Loading...')}</p>}>
            {selected === 'pdfAutoContents' ? null : selected === 'conversation' &&
              section === 'prompts' ? (
              <PromptSettingsPanel />
            ) : (
              <ModelSettingsPanel />
            )}
          </Suspense>
        </>
      ) : null}
      <div hidden={selected !== 'pdfAutoContents'}>
        <PDFContentsSettings />
      </div>
      <div hidden={Boolean(module)} className='space-y-6'>
        <OfficialModuleSettings
          onOpenSettings={(id) => {
            setSection('prompts');
            setSelected(id);
          }}
        />
        <BoxedList title={_('Third-party plugins')}>
          <SettingsRow label={_('Installation is not available yet.')} />
        </BoxedList>
      </div>
    </div>
  );
}
