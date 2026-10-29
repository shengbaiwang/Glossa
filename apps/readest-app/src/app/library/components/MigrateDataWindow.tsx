import { lazy } from 'react';
import DeferredDialogWindow from '@/components/DeferredDialogWindow';

const Dialog = lazy(() => import('./MigrateDataDialog'));

export const setMigrateDataDirDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('migrate_data_dir_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const MigrateDataWindow = () => (
  <DeferredDialogWindow id='migrate_data_dir_window'>
    <Dialog />
  </DeferredDialogWindow>
);
