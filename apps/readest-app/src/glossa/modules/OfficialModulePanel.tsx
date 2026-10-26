import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { MapQuestionDraft } from '@/glossa/mindmap/export';
import type { ReadingPanelProps } from '@/glossa/ui/ReadingPassagePanel';
import { pluginPanelLoaders } from '../plugins/loaders';
import { OFFICIAL_MODULES, isOfficialModuleEnabled, pluginSupportsFormat } from './registry';

type Props = ReadingPanelProps &
  (
    | {
        moduleId: 'conversation';
        ideaDraft?: MapQuestionDraft | null;
        onIdeaDraftConsumed?: () => void;
      }
    | { moduleId: 'mindmap'; onAsk?: (draft: MapQuestionDraft) => void }
    | { moduleId: 'pdfAutoContents' }
  );

class ModuleBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The host owns availability and rendering; feature effects own their cleanup on unmount.
 * Persisted records and pending user edits stay in the existing data services.
 */
export default function OfficialModulePanel(props: Props) {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const [attempt, setAttempt] = useState(0);
  // Recreate rejected lazy loaders on explicit retry, without starting an import here.
  const panels = useMemo(
    () => ({
      conversation: lazy(pluginPanelLoaders.conversation),
      mindmap: lazy(pluginPanelLoaders.mindmap),
      pdfAutoContents: lazy(pluginPanelLoaders.pdfAutoContents),
    }),
    [attempt],
  );
  if (
    !pluginSupportsFormat(
      OFFICIAL_MODULES.find((module) => module.id === props.moduleId),
      props.book.format,
    ) ||
    !isOfficialModuleEnabled(settings, props.moduleId)
  )
    return null;
  return (
    <ModuleBoundary
      key={`${props.moduleId}:${props.book.hash}:${props.bookKey}:${attempt}`}
      fallback={
        <div className='glossa-reader-muted px-4 py-3' role='alert'>
          <p>{_('This module could not be opened.')}</p>
          <button
            type='button'
            className='glossa-button'
            onClick={() => setAttempt((value) => value + 1)}
          >
            {_('Try again')}
          </button>
        </div>
      }
    >
      <Suspense
        fallback={
          <p className='glossa-reader-muted px-4 py-3' role='status'>
            {_('Loading...')}
          </p>
        }
      >
        {props.moduleId === 'conversation' ? (
          <panels.conversation {...props} />
        ) : props.moduleId === 'mindmap' ? (
          <panels.mindmap {...props} />
        ) : (
          <panels.pdfAutoContents {...props} />
        )}
      </Suspense>
    </ModuleBoundary>
  );
}
