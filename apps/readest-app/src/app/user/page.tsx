'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { getAppScheme, isTauriAppPlatform } from '@/services/environment';
import { getGlossaAuthRedirectUrl, getGlossaDeleteAccountFunction } from '@/glossa/account/config';
import { supabase } from '@/utils/supabase';
import ProfileHeader from './components/Header';

export default function ProfilePage() {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { user, logout } = useAuth();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();
  const [editingEmail, setEditingEmail] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  useTheme({ systemUIVisible: false });

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
      setMessage(_('Unable to complete this action. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  const redirectTo = () =>
    isTauriAppPlatform()
      ? `${getAppScheme()}://auth-callback`
      : (getGlossaAuthRedirectUrl() ?? `${window.location.origin}/auth/callback`);
  const openCloudSettings = () => {
    const store = useSettingsStore.getState();
    store.setRequestedPanel('integrations');
    store.setSettingsDialogOpen(true);
    router.push('/library');
  };
  const deleteFunction = getGlossaDeleteAccountFunction();

  return (
    <div
      className={clsx(
        'bg-base-100 text-base-content min-h-screen',
        isRoundedWindow && 'rounded-xl',
      )}
      style={{ paddingTop: safeAreaInsets?.top ?? 0, paddingBottom: safeAreaInsets?.bottom ?? 0 }}
    >
      <ProfileHeader onGoBack={() => router.push('/library')} />
      <main
        className={clsx(
          'mx-auto flex w-full max-w-md flex-col gap-7 px-6 pb-12 pt-24',
          appService?.hasTrafficLight && 'pt-32',
        )}
      >
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>{_('Glossa account')}</h1>
        </div>
        {user ? (
          <>
            <section className='space-y-3'>
              <div className='text-base-content/60 text-sm'>{_('Email address')}</div>
              {editingEmail ? (
                <form
                  className='flex items-center gap-2'
                  onSubmit={(event) => {
                    event.preventDefault();
                    const email = String(
                      new FormData(event.currentTarget).get('email') ?? '',
                    ).trim();
                    void run(async () => {
                      const { error } = await supabase.auth.updateUser(
                        { email },
                        { emailRedirectTo: redirectTo() },
                      );
                      if (error) throw error;
                      setEditingEmail(false);
                      setMessage(_('Check your email for the confirmation link'));
                    });
                  }}
                >
                  <input
                    name='email'
                    type='email'
                    defaultValue={user.email}
                    aria-label={_('Email address')}
                    required
                    disabled={busy}
                    autoComplete='email'
                    className='input input-bordered min-w-0 flex-1 rounded-lg'
                  />
                  <button disabled={busy} className='btn btn-contrast rounded-lg' type='submit'>
                    {_('Save')}
                  </button>
                  <button
                    disabled={busy}
                    className='btn btn-ghost rounded-lg'
                    type='button'
                    onClick={() => setEditingEmail(false)}
                  >
                    {_('Cancel')}
                  </button>
                </form>
              ) : (
                <button
                  className='w-full truncate text-start text-base underline-offset-4 hover:underline'
                  onClick={() => setEditingEmail(true)}
                >
                  {user.email ?? _('Change email')}
                </button>
              )}
              <button
                disabled={busy}
                className='btn btn-ghost w-full justify-start rounded-lg px-0'
                onClick={() =>
                  void run(async () => {
                    if (!user.email) throw new Error('No email');
                    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
                      redirectTo: redirectTo(),
                    });
                    if (error) throw error;
                    setMessage(_('Check your email for the password reset link'));
                  })
                }
              >
                {_('Reset password')}
              </button>
            </section>
            <section className='border-base-200 space-y-2 border-t pt-4'>
              <button
                disabled={busy}
                className='btn btn-ghost w-full justify-start rounded-lg px-0'
                onClick={() =>
                  void run(async () => {
                    await logout();
                    router.push('/library');
                  })
                }
              >
                {_('Sign out')}
              </button>
              <button
                disabled={busy}
                className='btn btn-ghost w-full justify-start rounded-lg px-0'
                onClick={() =>
                  void run(async () => {
                    const { error } = await supabase.auth.signOut({ scope: 'others' });
                    if (error) throw error;
                    setMessage(_('Other devices have been signed out.'));
                  })
                }
              >
                {_('Sign out other devices')}
              </button>
              {deleteFunction &&
                (deleting ? (
                  <div className='space-y-3'>
                    <p className='text-sm'>
                      {_(
                        'Delete your Glossa account? Your local library and personal cloud files will be kept.',
                      )}
                    </p>
                    <div className='flex gap-3'>
                      <button
                        disabled={busy}
                        className='btn btn-ghost text-error rounded-lg'
                        onClick={() =>
                          void run(async () => {
                            const { data, error } = await supabase.functions.invoke(deleteFunction);
                            if (error || data?.deleted !== true)
                              throw new Error('Account deletion failed');
                            await logout();
                            router.push('/library');
                          })
                        }
                      >
                        {_('Delete account')}
                      </button>
                      <button
                        disabled={busy}
                        className='btn btn-ghost rounded-lg'
                        onClick={() => setDeleting(false)}
                      >
                        {_('Cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    disabled={busy}
                    className='btn btn-ghost text-error w-full justify-start rounded-lg px-0'
                    onClick={() => setDeleting(true)}
                  >
                    {_('Delete account')}
                  </button>
                ))}
            </section>
          </>
        ) : (
          <button className='btn btn-contrast rounded-lg' onClick={() => router.push('/auth')}>
            {_('Sign in to Glossa')}
          </button>
        )}
        <section className='border-base-200 border-t pt-4'>
          <button
            className='btn btn-ghost w-full justify-start rounded-lg px-0'
            onClick={openCloudSettings}
          >
            {_('Cloud Sync')}
          </button>
        </section>
        {message && (
          <p
            role={failed ? 'alert' : 'status'}
            className={clsx('text-sm', failed ? 'text-error' : 'text-base-content/70')}
          >
            {message}
          </p>
        )}
      </main>
    </div>
  );
}
