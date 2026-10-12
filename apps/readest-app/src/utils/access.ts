import { jwtDecode } from 'jwt-decode';
import { supabase } from '@/utils/supabase';
import { UserPlan } from '@/types/quota';
import { DEFAULT_STORAGE_QUOTA } from '@/services/constants';
import { isGlossaAuthConfigured } from '@/glossa/account/config';

import { getRuntimeConfig } from '@/services/runtimeConfig';

interface Token {
  plan: UserPlan;
  storage_usage_bytes: number;
  storage_purchased_bytes: number;
  [key: string]: string | number;
}

export const getSubscriptionPlan = (token: string): UserPlan => {
  const data = jwtDecode<Token>(token) || {};
  return data['plan'] || 'free';
};

export const getUserProfilePlan = (token: string): UserPlan => {
  const data = jwtDecode<Token>(token) || {};
  let plan = data['plan'] || 'free';
  if (plan === 'free') {
    const purchasedQuota = data['storage_purchased_bytes'] || 0;
    if (purchasedQuota > 0) {
      plan = 'purchase';
    }
  }
  return plan;
};

/**
 * Plans that include the "Send to Readest via email" feature: Plus,
 * Pro, and Lifetime (`purchase`). Free users see an upgrade card on
 * the client and get a 403 from the server endpoints that allocate /
 * rotate the address, plus a bounce from the inbound email Worker.
 *
 * Other Send channels (in-app `/send` page, mobile share-sheet, browser
 * extension) stay open to free users — the gate is the personal email
 * inbox only.
 */
export const EMAIL_IN_PLANS: readonly UserPlan[] = ['plus', 'pro', 'purchase'];

export const isEmailInPlan = (plan: UserPlan): boolean =>
  (EMAIL_IN_PLANS as readonly UserPlan[]).includes(plan);

/**
 * Legacy plan values remain readable for compatibility with saved settings.
 * Glossa personal cloud sync does not require a subscription or identity login.
 */
export const CLOUD_SYNC_PLANS: readonly UserPlan[] = ['plus', 'pro', 'purchase'];

export const isCloudSyncInPlan = (plan: UserPlan): boolean =>
  (CLOUD_SYNC_PLANS as readonly UserPlan[]).includes(plan);

/**
 * Glossa does not sell storage plans. Every personal cloud remains available.
 */
export const CLOUD_SYNC_REQUIRES_PREMIUM = false;

/**
 * Whether third-party cloud sync is available for a plan. Falls back to the
 * {@link isCloudSyncInPlan} paywall while {@link CLOUD_SYNC_REQUIRES_PREMIUM}
 * is on; flipping the switch off ungates every plan.
 */
export const isCloudSyncAllowed = (plan: UserPlan): boolean =>
  !CLOUD_SYNC_REQUIRES_PREMIUM || isCloudSyncInPlan(plan);

/**
 * Plans that include the offline TTS audio cache — pre-downloading a book's
 * Read Aloud audio per chapter so it plays without a network: any paid plan
 * (Plus, Pro, and Lifetime `purchase`). Free users see the download row with a
 * Premium badge and an upgrade route instead of the per-chapter controls.
 */
export const TTS_CACHE_PLANS: readonly UserPlan[] = ['plus', 'pro', 'purchase'];

export const isTTSCacheInPlan = (plan: UserPlan): boolean =>
  (TTS_CACHE_PLANS as readonly UserPlan[]).includes(plan);

/**
 * Master switch for the offline-audio premium paywall, mirroring
 * {@link CLOUD_SYNC_REQUIRES_PREMIUM}. ON: pre-downloading TTS audio requires a
 * {@link TTS_CACHE_PLANS} plan. Flipping it off ungates every plan. The
 * automatic playback cache (audio kept as the user listens) is unaffected —
 * only the explicit download UI is gated.
 */
export const TTS_CACHE_REQUIRES_PREMIUM = true;

export const isTTSCacheAllowed = (plan: UserPlan): boolean =>
  !TTS_CACHE_REQUIRES_PREMIUM || isTTSCacheInPlan(plan);

export const STORAGE_QUOTA_GRACE_BYTES = 10 * 1024 * 1024; // 10 MB grace

export const getStoragePlanData = (token: string) => {
  const data = jwtDecode<Token>(token) || {};
  const plan = data['plan'] || 'free';
  const usage = data['storage_usage_bytes'] || 0;
  const purchasedQuota = data['storage_purchased_bytes'] || 0;
  const runtimeConfig = getRuntimeConfig();
  const fixedQuota =
    runtimeConfig?.storageFixedQuota ?? parseInt(process.env['STORAGE_FIXED_QUOTA'] ?? '0');
  const planQuota = fixedQuota || DEFAULT_STORAGE_QUOTA[plan] || DEFAULT_STORAGE_QUOTA['free'];
  const quota = planQuota + purchasedQuota;

  return {
    plan,
    usage,
    quota,
  };
};

export const getAccessToken = async (): Promise<string | null> => {
  // Only the independent SDK session is authoritative; legacy token keys stay unread.
  if (!isGlossaAuthConfigured()) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
};

export const getUserID = async (): Promise<string | null> => {
  if (!isGlossaAuthConfigured()) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
};

export const validateUserAndToken = async (authHeader: string | null | undefined) => {
  if (!authHeader) return {};

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return {};
  return { user, token };
};
