import type { QuotaType, UserPlan } from '@/types/quota';

/** Compatibility for sync callers. Glossa has no first-party storage quota. */
export const useQuotaStats = (
  _briefName = false,
): { quotas: QuotaType[]; userProfilePlan: UserPlan } => ({
  quotas: [],
  userProfilePlan: 'free',
});
