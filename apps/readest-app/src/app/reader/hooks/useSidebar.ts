import { useEffect } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';

const useSidebar = (initialWidth: string) => {
  const { settings } = useSettingsStore();
  const {
    sideBarWidth,
    isSideBarVisible,
    getSideBarWidth,
    setSideBarWidth,
    setSideBarVisible,
    toggleSideBar,
  } = useSidebarStore();

  useEffect(() => {
    setSideBarWidth(initialWidth);
    setSideBarVisible(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSideBarResize = (newWidth: string) => {
    setSideBarWidth(newWidth);
    settings.globalReadSettings.sideBarWidth = newWidth;
  };

  return {
    sideBarWidth,
    isSideBarVisible,
    getSideBarWidth,
    handleSideBarResize,
    setSideBarVisible,
    toggleSideBar,
  };
};

export default useSidebar;
