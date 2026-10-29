import React, { lazy } from 'react';
import DeferredDialogWindow from '@/components/DeferredDialogWindow';

const Dialog = lazy(() => import('./BackupDialog'));

export const setBackupDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('backup_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const BackupWindow: React.FC<{
  onPullLibrary?: (fullRefresh?: boolean, verbose?: boolean) => void;
}> = (props) => (
  <DeferredDialogWindow id='backup_window'>
    <Dialog {...props} />
  </DeferredDialogWindow>
);
