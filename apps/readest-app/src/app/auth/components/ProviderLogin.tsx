import clsx from 'clsx';
import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

export type OAuthProvider = 'google' | 'apple' | 'azure' | 'github' | 'discord';

interface ProviderLoginProp {
  provider: OAuthProvider;
  handleSignIn: (provider: OAuthProvider) => Promise<void>;
  Icon: React.ElementType;
  label: string;
}

export const ProviderLogin: React.FC<ProviderLoginProp> = ({
  provider,
  handleSignIn,
  Icon,
  label,
}) => {
  const _ = useTranslation();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className='w-full'>
      <button
        type='button'
        disabled={loading}
        onClick={async () => {
          if (loading) return;
          setFailed(false);
          setLoading(true);
          try {
            await handleSignIn(provider);
          } catch {
            setFailed(true);
          } finally {
            setLoading(false);
          }
        }}
        className={clsx(
          'eink-bordered flex h-11 w-full items-center justify-center gap-2.5',
          'border-base-200 bg-base-100 rounded-lg border px-4',
          'text-base-content text-sm font-medium',
          'transition-colors duration-150',
          'hover:border-base-300 hover:bg-base-200/60',
          'active:bg-base-200/80',
          'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
        )}
      >
        {loading ? (
          <span className='loading loading-spinner loading-sm' />
        ) : (
          <Icon className='h-5 w-5' aria-hidden='true' />
        )}
        <span className='line-clamp-1'>{label}</span>
      </button>
      {failed && (
        <p role='alert' className='text-error mt-2 text-center text-sm'>
          {_('Unable to sign in. Please try again.')}
        </p>
      )}
    </div>
  );
};
