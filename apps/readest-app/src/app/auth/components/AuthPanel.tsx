import Image from 'next/image';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FcGoogle } from 'react-icons/fc';
import { FaApple, FaMicrosoft } from 'react-icons/fa';
import Link from 'next/link';
import { getGlossaIdentityProviders, isGlossaAuthConfigured } from '@/glossa/account/config';
import { useTranslation } from '@/hooks/useTranslation';
import { ProviderLogin, type OAuthProvider } from './ProviderLogin';
import EmailPasswordAuth from './EmailPasswordAuth';

interface AuthPanelProps {
  supabaseClient: SupabaseClient;
  redirectTo?: string;
  magicLink?: boolean;
  onProviderSignIn: (provider: OAuthProvider) => Promise<void>;
}

export default function AuthPanel({
  supabaseClient,
  redirectTo,
  magicLink = false,
  onProviderSignIn,
}: AuthPanelProps) {
  const _ = useTranslation();

  const providers = getGlossaIdentityProviders();
  const configured = isGlossaAuthConfigured();
  const icons = { google: FcGoogle, apple: FaApple, azure: FaMicrosoft };
  const names = { google: 'Google', apple: 'Apple', azure: 'Microsoft' };

  return (
    <div className='text-base-content flex w-full max-w-sm flex-col items-center gap-6'>
      <div className='flex flex-col items-center gap-3 text-center'>
        <Image src='/icon.png' alt='' width={48} height={48} className='eink-bordered rounded-xl' />
        <h1 className='text-xl font-semibold tracking-tight'>{_('Sign in to Glossa')}</h1>
      </div>
      {!configured ? (
        <div className='w-full space-y-4 text-center'>
          <p role='status' className='text-base-content/70 text-sm'>
            {_('Glossa account service is not configured yet.')}
          </p>
          <Link className='btn btn-contrast w-full rounded-lg' href='/library'>
            {_('Continue reading')}
          </Link>
        </div>
      ) : (
        <>
          {providers.length > 0 && (
            <>
              <div className='flex w-full flex-col gap-2.5'>
                {providers.map((provider) => (
                  <ProviderLogin
                    key={provider}
                    provider={provider}
                    handleSignIn={onProviderSignIn}
                    Icon={icons[provider]}
                    label={_('Sign in with {{provider}}', { provider: names[provider] })}
                  />
                ))}
              </div>
              <div className='flex w-full items-center gap-3' aria-hidden='true'>
                <hr className='border-base-300 flex-1 border-t' />
                <span className='text-base-content/50 text-xs'>{_('or continue with email')}</span>
                <hr className='border-base-300 flex-1 border-t' />
              </div>
            </>
          )}
          <EmailPasswordAuth
            supabaseClient={supabaseClient}
            redirectTo={redirectTo}
            magicLink={magicLink}
          />
        </>
      )}
    </div>
  );
}
