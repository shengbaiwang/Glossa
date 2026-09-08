import clsx from 'clsx';
import React, { useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Undo2, Redo2, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { NavigationHandlers } from './types';
import { getNavigationIcon } from './utils';
import Button from '@/components/Button';
import Slider from '@/components/Slider';
import PageJumpInput from './PageJumpInput';

interface NavigationPanelProps {
  bookKey: string;
  actionTab: string;
  progressFraction: number;
  progressValid: boolean;
  navigationHandlers: NavigationHandlers;
  bottomOffset: string;
  sliderHeight: number;
  forceMobileLayout: boolean;
}

export const NavigationPanel: React.FC<NavigationPanelProps> = ({
  bookKey,
  actionTab,
  progressFraction,
  progressValid,
  navigationHandlers,
  bottomOffset,
  sliderHeight,
  forceMobileLayout,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey);

  const [progressValue, setProgressValue] = React.useState(
    progressValid ? progressFraction * 100 : 0,
  );

  useEffect(() => {
    if (progressValid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgressValue(progressFraction * 100);
    }
  }, [progressValid, progressFraction]);

  const handleProgressChange = useCallback(
    (value: number) => {
      setProgressValue(value);
      navigationHandlers.onProgressChange(value);
    },
    [navigationHandlers],
  );

  const classes = clsx(
    'footerbar-progress-mobile not-eink:bg-base-200 eink:bg-base-100 absolute flex w-full flex-col items-center gap-y-8 px-4 transition-all',
    'eink:border-base-content eink:border-t',
    !forceMobileLayout && 'sm:hidden',
    // Paddings stay constant in both states (the slide is transform-only) so
    // offsetHeight always reports the panel's settled height; the TTS mini
    // player measures it to stack above the expanded panel.
    'pb-4 pt-8',
    actionTab === 'progress'
      ? 'pointer-events-auto translate-y-0 ease-out'
      : 'pointer-events-none invisible translate-y-full overflow-hidden ease-in',
  );

  return (
    <div
      className={classes}
      style={{
        bottom: appService?.isAndroidApp
          ? `calc(env(safe-area-inset-bottom) + 64px)`
          : bottomOffset,
      }}
    >
      <div className='flex w-full flex-col items-center gap-y-4'>
        {progressValid && (
          <div className='eink-bordered bg-base-100 rounded-full px-2 py-1'>
            <PageJumpInput bookKey={bookKey} showFraction className='text-base' />
          </div>
        )}
        <div className='flex w-full items-center justify-between gap-x-6'>
          <Slider
            label={_('Reading Progress')}
            heightPx={sliderHeight}
            bubbleLabel={`${Math.round(progressValue)}%`}
            initialValue={progressValue}
            onChange={handleProgressChange}
          />
        </div>
      </div>
      <div className='flex w-full items-center justify-between gap-x-6'>
        <Button
          className='glossa-icon-button'
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <ChevronsLeft size={18} aria-hidden='true' />,
            <ChevronsRight size={18} aria-hidden='true' />,
          )}
          onClick={navigationHandlers.onPrevSection}
          label={_('Previous Section')}
        />
        <Button
          className='glossa-icon-button'
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <ChevronLeft size={18} aria-hidden='true' />,
            <ChevronRight size={18} aria-hidden='true' />,
          )}
          onClick={navigationHandlers.onPrevPage}
          label={_('Previous Page')}
        />
        <Button
          className='glossa-icon-button'
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <Undo2 size={18} aria-hidden='true' />,
            <Redo2 size={18} aria-hidden='true' />,
          )}
          onClick={navigationHandlers.onGoBack}
          label={_('Go Back')}
          disabled={!view?.history.canGoBack}
        />
        <Button
          className='glossa-icon-button'
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <Redo2 size={18} aria-hidden='true' />,
            <Undo2 size={18} aria-hidden='true' />,
          )}
          onClick={navigationHandlers.onGoForward}
          label={_('Go Forward')}
          disabled={!view?.history.canGoForward}
        />
        <Button
          className='glossa-icon-button'
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <ChevronRight size={18} aria-hidden='true' />,
            <ChevronLeft size={18} aria-hidden='true' />,
          )}
          onClick={navigationHandlers.onNextPage}
          label={_('Next Page')}
        />
        <Button
          className='glossa-icon-button'
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <ChevronsRight size={18} aria-hidden='true' />,
            <ChevronsLeft size={18} aria-hidden='true' />,
          )}
          onClick={navigationHandlers.onNextSection}
          label={_('Next Section')}
        />
      </div>
    </div>
  );
};
