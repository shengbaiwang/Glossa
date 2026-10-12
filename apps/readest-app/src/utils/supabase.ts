import { createClient } from '@supabase/supabase-js';
import { getGlossaAuthConfig } from '@/glossa/account/config';
import { glossaAuthStorage } from '@/glossa/account/storage';

const config = getGlossaAuthConfig();
const supabaseUrl = config?.url ?? 'https://auth-unconfigured.invalid';
const supabaseAnonKey = config?.key ?? 'unconfigured';
const hasClientSession = !!config && typeof window !== 'undefined';
const disabledFetch: typeof fetch = async () => {
  throw new Error('Glossa authentication is not configured');
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: config?.storageKey ?? 'glossa-auth-unconfigured',
    persistSession: hasClientSession,
    autoRefreshToken: hasClientSession,
    detectSessionInUrl: false,
    storage: glossaAuthStorage,
  },
  ...(!config ? { global: { fetch: disabledFetch } } : {}),
});

export const createSupabaseClient = (accessToken?: string) => {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      ...(!config ? { fetch: disabledFetch } : {}),
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : {},
    },
  });
};

export const createSupabaseAdminClient = () => {
  const supabaseAdminKey = process.env['GLOSSA_AUTH_SERVICE_ROLE_KEY'] || 'unconfigured';
  return createClient(supabaseUrl, supabaseAdminKey, {
    ...(!config ? { global: { fetch: disabledFetch } } : {}),
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};
