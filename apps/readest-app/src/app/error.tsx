'use client';
import { ArrowLeft, LibraryBig, RefreshCw } from '@/components/GlossaIcons';

import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { parseWebViewInfo } from '@/utils/ua';
import { handleGlobalError } from '@/utils/error';
import { GLOSSA_SOURCE_URL } from '@/services/constants';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [browserInfo, setBrowserInfo] = useState('');

  useEffect(() => {
    setBrowserInfo(parseWebViewInfo(appService));
  }, [appService]);

  useEffect(() => {
    handleGlobalError(error);
  }, [appService, error]);

  const handleGoHome = () => {
    window.location.href = '/library';
  };

  const handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      handleGoHome();
    }
  };

  return (
    <div className='hero bg-base-200 min-h-screen'>
      <div className='hero-content text-center'>
        <div className='w-full max-w-2xl p-1'>
          <div className='mb-8 mt-6'>
            <div className='text-error animate-pulse text-8xl'>⚠️</div>
          </div>

          <h1 className='text-base-content mb-4 text-5xl font-bold'>Oops!</h1>

          <p className='text-base-content/70 mb-8 text-lg'>
            {_('Something went wrong. Try again, or report the issue to Glossa.')}
          </p>

          <div className='alert alert-error mb-8 overflow-hidden'>
            <div className='w-full min-w-0 flex-col items-start text-left'>
              <h3 className='mb-2 font-bold'>{_('Error Details:')}</h3>
              <p className='overflow-wrap-anywhere w-full break-words font-mono text-sm'>
                {error.message}
              </p>
              {browserInfo && (
                <p className='overflow-wrap-anywhere mt-2 w-full break-words font-mono text-sm'>
                  Browser: {browserInfo}
                </p>
              )}
              {error.stack && (
                <p className='overflow-wrap-anywhere mt-2 w-full whitespace-pre-wrap break-words font-mono text-sm'>
                  {error.stack.split('\n').slice(0, 3).join('\n')}
                </p>
              )}
              {error.digest && (
                <p className='overflow-wrap-anywhere mt-2 w-full break-words text-xs opacity-70'>
                  Error ID: {error.digest}
                </p>
              )}
            </div>
          </div>

          <div className='flex flex-col gap-4'>
            <button onClick={reset} className='btn btn-primary btn-lg'>
              <RefreshCw className='me-2 h-5 w-5' />
              {_('Try Again')}
            </button>

            <div className='flex gap-3'>
              <button onClick={handleGoBack} className='btn btn-outline flex-1'>
                <ArrowLeft className='me-2 h-4 w-4' />
                {_('Go Back')}
              </button>

              <button onClick={handleGoHome} className='btn btn-outline flex-1'>
                <LibraryBig className='me-2 h-4 w-4' />
                {_('Your Library')}
              </button>
            </div>
          </div>

          <div className='border-base-300 mt-8 border-t pt-6'>
            <p className='text-base-content/60 text-sm'>
              {_('Need help?')}{' '}
              <a
                href={`${GLOSSA_SOURCE_URL}/issues`}
                className='link link-primary'
                target='_blank'
                rel='noopener noreferrer'
              >
                {_('Report an issue')}
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
