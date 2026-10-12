'use client';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ArrowLeft as IoArrowBack } from '@/components/GlossaIcons';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/utils/supabase';
import { useEnv } from '@/context/EnvContext';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { isTauriAppPlatform } from '@/services/environment';
import { getAppScheme } from '@/services/appIdentity';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  handleNativeAuthCallback,
  isAuthCallbackInProgress,
  safeAuthReturnPath,
} from '@/helpers/auth';
import { getGlossaAuthRedirectUrl, isGlossaAuthConfigured } from '@/glossa/account/config';
import { getAppleIdAuth, Scope } from './utils/appleIdAuth';
import { authWithCustomTab, authWithSafari } from './utils/nativeAuth';
import WindowButtons from '@/components/WindowButtons';
import type { OAuthProvider } from './components/ProviderLogin';
import AuthPanel from './components/AuthPanel';

const WEB_AUTH_CALLBACK = getGlossaAuthRedirectUrl();
const DEEPLINK_CALLBACK = `${getAppScheme()}://auth-callback`;
const USE_APPLE_SIGN_IN = process.env['NEXT_PUBLIC_USE_APPLE_SIGN_IN'] === 'true';

export default function AuthPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const { envConfig, appService } = useEnv();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();
  const { isTrafficLightVisible } = useTrafficLightStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [isMounted, setIsMounted] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);

  useTheme({ systemUIVisible: false });

  const getTauriRedirectTo = (_isOAuth: boolean) => DEEPLINK_CALLBACK;

  const getWebRedirectTo = () => {
    return WEB_AUTH_CALLBACK ?? `${window.location.origin}/auth/callback`;
  };

  const tauriSignInApple = async () => {
    if (!supabase) {
      throw new Error('No backend connected');
    }
    const request = {
      scope: ['fullName', 'email'] as Scope[],
    };
    if (appService?.isIOSApp || USE_APPLE_SIGN_IN) {
      const appleAuthResponse = await getAppleIdAuth(request);
      if (appleAuthResponse.identityToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: appleAuthResponse.identityToken,
        });
        if (error) {
          throw error;
        }
      }
    } else {
      throw new Error('Apple sign-in is unavailable on this platform');
    }
  };

  const tauriSignIn = async (provider: OAuthProvider) => {
    if (!supabase) {
      throw new Error('No backend connected');
    }
    const redirectTo = getTauriRedirectTo(true);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        skipBrowserRedirect: true,
        redirectTo,
        scopes: provider === 'azure' ? 'email' : undefined,
      },
    });

    if (error) {
      throw error;
    }
    // Open the OAuth URL in a ASWebAuthenticationSession on iOS to comply with Apple's guidelines
    // for other platforms, open the OAuth URL in the default browser
    if (appService?.isIOSApp || appService?.isMacOSApp) {
      const res = await authWithSafari({ authUrl: data.url, callbackScheme: getAppScheme() });
      if (res) {
        handleOAuthUrl(res.redirectUrl);
      }
    } else if (appService?.isAndroidApp) {
      const res = await authWithCustomTab({ authUrl: data.url, callbackUrl: redirectTo });
      if (res) {
        handleOAuthUrl(res.redirectUrl);
      }
    } else {
      await openUrl(data.url);
    }
  };

  const tauriProviderSignIn = async (provider: OAuthProvider) => {
    if (provider === 'apple' && (appService?.isIOSApp || USE_APPLE_SIGN_IN)) {
      return tauriSignInApple();
    }
    return tauriSignIn(provider);
  };

  const webProviderSignIn = async (provider: OAuthProvider) => {
    if (!supabase) {
      throw new Error('No backend connected');
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: getWebRedirectTo(),
        scopes: provider === 'azure' ? 'email' : undefined,
      },
    });
    if (error) {
      throw error;
    }
  };

  const handleOAuthUrl = async (url: string) => {
    await handleNativeAuthCallback(url, { login, navigate: router.push });
  };

  const handleGoBack = () => {
    // Keep login false to avoid infinite loop to redirect to the login page
    settings.keepLogin = false;
    setSettings(settings);
    saveSettings(envConfig, settings);
    const redirectTo = new URLSearchParams(window.location.search).get('redirect');
    if (redirectTo) {
      router.push(safeAuthReturnPath(redirectTo));
    } else {
      router.push('/library');
    }
  };

  useEffect(() => {
    if (!isGlossaAuthConfigured()) return;
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isAuthCallbackInProgress()) return;
      if (session?.access_token && session.user) {
        login(session.access_token, session.user);
        const redirectTo = new URLSearchParams(window.location.search).get('redirect');
        const lastRedirectAtKey = 'lastRedirectAt';
        const lastRedirectAt = parseInt(localStorage.getItem(lastRedirectAtKey) || '0', 10);
        const now = Date.now();
        localStorage.setItem(lastRedirectAtKey, now.toString());
        if (now - lastRedirectAt > 3000) {
          router.push(safeAuthReturnPath(redirectTo));
        }
      }
    });

    return () => {
      subscription?.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  // Native builds use their own registered Glossa scheme; web uses /auth/callback.
  return isTauriAppPlatform() ? (
    <div
      className={clsx(
        'bg-base-100 full-height inset-0 flex select-none flex-col items-center overflow-hidden',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <div
        className={clsx('flex h-full w-full flex-col items-center overflow-y-auto')}
        style={{
          paddingTop: `${safeAreaInsets?.top || 0}px`,
        }}
      >
        <div
          ref={headerRef}
          className={clsx(
            'fixed z-10 flex w-full items-center justify-between py-2 pe-6 ps-4',
            appService?.hasTrafficLight && 'pt-11',
          )}
          style={{ top: `${safeAreaInsets?.top || 0}px` }}
        >
          <button
            aria-label={_('Go Back')}
            onClick={handleGoBack}
            className={clsx('btn btn-ghost h-12 min-h-12 w-12 p-0 sm:h-8 sm:min-h-8 sm:w-8')}
          >
            <IoArrowBack className='text-base-content' />
          </button>

          {appService?.hasWindowBar && (
            <WindowButtons
              headerRef={headerRef}
              showMinimize={!isTrafficLightVisible}
              showMaximize={!isTrafficLightVisible}
              showClose={!isTrafficLightVisible}
              onClose={handleGoBack}
            />
          )}
        </div>
        <div
          className={clsx(
            'z-20 flex w-full flex-col items-center px-6 pb-12',
            appService?.hasTrafficLight ? 'mt-24' : 'mt-16',
          )}
        >
          <AuthPanel
            supabaseClient={supabase}
            magicLink={true}
            redirectTo={getTauriRedirectTo(false)}
            onProviderSignIn={tauriProviderSignIn}
          />
        </div>
      </div>
    </div>
  ) : (
    <div className='bg-base-100 flex min-h-screen flex-col items-center overflow-y-auto px-6 pb-12 pt-20'>
      <button
        aria-label={_('Go Back')}
        onClick={handleGoBack}
        className='btn btn-ghost fixed start-6 top-6 h-8 min-h-8 w-8 p-0'
      >
        <IoArrowBack className='text-base-content' />
      </button>
      <AuthPanel
        supabaseClient={supabase}
        magicLink={true}
        redirectTo={getWebRedirectTo()}
        onProviderSignIn={webProviderSignIn}
      />
    </div>
  );
}
