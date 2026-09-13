import React, { useRef } from 'react';
import { NotebookPen, Ellipsis, Pin, PinOff, X } from '@/components/GlossaIcons';
import Dropdown from '@/components/Dropdown';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';
import { useDropdownContext } from '@/context/DropdownContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const NotebookHeader: React.FC<{
  isPinned: boolean;
  handleClose: () => void;
  handleTogglePin: () => void;
  children?: React.ReactNode;
}> = ({ isPinned, handleClose, handleTogglePin, children }) => {
  const _ = useTranslation();
  const iconSize18 = useResponsiveSize(18);
  const headerRef = useRef<HTMLDivElement>(null);
  const dropdown = useDropdownContext();
  const closeMenu = () => {
    dropdown?.closeAll();
    headerRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
  };

  return (
    <div ref={headerRef} className='notebook-header glossa-reader-panel-header'>
      {children || (
        <>
          <NotebookPen size={iconSize18} className='shrink-0' aria-hidden='true' />
          <h2 className='notebook-title min-w-0 flex-1 truncate text-sm font-semibold'>
            {_('Notebook')}
          </h2>
        </>
      )}
      <Dropdown
        label={_('View Options')}
        showTooltip={false}
        className='dropdown-end dropdown-bottom'
        buttonClassName='glossa-icon-button btn btn-ghost h-8 min-h-8 w-8 p-0'
        containerClassName='glossa-notebook-options hidden h-8 shrink-0 sm:flex'
        toggleButton={<Ellipsis size={iconSize18} aria-hidden='true' />}
      >
        <Menu
          className='glossa-notebook-menu dropdown-content no-triangle mt-2'
          onCancel={closeMenu}
        >
          <MenuItem
            label={isPinned ? _('Unpin Notebook') : _('Pin Notebook')}
            Icon={
              isPinned ? (
                <PinOff size={iconSize18} aria-hidden='true' />
              ) : (
                <Pin size={iconSize18} aria-hidden='true' />
              )
            }
            onClick={() => {
              handleTogglePin();
              closeMenu();
            }}
          />
        </Menu>
      </Dropdown>
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
