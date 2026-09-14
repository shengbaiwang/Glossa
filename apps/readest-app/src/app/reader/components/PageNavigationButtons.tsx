import clsx from 'clsx';
import React, { useCallback } from 'react';
import { ChevronLeft, ChevronRight } from '@/components/GlossaIcons';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLongPress } from '@/hooks/useLongPress';
import { viewPagination } from '../hooks/usePagination';
import { useBookDataStore } from '@/store/bookDataStore';

interface PageNavigationButtonsProps {
  bookKey: string;
  isDropdownOpen: boolean;
}

const PageNavigationButtons: React.FC<PageNavigationButtonsProps> = ({
  bookKey,
  isDropdownOpen,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const getBookData = useBookDataStore((s) => s.getBookData);
  const getView = useReaderStore((s) => s.getView);
  const getViewSettings = useReaderStore((s) => s.getViewSettings);
  // hoveredBookKey is reactive state — drives button visibility.
  const hoveredBookKey = useReaderStore((s) => s.hoveredBookKey);
  const bookData = getBookData(bookKey);
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey);
  // Reactive: drives the aria-live "Page N" announcement and the
  // currentPage label on the buttons. Reads from readerProgressStore.
  const progress = useBookProgress(bookKey);
  const { section, pageinfo } = progress || {};
  const pageInfo = bookData?.isFixedLayout ? section : pageinfo;
  const currentPage = pageInfo?.current;

  const isPageNavigationButtonsVisible =
    (hoveredBookKey === bookKey || isDropdownOpen) && viewSettings?.showPaginationButtons;

  const handleGoLeftPage = useCallback(() => {
    viewPagination(view, viewSettings, 'left', 'page');
  }, [view, viewSettings]);

  const handleGoLeftSection = useCallback(() => {
    viewPagination(view, viewSettings, 'left', 'section', 50, progress?.location);
  }, [view, viewSettings, progress?.location]);

  const handleGoRightPage = useCallback(() => {
    viewPagination(view, viewSettings, 'right', 'page');
  }, [view, viewSettings]);

  const handleGoRightSection = useCallback(() => {
    viewPagination(view, viewSettings, 'right', 'section', 50, progress?.location);
  }, [view, viewSettings, progress?.location]);

  const { handlers: leftHandlers } = useLongPress(
    { onTap: handleGoLeftPage, onLongPress: handleGoLeftSection },
    [handleGoLeftPage, handleGoLeftSection],
  );
  const { handlers: rightHandlers } = useLongPress(
    { onTap: handleGoRightPage, onLongPress: handleGoRightSection },
    [handleGoRightPage, handleGoRightSection],
  );

  const getLeftPageLabel = () => {
    const baseLabel = viewSettings?.rtl ? _('Next Page') : _('Previous Page');
    if (currentPage !== undefined) {
      return `${baseLabel}, ${_('Page {{number}}', { number: currentPage + 1 })}`;
    }
    return baseLabel;
  };

  const getRightPageLabel = () => {
    const baseLabel = viewSettings?.rtl ? _('Previous Page') : _('Next Page');
    if (currentPage !== undefined) {
      return `${baseLabel}, ${_('Page {{number}}', { number: currentPage + 1 })}`;
    }
    return baseLabel;
  };

  return (
    <>
      {currentPage !== undefined && (
        <div className='sr-only' role='status' aria-live='polite' aria-atomic='true'>
          {_('Page {{number}}', { number: currentPage + 1 })}
        </div>
      )}

      <div
        className={clsx(
          'absolute left-2 -translate-y-1/2',
          'flex items-center gap-1',
          isPageNavigationButtonsVisible ? 'top-1/2 opacity-100' : 'bottom-2 opacity-0',
          !isPageNavigationButtonsVisible && !appService?.isAndroidApp ? 'pointer-events-none' : '',
        )}
      >
        <button
          {...leftHandlers}
          className={clsx(
            'flex h-20 w-20 items-center justify-center focus:outline-none',
            !isPageNavigationButtonsVisible && appService?.isAndroidApp && 'h-4 w-4',
          )}
          aria-hidden={false}
          aria-label={getLeftPageLabel()}
          tabIndex={0}
        >
          <span
            className={clsx(
              'flex h-12 w-12 items-center justify-center rounded-full',
              'bg-base-100/90 shadow-lg backdrop-blur-sm',
              'eink:border eink:border-base-content not-eink:group-hover:bg-base-200',
              'transition-transform active:scale-95',
            )}
          >
            <ChevronLeft size={24} />
          </span>
        </button>
      </div>

      <div
        className={clsx(
          'absolute right-2 -translate-y-1/2',
          'flex items-center gap-1',
          isPageNavigationButtonsVisible ? 'top-1/2 opacity-100' : 'bottom-2 opacity-0',
          !isPageNavigationButtonsVisible && !appService?.isAndroidApp ? 'pointer-events-none' : '',
        )}
      >
        <button
          {...rightHandlers}
          className={clsx(
            'flex h-20 w-20 items-center justify-center focus:outline-none',
            !isPageNavigationButtonsVisible && appService?.isAndroidApp && 'h-4 w-4',
          )}
          aria-hidden={false}
          aria-label={getRightPageLabel()}
          tabIndex={0}
        >
          <span
            className={clsx(
              'flex h-12 w-12 items-center justify-center rounded-full',
              'bg-base-100/90 shadow-lg backdrop-blur-sm',
              'eink:border eink:border-base-content not-eink:group-hover:bg-base-200',
              'transition-transform active:scale-95',
            )}
          >
            <ChevronRight size={24} />
          </span>
        </button>
      </div>
    </>
  );
};

export default PageNavigationButtons;
