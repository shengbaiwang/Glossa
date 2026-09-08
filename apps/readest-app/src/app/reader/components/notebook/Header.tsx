import React from 'react';
import { Search, NotebookPen, Pin, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const NotebookHeader: React.FC<{
  isPinned: boolean;
  isSearchBarVisible: boolean;
  handleClose: () => void;
  handleTogglePin: () => void;
  handleToggleSearchBar: () => void;
  showSearchButton?: boolean;
}> = ({
  isPinned,
  isSearchBarVisible,
  handleClose,
  handleTogglePin,
  handleToggleSearchBar,
  showSearchButton = true,
}) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);
  return (
    <div className='notebook-header glossa-reader-panel-header flex h-11 items-center gap-2 px-3'>
      <NotebookPen size={iconSize18} className='shrink-0' aria-hidden='true' />
      <h2 className='notebook-title min-w-0 flex-1 truncate text-sm font-semibold'>
        {_('Notebook')}
      </h2>
      <button
        type='button'
        title={isPinned ? _('Unpin Notebook') : _('Pin Notebook')}
        aria-label={isPinned ? _('Unpin Notebook') : _('Pin Notebook')}
        aria-pressed={isPinned}
        onClick={handleTogglePin}
        className='glossa-icon-button touch-target btn btn-ghost hidden h-8 min-h-8 w-8 p-0 sm:flex'
      >
        <Pin size={iconSize18} fill={isPinned ? 'currentColor' : 'none'} aria-hidden='true' />
      </button>
      {showSearchButton && (
        <button
          type='button'
          title={isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
          aria-label={isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
          aria-expanded={isSearchBarVisible}
          aria-pressed={isSearchBarVisible}
          onClick={handleToggleSearchBar}
          className='glossa-icon-button touch-target btn btn-ghost h-8 min-h-8 w-8 shrink-0 p-0'
        >
          <Search size={iconSize18} aria-hidden='true' />
        </button>
      )}
      <button
        type='button'
        title={_('Close')}
        aria-label={_('Close')}
        onClick={handleClose}
        className='glossa-icon-button touch-target btn btn-ghost h-8 min-h-8 w-8 shrink-0 p-0'
      >
        <X size={iconSize18} aria-hidden='true' />
      </button>
    </div>
  );
};

export default NotebookHeader;
