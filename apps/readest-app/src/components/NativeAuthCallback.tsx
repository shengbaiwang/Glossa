'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAuth } from '@/context/AuthContext';
import { isGlossaAuthConfigured } from '@/glossa/account/config';
import { isTauriAppPlatform } from '@/services/environment';
import { handleNativeAuthCallback } from '@/helpers/auth';

/** Receive email links on every page, including a launch from a closed app. */
export default function NativeAuthCallback() {
  const { login } = useAuth();
  const router = useRouter();
  const active = useRef(false);
  const launchRead = useRef(false);

  useEffect(() => {
    if (!isGlossaAuthConfigured() || !isTauriAppPlatform()) return;
    active.current = true;
    let disposed = false;
    const removers: Array<() => void> = [];
    const retain = (remove: () => void) => {
      if (disposed) remove();
      else removers.push(remove);
    };
    const receive = (urls: string[]) => {
      if (!active.current) return;
      for (const url of urls) {
        void handleNativeAuthCallback(url, {
          login: (token, user) => {
            if (active.current) login(token, user);
          },
          navigate: (path) => {
            if (active.current) router.push(path);
          },
        }).catch(() => {
          if (active.current) router.push('/auth/error');
        });
      }
    };
    void onOpenUrl((urls) => receive(urls))
      .then(retain)
      .catch(() => {});
    void getCurrentWindow()
      .listen<{ args: string[] }>('single-instance', ({ payload }) => {
        receive(payload.args ?? []);
      })
      .then(retain)
      .catch(() => {});
    if (!launchRead.current) {
      launchRead.current = true;
      void getCurrent()
        .then((urls) => receive(urls ?? []))
        .catch(() => {});
    }
    return () => {
      active.current = false;
      disposed = true;
      removers.forEach((remove) => remove());
    };
  }, [login, router]);

  return null;
}
