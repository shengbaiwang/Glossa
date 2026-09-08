import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { GLOSSA_DOWNLOAD_URL, GLOSSA_SOURCE_URL } from '@/services/constants';
import { parseWebViewInfo } from '@/utils/ua';
import { getAppVersion } from '@/utils/version';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import SupportLinks from './SupportLinks';
import LegalLinks from './LegalLinks';
import Dialog from './Dialog';
import Link from './Link';
import legalNotices from '../../public/legal/notices.json';

export const setAboutDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('about_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const AboutWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [browserInfo, setBrowserInfo] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setBrowserInfo(parseWebViewInfo(appService));

    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };

    const el = document.getElementById('about_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    setIsOpen(false);
  };

  const versionInfo = `${_('Version {{version}}', { version: getAppVersion() })} (${browserInfo})`;

  // Mobile users can't select the version string to paste it into a bug
  // report, so the label itself copies it.
  const handleCopyVersion = async () => {
    const copied = await writeTextToClipboard(versionInfo);
    if (!copied) return;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Copied to clipboard'),
      className: 'whitespace-nowrap',
      timeout: 2000,
    });
  };

  return (
    <Dialog
      id='about_window'
      isOpen={isOpen}
      title={_('About Glossa')}
      onClose={handleClose}
      boxClassName='sm:!w-[480px] sm:!max-w-screen-sm sm:h-auto'
    >
      {isOpen && (
        <div className='about-content flex flex-col items-center justify-center gap-4 pb-10 sm:pb-0'>
          <div className='flex flex-1 flex-col items-center justify-end gap-2 px-8 py-2'>
            <div className='mb-2 mt-6'>
              <Image
                src='/glossa-icon.png'
                alt='Glossa'
                className='h-20 w-20'
                width={80}
                height={80}
              />
            </div>
            <div className='flex select-text flex-col items-center'>
              <h2 className='mb-2 text-2xl font-bold'>Glossa</h2>
              <button
                type='button'
                title={_('Copy')}
                className='text-neutral-content text-center text-sm'
                onClick={handleCopyVersion}
              >
                {versionInfo}
              </button>
            </div>
            <Link href={GLOSSA_DOWNLOAD_URL} className='link text-sm'>
              {_('Glossa releases')}
            </Link>
          </div>

          <hr aria-hidden='true' className='border-base-300 my-4 w-full' />

          <div className='flex w-full flex-col items-center justify-start gap-2 px-4 text-center'>
            <p className='text-sm'>{_('Based on Readest {{version}}', { version: 'v0.12.1' })}</p>
            <p className='text-neutral-content text-sm'>
              © 2026 Bilingify LLC. All rights reserved.
            </p>
            <p className='text-neutral-content text-xs'>
              {_('Modified for Glossa on {{date}}', { date: '2026-09-09' })}
            </p>
            <p className='text-neutral-content text-xs'>
              {_(
                'No warranty is provided. You may redistribute and modify this software under the GNU AGPL version 3 or later.',
              )}
            </p>
            <div className='flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm'>
              <Link href={GLOSSA_SOURCE_URL} className='link'>
                {_('Glossa source code')}
              </Link>
              <Link href='https://github.com/readest/readest' className='link'>
                {_('Readest source code')}
              </Link>
            </div>
            <details className='eink-bordered border-base-300 my-2 w-full rounded-lg border text-start'>
              <summary className='cursor-pointer px-3 py-2 text-sm'>
                {_('Open source licenses')}
              </summary>
              <div className='max-h-64 overflow-auto px-3 pb-3 text-xs' tabIndex={0}>
                <pre className='whitespace-pre-wrap break-words font-sans' dir='ltr'>
                  {legalNotices.notice}
                </pre>
                <h3 className='my-3 font-semibold'>{_('License')}</h3>
                <pre className='whitespace-pre-wrap break-words font-sans' dir='ltr'>
                  {legalNotices.license}
                </pre>
                <h3 className='my-3 font-semibold'>{_('Third-party notices')}</h3>
                <pre className='whitespace-pre-wrap break-words font-sans' dir='ltr'>
                  {legalNotices.thirdParty}
                </pre>
              </div>
            </details>
            <p className='text-neutral-content text-xs'>
              {_('Glossa is an independent project. Readest Cloud is a separate service.')}
            </p>

            <LegalLinks />
          </div>
          <SupportLinks />
        </div>
      )}
    </Dialog>
  );
};
