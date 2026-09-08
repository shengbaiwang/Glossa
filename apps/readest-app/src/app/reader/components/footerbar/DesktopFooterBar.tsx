import clsx from 'clsx';
import React from 'react';
import { useReaderStore } from '@/store/readerStore';
import type { FooterBarChildProps } from './types';
import { HistoryNavigation, PageNavigation, SectionNavigation } from './NavigationControls';
import ProgressSlider from './ProgressSlider';

const DesktopFooterBar: React.FC<FooterBarChildProps> = ({
  bookKey,
  gridInsets,
  progressValid,
  progressFraction,
  navigationHandlers,
  forceMobileLayout,
}) => {
  const { hoveredBookKey, getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const showButtons = !viewSettings?.showPaginationButtons;
  const controls = { rtl: viewSettings?.rtl, handlers: navigationHandlers };
  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;

  return (
    <div
      className={clsx(
        'glossa-reader-navigation hidden h-8 w-full items-center px-4',
        !forceMobileLayout && 'sm:flex',
      )}
      style={{ bottom: isMobile ? `${gridInsets.bottom * 0.33}px` : '0px' }}
    >
      <HistoryNavigation
        {...controls}
        canGoBack={view?.history.canGoBack}
        canGoForward={view?.history.canGoForward}
      />
      <div className='glossa-navigation-primary'>
        <PageNavigation
          {...controls}
          bookKey={bookKey}
          progressValid={progressValid}
          showButtons={showButtons}
        />
        <ProgressSlider
          value={progressValid ? progressFraction * 100 : 0}
          disabled={!progressValid}
          active={hoveredBookKey === bookKey}
          onCommit={navigationHandlers.onProgressChange}
        />
      </div>
      {showButtons ? (
        <SectionNavigation {...controls} />
      ) : (
        <div className='glossa-navigation-spacer' />
      )}
    </div>
  );
};

export default DesktopFooterBar;
