import { describe, expect, it, vi } from 'vitest';
import { fetchWithAuth } from '@/utils/fetch';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';
import {
  createStripeCheckoutSession,
  createStripePortalSession,
  fetchStripePlans,
} from '@/libs/payment/stripe/client';
import {
  isIAPAvailable,
  purchaseIAPProduct,
  verifyGooglePurchaseProducts,
} from '@/libs/payment/iap/client';
describe('Glossa does not use the original native storage service', () => {
  it('rejects upstream authenticated HTTP before reading credentials or fetching', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(fetchWithAuth('https://upstream.example/api/storage', {})).rejects.toThrow(
      'disabled',
    );
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it('disables all native replica categories despite old settings', () => {
    const settings = { readestCloud: { enabled: true } } as SystemSettings;
    const previous = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings });
    expect(isSyncCategoryEnabled('settings')).toBe(false);
    expect(isSyncCategoryEnabled('book')).toBe(false);
    useSettingsStore.setState({ settings: previous });
  });
  it('never purchases or sends Glossa credentials to old billing endpoints', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      expect(await fetchStripePlans()).toEqual([]);
      expect(await isIAPAvailable()).toBe(false);
      await expect(createStripeCheckoutSession('old-plan')).rejects.toThrow('does not provide');
      await expect(createStripePortalSession()).rejects.toThrow('does not provide');
      await expect(purchaseIAPProduct('old-plan')).rejects.toThrow('does not provide');
      await verifyGooglePurchaseProducts([
        {
          platform: 'android',
          productId: 'com.bilingify.readest.purchase.storage.1gb',
          purchaseToken: 'fake',
          purchaseDate: '2026-01-01',
        },
      ]);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
