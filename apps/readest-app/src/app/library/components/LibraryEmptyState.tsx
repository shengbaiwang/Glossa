import * as React from 'react';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import GlossaMark from '@/components/GlossaMark';

import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { navigateToLogin } from '@/utils/nav';

interface LibraryEmptyStateProps {
  onImport: (anchor: HTMLElement) => void;
}

const LibraryEmptyState: React.FC<LibraryEmptyStateProps> = ({ onImport }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const router = useAppRouter();
  const isMobile = appService?.isMobile ?? false;

  return (
    <div className='glossa-library-empty hero-content text-center'>
      <div className='flex max-w-md flex-col items-center'>
        <GlossaMark className='glossa-empty-mark' />
        <h1 className='mb-5 text-balance text-4xl font-semibold leading-tight tracking-tight'>
          {_('Start your library')}
        </h1>
        <p className='text-base-content/70 mb-12 text-pretty text-base leading-relaxed'>
          {isMobile
            ? _('Pick a book from your device to add it to your library.')
            : _('Drop a book anywhere on this window, or pick one from your computer.')}
        </p>
        <div className='flex w-full max-w-xs flex-col gap-3'>
          <button
            type='button'
            aria-haspopup='menu'
            className='glossa-button glossa-button-primary justify-center'
            onClick={(event) => onImport(event.currentTarget)}
          >
            <Plus size={18} aria-hidden='true' />
            {_('Import Books')}
          </button>
          {!user && (
            <button
              type='button'
              className={clsx(
                'text-base-content/70 hover:text-base-content mt-1 py-2 text-sm font-medium',
                'underline underline-offset-4',
                'focus-visible:text-base-content focus-visible:outline-none',
              )}
              onClick={() => navigateToLogin(router)}
            >
              {_('Sign in to sync your library')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LibraryEmptyState;
