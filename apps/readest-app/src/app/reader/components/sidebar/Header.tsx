import clsx from 'clsx';
import React, { useRef } from 'react';
import { PanelLeft, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const SidebarHeader: React.FC<{
  children?: React.ReactNode;
  onClose: () => void;
}> = ({ children, onClose }) => {
  const _ = useTranslation();
  const headerRef = useRef<HTMLDivElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const iconSize18 = useResponsiveSize(18);

  return (
    <div
      ref={headerRef}
      className={clsx(
        'sidebar-header glossa-reader-panel-header flex h-11 items-center pe-[var(--glossa-pane-inset)]',
        isTrafficLightVisible
          ? 'ps-[var(--glossa-pane-inset)] sm:ps-20'
          : 'ps-[var(--glossa-pane-inset)]',
      )}
    >
      <button
        type='button'
        title={_('Toggle Sidebar')}
        aria-label={_('Toggle Sidebar')}
        onClick={onClose}
        className='glossa-sidebar-collapse glossa-pane-control'
      >
        <PanelLeft size={iconSize18} className='hidden sm:block' aria-hidden='true' />
        <X size={iconSize18} className='sm:hidden' aria-hidden='true' />
      </button>
      {children}
    </div>
  );
};

export default SidebarHeader;
