import { isTauriAppPlatform } from '@/services/environment';
import { clearSecureItem, getSecureItem, setSecureItem } from '@/utils/bridge';

/** Native sessions belong in the OS keychain, without a plaintext fallback. */
export const glossaAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    if (!isTauriAppPlatform()) return globalThis.localStorage?.getItem(key) ?? null;
    const result = await getSecureItem({ key });
    if (result.error) throw new Error('Unable to read the account from secure storage');
    return result.value ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!isTauriAppPlatform()) {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    const result = await setSecureItem({ key, value });
    if (!result.success) throw new Error('Unable to save the account in secure storage');
  },
  async removeItem(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!isTauriAppPlatform()) {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    const result = await clearSecureItem({ key });
    if (!result.success) throw new Error('Unable to remove the account from secure storage');
  },
};
