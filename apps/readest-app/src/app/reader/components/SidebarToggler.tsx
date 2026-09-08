import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import React from 'react';
import { PanelLeft } from '@/components/GlossaIcons';

import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import Button from '@/components/Button';

interface SidebarTogglerProps {
  bookKey: string;
}

const SidebarToggler: React.FC<SidebarTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(18);
  const { sideBarBookKey, isSideBarVisible, setSideBarBookKey, toggleSideBar } = useSidebarStore();
  const handleToggleSidebar = () => {
    if (sideBarBookKey === bookKey) {
      toggleSideBar();
    } else {
      setSideBarBookKey(bookKey);
      if (!isSideBarVisible) toggleSideBar();
    }
  };
  return (
    <Button
      icon={<PanelLeft size={iconSize} aria-hidden='true' />}
      className='glossa-icon-button'
      aria-pressed={sideBarBookKey === bookKey && isSideBarVisible}
      aria-expanded={sideBarBookKey === bookKey && isSideBarVisible}
      onClick={handleToggleSidebar}
      label={_('Toggle Sidebar')}
    />
  );
};

export default SidebarToggler;
