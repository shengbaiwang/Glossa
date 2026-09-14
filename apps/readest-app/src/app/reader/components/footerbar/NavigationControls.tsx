import React from 'react';
import { ChevronLeft, ChevronRight, Undo2, Redo2 } from '@/components/GlossaIcons';
import Button from '@/components/Button';
import { useTranslation } from '@/hooks/useTranslation';
import type { NavigationHandlers } from './types';
import { getNavigationIcon } from './utils';
import PageJumpInput from './PageJumpInput';

interface NavigationControlProps {
  rtl?: boolean;
  handlers: NavigationHandlers;
}

export const PageNavigation: React.FC<
  NavigationControlProps & {
    bookKey: string;
    progressValid: boolean;
    showButtons?: boolean;
  }
> = ({ bookKey, progressValid, rtl, handlers, showButtons = true }) => {
  const _ = useTranslation();
  return (
    <div className='glossa-page-navigation' role='group' aria-label={_('Go to Page')}>
      {showButtons && (
        <Button
          icon={getNavigationIcon(rtl, <ChevronLeft size={18} />, <ChevronRight size={18} />)}
          onClick={handlers.onPrevPage}
          onLongPress={handlers.onPrevSection}
          label={_('Previous Page')}
        />
      )}
      {progressValid && <PageJumpInput bookKey={bookKey} showFraction />}
      {showButtons && (
        <Button
          icon={getNavigationIcon(rtl, <ChevronRight size={18} />, <ChevronLeft size={18} />)}
          onClick={handlers.onNextPage}
          onLongPress={handlers.onNextSection}
          label={_('Next Page')}
        />
      )}
    </div>
  );
};

export const HistoryNavigation: React.FC<
  NavigationControlProps & {
    canGoBack?: boolean;
    canGoForward?: boolean;
  }
> = ({ rtl, handlers, canGoBack, canGoForward }) => {
  const _ = useTranslation();
  return (
    <div className='glossa-navigation-secondary'>
      <Button
        icon={getNavigationIcon(rtl, <Undo2 size={18} />, <Redo2 size={18} />)}
        onClick={handlers.onGoBack}
        label={_('Go Back')}
        disabled={!canGoBack}
      />
      <Button
        icon={getNavigationIcon(rtl, <Redo2 size={18} />, <Undo2 size={18} />)}
        onClick={handlers.onGoForward}
        label={_('Go Forward')}
        disabled={!canGoForward}
      />
    </div>
  );
};
