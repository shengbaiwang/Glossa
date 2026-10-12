'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/utils/supabase';

export default function ResetPasswordPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className='bg-base-100 text-base-content flex min-h-screen items-center justify-center'>
      <form
        className='w-full max-w-sm space-y-5 p-6'
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !user) return;
          const password = String(new FormData(event.currentTarget).get('password') ?? '');
          setBusy(true);
          setError('');
          try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            router.push('/user');
          } catch {
            setError(_('Unable to update password. Please try again.'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className='text-xl font-semibold'>{_('New Password')}</h1>
        {user ? (
          <>
            <label className='block space-y-2'>
              <span className='text-sm'>{_('Your new password')}</span>
              <input
                name='password'
                type='password'
                autoComplete='new-password'
                required
                minLength={8}
                disabled={busy}
                className='input input-bordered w-full rounded-lg'
              />
            </label>
            <button type='submit' disabled={busy} className='btn btn-contrast w-full rounded-lg'>
              {_('Update password')}
            </button>
          </>
        ) : (
          <button
            type='button'
            className='btn btn-contrast w-full rounded-lg'
            onClick={() => router.push('/auth')}
          >
            {_('Sign in to Glossa')}
          </button>
        )}
        {error && (
          <p role='alert' className='text-error text-sm'>
            {error}
          </p>
        )}
        <button
          type='button'
          className='btn btn-ghost w-full rounded-lg'
          onClick={() => router.push('/library')}
        >
          {_('Back')}
        </button>
      </form>
    </main>
  );
}
