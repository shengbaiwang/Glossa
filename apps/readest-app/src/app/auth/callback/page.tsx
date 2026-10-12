'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { handleAuthCallback, parseOAuthCallbackUrl } from '@/helpers/auth';

export default function AuthCallback() {
  const router = useRouter();
  const { login } = useAuth();
  const started = useRef(false);
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    if (started.current)
      return () => {
        active.current = false;
      };
    started.current = true;
    const params = parseOAuthCallbackUrl(window.location.href);
    // Remove credentials from the address bar before any navigation or render.
    window.history.replaceState(null, '', window.location.pathname);
    void handleAuthCallback({
      ...params,
      next: params.next ?? undefined,
      login,
      navigate: (path) => {
        if (active.current) router.push(path);
      },
    });
    return () => {
      active.current = false;
    };
  }, [login, router]);

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <span className='loading loading-infinity loading-xl w-20' />
    </div>
  );
}
