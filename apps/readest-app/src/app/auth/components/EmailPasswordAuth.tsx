import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useTranslation } from '@/hooks/useTranslation';

type AuthView = 'sign_in' | 'sign_up' | 'magic_link' | 'forgotten_password';

interface EmailPasswordAuthProps {
  supabaseClient: SupabaseClient;
  redirectTo?: string;
  magicLink?: boolean;
}

const FORM_IDS: Record<AuthView, string> = {
  sign_in: 'auth-sign-in',
  sign_up: 'auth-sign-up',
  magic_link: 'auth-magic-link',
  forgotten_password: 'auth-forgot-password',
};

const LINK_CLASS =
  'text-base-content/80 hover:text-base-content inline-flex min-h-8 items-center justify-center rounded-sm text-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content disabled:opacity-50 [@media(pointer:coarse)]:min-h-11';

const INPUT_CLASS =
  'input input-bordered eink-bordered text-base-content placeholder:text-base-content/50 h-11 min-h-11 w-full rounded-xl disabled:opacity-50';

export default function EmailPasswordAuth({
  supabaseClient,
  redirectTo,
  magicLink = false,
}: EmailPasswordAuthProps) {
  const _ = useTranslation();
  const [view, setView] = useState<AuthView>('sign_in');
  const [defaultEmail, setDefaultEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [keyboardInset, setKeyboardInset] = useState(0);

  const hasPassword = view === 'sign_in' || view === 'sign_up';

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const layoutH = document.documentElement.clientHeight;
      const offset = layoutH - vv.height - vv.offsetTop;
      setKeyboardInset(offset > 1 ? offset : 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // The Android WebView does not resize with the keyboard, and Chromium
  // resets the visual-viewport pan when the IME advances focus (keyboard
  // Next) without re-scrolling the newly focused editable. The keyboard
  // spacer gives the page scroller enough range, and the focus handler
  // scrolls the input back into the visible area above the keyboard.
  const keepAboveKeyboard = (event: React.FocusEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    setTimeout(() => {
      if (document.activeElement === input) {
        input.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 300);
  };

  const switchView = (next: AuthView) => (event: React.MouseEvent<HTMLButtonElement>) => {
    const form = event.currentTarget.form;
    if (form) {
      const email = new FormData(form).get('email');
      if (typeof email === 'string' && email) {
        setDefaultEmail(email);
      }
    }
    setError('');
    setMessage('');
    setView(next);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Read credentials from the form's DOM state: Android/iOS password
    // managers fill WebView inputs without events React state can track.
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');
    setError('');
    setMessage('');
    setLoading(true);
    try {
      if (view === 'sign_in') {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
      } else if (view === 'sign_up') {
        const {
          data: { user, session },
          error,
        } = await supabaseClient.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) setError(error.message);
        else if (user && !session) setMessage(_('Check your email for the confirmation link'));
      } else if (view === 'magic_link') {
        const { error } = await supabaseClient.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) setError(error.message);
        else setMessage(_('Check your email for the magic link'));
      } else {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) setError(error.message);
        else setMessage(_('Check your email for the password reset link'));
      }
    } catch {
      setError(_('Unable to connect. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const buttonLabel = {
    sign_in: loading ? _('Signing in...') : _('Sign in'),
    sign_up: loading ? _('Signing up...') : _('Sign up'),
    magic_link: loading ? _('Sending...') : _('Send sign-in link'),
    forgotten_password: loading ? _('Sending...') : _('Send reset link'),
  }[view];

  return (
    <form
      key={view}
      id={FORM_IDS[view]}
      method='post'
      onSubmit={handleSubmit}
      className='flex w-full flex-col gap-4'
    >
      <div className='flex flex-col gap-1.5'>
        <label className='text-sm font-medium' htmlFor='email'>
          {_('Email address')}
        </label>
        <input
          id='email'
          name='email'
          type='email'
          required
          defaultValue={defaultEmail}
          placeholder='name@example.com'
          autoComplete={hasPassword ? 'username' : 'email'}
          className={INPUT_CLASS}
          disabled={loading}
          onFocus={keepAboveKeyboard}
        />
      </div>
      {hasPassword && (
        <div className='flex flex-col gap-1.5'>
          <div className='flex flex-wrap items-center justify-between gap-x-3'>
            <label className='text-sm font-medium' htmlFor='password'>
              {view === 'sign_in' ? _('Password') : _('Create a Password')}
            </label>
            {view === 'sign_in' && (
              <button
                type='button'
                className={LINK_CLASS}
                disabled={loading}
                onClick={switchView('forgotten_password')}
              >
                {_('Forgot your password?')}
              </button>
            )}
          </div>
          <input
            id='password'
            name='password'
            type='password'
            required
            minLength={view === 'sign_up' ? 8 : undefined}
            autoComplete={view === 'sign_in' ? 'current-password' : 'new-password'}
            className={INPUT_CLASS}
            disabled={loading}
            onFocus={keepAboveKeyboard}
          />
        </div>
      )}
      <button
        type='submit'
        className='btn btn-contrast h-11 min-h-11 w-full rounded-xl disabled:opacity-50'
        disabled={loading}
      >
        {loading && <span className='loading loading-spinner loading-sm' aria-hidden='true' />}
        {buttonLabel}
      </button>
      {message && (
        <div
          role='status'
          className='eink-bordered border-base-200 bg-base-200/40 text-base-content/80 rounded-lg border px-3 py-2.5 text-center text-sm leading-relaxed'
        >
          {message}
        </div>
      )}
      {error && (
        <div
          role='alert'
          className='eink-bordered border-error/30 bg-error/5 text-error rounded-lg border px-3 py-2.5 text-center text-sm leading-relaxed'
        >
          {error}
        </div>
      )}
      <div className='flex flex-col items-center gap-2 text-center text-sm'>
        {view === 'sign_in' && (
          <>
            {magicLink && (
              <button
                type='button'
                className={LINK_CLASS}
                disabled={loading}
                onClick={switchView('magic_link')}
              >
                {_('Sign in with email link')}
              </button>
            )}
            <button
              type='button'
              className={LINK_CLASS}
              disabled={loading}
              onClick={switchView('sign_up')}
            >
              {_("Don't have an account? Sign up")}
            </button>
          </>
        )}
        {view !== 'sign_in' && (
          <div className='flex flex-wrap items-center justify-center gap-x-1'>
            <span className='text-base-content/70'>{_('Already have an account?')}</span>
            <button
              type='button'
              className={`${LINK_CLASS} text-base-content font-medium`}
              disabled={loading}
              onClick={switchView('sign_in')}
            >
              {_('Sign in')}
            </button>
          </div>
        )}
      </div>
      {keyboardInset > 0 && (
        <div data-keyboard-spacer='' aria-hidden='true' style={{ height: `${keyboardInset}px` }} />
      )}
    </form>
  );
}
