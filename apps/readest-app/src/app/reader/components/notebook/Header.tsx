import React from 'react';
import { NotebookPen, PanelRight, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const NotebookHeader: React.FC<{
  handleClose: () => void;
  children?: React.ReactNode;
}> = ({ handleClose, children }) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);

  return (
    <div className='notebook-header glossa-reader-panel-header'>
      {children || (
        <>
          <NotebookPen size={iconSize18} className='shrink-0' aria-hidden='true' />
          <h2 className='notebook-title min-w-0 flex-1 truncate text-sm font-semibold'>
            {_('Notebook')}
          </h2>
        </>
      )}
      <button
        type='button'
        title={_('Close')}
        aria-label={_('Close')}
        onClick={handleClose}
        className='glossa-notebook-collapse glossa-icon-button touch-target btn btn-ghost h-8 min-h-8 w-8 shrink-0 p-0'
      >
        <PanelRight size={iconSize18} className='hidden sm:block' aria-hidden='true' />
        <X size={iconSize18} className='sm:hidden' aria-hidden='true' />
      </button>
    </div>
  );
};

export default NotebookHeader;
