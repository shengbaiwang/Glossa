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
  const {
    isSettingsDialogOpen,
    settingsDialogScope,
    settingsDialogBookKey,
    openSettingsDialog,
    setSettingsDialogOpen,
  } = useSettingsStore();
  const isOpen =
    isSettingsDialogOpen && settingsDialogScope === 'reading' && settingsDialogBookKey === bookKey;
  const handleToggleSettings = () => {
    setHoveredBookKey('');
    if (isOpen) setSettingsDialogOpen(false);
    else openSettingsDialog('reading', bookKey);
  };
  return (
    <Button
      icon={<Type size={iconSize} aria-hidden='true' />}
      className='glossa-icon-button'
      aria-expanded={isOpen}
      onClick={handleToggleSettings}
      label={_('Reading Appearance')}
    ></Button>
  );
};

export default SettingsToggler;
