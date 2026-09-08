import clsx from 'clsx';
import React, { useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Undo2, Redo2, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { FooterBarChildProps } from './types';
import { getNavigationIcon } from './utils';
import Button from '@/components/Button';
import PageJumpInput from './PageJumpInput';

const DesktopFooterBar: React.FC<FooterBarChildProps> = ({
  bookKey,
  gridInsets,
  progressValid,
  progressFraction,
  navigationHandlers,
  forceMobileLayout,
}) => {
  const _ = useTranslation();
  const { hoveredBookKey, getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);

  const viewSettings = getViewSettings(bookKey);

  const [progressValue, setProgressValue] = React.useState(
    progressValid ? progressFraction * 100 : 0,
  );

  const rangeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hoveredBookKey !== bookKey) {
      if (rangeInputRef.current && document.activeElement === rangeInputRef.current) {
        rangeInputRef.current.blur();
      }
    }
  }, [hoveredBookKey, bookKey]);

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

  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;

  return (
    <div
      className={clsx(
        'glossa-reader-navigation hidden h-8 w-full items-center gap-x-2 overflow-x-auto px-4',
        !forceMobileLayout && 'sm:flex',
      )}
      style={{
        bottom: isMobile ? `${gridInsets.bottom * 0.33}px` : '0px',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      {!viewSettings?.showPaginationButtons && (
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
      )}
      {!viewSettings?.showPaginationButtons && (
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
      )}
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
      {progressValid && <PageJumpInput bookKey={bookKey} className='mx-2 text-sm' />}
      <input
        ref={rangeInputRef}
        type='range'
        className='glossa-reader-range text-base-content mx-3 min-w-0 flex-1'
        min={0}
        max={100}
        aria-label={_('Jump to Location')}
        aria-valuetext={`${Math.round(progressValue)}%`}
        value={progressValue}
        onChange={(e) => handleProgressChange(parseInt(e.target.value, 10))}
      />

      {!viewSettings?.showPaginationButtons && (
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
      )}
      {!viewSettings?.showPaginationButtons && (
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
      )}
    </div>
  );
};

export default DesktopFooterBar;
