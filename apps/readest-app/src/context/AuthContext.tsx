'use client';

import {
  createContext,
  useState,
  useContext,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import { isGlossaAuthConfigured } from '@/glossa/account/config';

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // The SDK owns the project-isolated session. Never read legacy token/user keys.
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!isGlossaAuthConfigured()) return;
    let active = true;
    let revision = 0;
    const syncSession = (session: Session | null) => {
      if (!active) return;
      setToken(session?.access_token ?? null);
      setUser(session?.user ?? null);
    };
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      revision++;
      syncSession(session);
    });
    const initialRevision = revision;
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (revision === initialRevision) syncSession(error ? null : data.session);
      })
      .catch(() => {
        if (revision === initialRevision) syncSession(null);
      });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback((newToken: string, newUser: User) => {
    if (!isGlossaAuthConfigured()) return;
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    if (isGlossaAuthConfigured()) {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!isGlossaAuthConfigured()) return;
    const { error } = await supabase.auth.refreshSession();
    if (error) throw error;
  }, []);

  const value = useMemo(
    () => ({ token, user, login, logout, refresh }),
    [token, user, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
