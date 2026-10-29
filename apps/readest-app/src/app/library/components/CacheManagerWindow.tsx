import { lazy } from 'react';
import DeferredDialogWindow from '@/components/DeferredDialogWindow';

const Dialog = lazy(() => import('./CacheManagerDialog'));

export const setCacheManagerDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('cache_manager_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const CacheManagerWindow = () => (
  <DeferredDialogWindow id='cache_manager_window'>
    <Dialog />
  </DeferredDialogWindow>
);

export default CacheManagerWindow;
