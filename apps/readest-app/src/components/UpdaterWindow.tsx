import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { GLOSSA_DOWNLOAD_URL } from '@/services/constants';
import type { ResolvedNightlyUpdate } from '@/helpers/updater';
import Dialog from '@/components/Dialog';
import Link from './Link';

// Keep the legacy call shape so an already-open window or saved route cannot
// revive the upstream installer after a Glossa upgrade.
export const UpdaterContent = (_props: {
  latestVersion?: string;
  lastVersion?: string;
  checkUpdate?: boolean;
  nightlyUpdate?: ResolvedNightlyUpdate;
}) => {
  const _ = useTranslation();
  return (
    <div className='bg-base-100 flex min-h-48 flex-col items-center justify-center gap-4 p-6 text-center'>
      <p className='text-base-content text-sm'>
        {_('Automatic updates are not configured for Glossa.')}
      </p>
      <Link
        href={GLOSSA_DOWNLOAD_URL}
        target='_blank'
        rel='noopener noreferrer'
        className='btn btn-contrast'
      >
        {_('View releases')}
      </Link>
    </div>
  );
};

export const setUpdaterWindowVisible = (
  visible: boolean,
  latestVersion: string,
  lastVersion?: string,
  checkUpdate = true,
  nightlyUpdate?: ResolvedNightlyUpdate,
) => {
  const dialog = document.getElementById('updater_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible, latestVersion, lastVersion, checkUpdate, nightlyUpdate },
    });
    dialog.dispatchEvent(event);
  }
};

export const UpdaterWindow = () => {
  const _ = useTranslation();
  const [latestVersion, setLatestVersion] = useState('');
  const [lastVersion, setLastVersion] = useState('');
  const [checkUpdate, setCheckUpdate] = useState(true);
  const [nightlyUpdate, setNightlyUpdate] = useState<ResolvedNightlyUpdate | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      const { visible, latestVersion, lastVersion, checkUpdate, nightlyUpdate } = event.detail;
      setIsOpen(visible);
      setCheckUpdate(checkUpdate);
      setNightlyUpdate(nightlyUpdate);
      if (latestVersion) {
        setLatestVersion(latestVersion);
      }
      if (lastVersion) {
        setLastVersion(lastVersion);
      }
    };

    const el = document.getElementById('updater_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  return (
    <Dialog
      id='updater_window'
      isOpen={isOpen}
      title={checkUpdate ? _('Software Update') : _("What's New in Glossa")}
      onClose={() => setIsOpen(false)}
      boxClassName='sm:!w-[75%] sm:h-auto sm:!max-h-[85vh] sm:!max-w-2xl'
    >
      {isOpen && (
        <UpdaterContent
          latestVersion={latestVersion ?? undefined}
          lastVersion={lastVersion ?? undefined}
          checkUpdate={checkUpdate}
          nightlyUpdate={nightlyUpdate}
        />
      )}
    </Dialog>
  );
};
