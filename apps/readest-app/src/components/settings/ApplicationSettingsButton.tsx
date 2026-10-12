import React from 'react';
import { Settings2 } from '@/components/GlossaIcons';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';

const ApplicationSettingsButton: React.FC = () => {
  const _ = useTranslation();
  const { openSettingsDialog, isSettingsDialogOpen, settingsDialogScope } = useSettingsStore();
  return (
    <button
      type='button'
      aria-expanded={isSettingsDialogOpen && settingsDialogScope === 'application'}
      aria-label={_('Settings')}
      title={_('Settings')}
      className='touch-target glossa-icon-button'
      onClick={() => openSettingsDialog('application')}
    >
      <Settings2 size={18} aria-hidden='true' />
    </button>
  );
};
export default ApplicationSettingsButton;
