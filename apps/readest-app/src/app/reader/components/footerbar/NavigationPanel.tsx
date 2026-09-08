import clsx from 'clsx';
import React from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { NavigationHandlers } from './types';
import { HistoryNavigation, PageNavigation, SectionNavigation } from './NavigationControls';
import ProgressSlider from './ProgressSlider';

interface NavigationPanelProps {
  bookKey: string;
  actionTab: string;
  progressFraction: number;
  progressValid: boolean;
  navigationHandlers: NavigationHandlers;
  bottomOffset: string;
  forceMobileLayout: boolean;
}

export const NavigationPanel: React.FC<NavigationPanelProps> = ({
  bookKey,
  actionTab,
  progressFraction,
  progressValid,
  navigationHandlers,
  bottomOffset,
  forceMobileLayout,
}) => {
  const { appService } = useEnv();
  const { getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const controls = { rtl: viewSettings?.rtl, handlers: navigationHandlers };

  return (
    <div
      className={clsx(
        'footerbar-progress-mobile glossa-mobile-navigation not-eink:bg-base-200 eink:bg-base-100 absolute flex w-full flex-col items-center gap-y-3 px-5 py-4 transition-[opacity,transform]',
        'eink:border-base-content eink:border-t',
        !forceMobileLayout && 'sm:hidden',
        actionTab === 'progress'
          ? 'pointer-events-auto translate-y-0 ease-out'
          : 'pointer-events-none invisible translate-y-full overflow-hidden ease-in',
      )}
      style={{
        bottom: appService?.isAndroidApp
          ? `calc(env(safe-area-inset-bottom) + 64px)`
          : bottomOffset,
      }}
    >
      <PageNavigation {...controls} bookKey={bookKey} progressValid={progressValid} />
      <ProgressSlider
        value={progressValid ? progressFraction * 100 : 0}
        disabled={!progressValid}
        active={actionTab === 'progress'}
        onCommit={navigationHandlers.onProgressChange}
      />
      <div className='glossa-mobile-navigation-secondary'>
        <HistoryNavigation
          {...controls}
          canGoBack={view?.history.canGoBack}
          canGoForward={view?.history.canGoForward}
        />
        <SectionNavigation {...controls} />
      </div>
    </div>
  );
};
