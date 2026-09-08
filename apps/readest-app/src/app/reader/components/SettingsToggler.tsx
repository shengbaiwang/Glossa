import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import React from 'react';
import { Type } from '@/components/GlossaIcons';

import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import Button from '@/components/Button';

interface SettingsTogglerProps {
  bookKey: string;
}

const SettingsToggler: React.FC<SettingsTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(18);
  const { setHoveredBookKey } = useReaderStore();
  const { isSettingsDialogOpen, setSettingsDialogOpen } = useSettingsStore();
  const { setSettingsDialogBookKey } = useSettingsStore();
  const handleToggleSettings = () => {
    setHoveredBookKey('');
    setSettingsDialogBookKey(bookKey);
    setSettingsDialogOpen(!isSettingsDialogOpen);
  };
  return (
    <Button
      icon={<Type size={iconSize} aria-hidden='true' />}
      className='glossa-icon-button'
      aria-expanded={isSettingsDialogOpen}
      onClick={handleToggleSettings}
      label={_('Font & Layout')}
    ></Button>
  );
};

export default SettingsToggler;
