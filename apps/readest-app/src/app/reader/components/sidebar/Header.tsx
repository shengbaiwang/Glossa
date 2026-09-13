import clsx from 'clsx';
import React, { useRef } from 'react';
import { Search, PanelLeft, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const SidebarHeader: React.FC<{
  children?: React.ReactNode;
  isSearchBarVisible: boolean;
  onClose: () => void;
  onToggleSearchBar: () => void;
}> = ({ children, isSearchBarVisible, onClose, onToggleSearchBar }) => {
  const _ = useTranslation();
  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const iconSize18 = useResponsiveSize(18);

  return (
    <div
      ref={headerRef}
      className={clsx(
        'sidebar-header glossa-reader-panel-header flex h-11 items-center justify-between pe-2',
        isTrafficLightVisible ? 'ps-1.5 sm:ps-20' : 'ps-1.5',
      )}
      dir='ltr'
    >
      <button
        type='button'
        title={_('Toggle Sidebar')}
        aria-label={_('Toggle Sidebar')}
        onClick={onClose}
        className='glossa-sidebar-collapse glossa-icon-button touch-target btn btn-ghost h-8 min-h-8 w-8 shrink-0 p-0'
      >
        <PanelLeft size={iconSize18} className='hidden sm:block' aria-hidden='true' />
        <X size={iconSize18} className='sm:hidden' aria-hidden='true' />
      </button>
      {children}
      <div className='flex items-center gap-2'>
        <button
          type='button'
          title={isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
          aria-label={isSearchBarVisible ? _('Hide Search Bar') : _('Show Search Bar')}
          aria-expanded={isSearchBarVisible}
          aria-pressed={isSearchBarVisible}
          onClick={onToggleSearchBar}
          className='glossa-icon-button touch-target btn btn-ghost h-8 min-h-8 w-8 p-0'
        >
          <Search size={iconSize18} aria-hidden='true' />
        </button>
      </div>
    </div>
  );
};

export default SidebarHeader;
