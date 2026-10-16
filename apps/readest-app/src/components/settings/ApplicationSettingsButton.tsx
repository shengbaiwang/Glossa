import React from 'react';
import { Settings } from '@/components/GlossaIcons';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';

const ApplicationSettingsButton: React.FC<{ variant?: 'icon' | 'navigation' }> = ({
  variant = 'icon',
}) => {
  const _ = useTranslation();
  const { openSettingsDialog, isSettingsDialogOpen, settingsDialogScope } = useSettingsStore();
  return (
    <button
      type='button'
      aria-expanded={isSettingsDialogOpen && settingsDialogScope === 'application'}
      aria-label={_('Settings')}
      title={_('Settings')}
      className={
        variant === 'navigation'
          ? 'touch-target glossa-library-settings-button'
          : 'touch-target glossa-icon-button'
      }
      onClick={() => openSettingsDialog('application')}
    >
      <Settings size={variant === 'navigation' ? 20 : 18} aria-hidden='true' />
      {variant === 'navigation' && <span>{_('Settings')}</span>}
    </button>
  );
};
export default ApplicationSettingsButton;
