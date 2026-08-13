import { isTauriAppPlatform } from '@/services/environment';
import {
  clearSecureItem,
  getSecureItem,
  isSyncKeychainAvailable,
  setSecureItem,
} from '@/utils/bridge';

export const DEEPSEEK_API_KEYCHAIN_KEY = 'glossa.deepseek.api-key.v1';

export type DeepSeekKeychainStatus = {
  available: boolean;
  configured: boolean;
};

export type DeepSeekKeychain = {
  getStatus(): Promise<DeepSeekKeychainStatus>;
  getKeyForRequest(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
};

const isAvailable = async (): Promise<boolean> => {
  if (!isTauriAppPlatform()) return false;
  try {
    return (await isSyncKeychainAvailable()).available;
  } catch {
    return false;
  }
};

/** The injectable key name exists solely for isolated native-WebView tests. */
export function createDeepSeekKeychain(keyName = DEEPSEEK_API_KEYCHAIN_KEY): DeepSeekKeychain {
  return {
    async getStatus() {
      if (!(await isAvailable())) return { available: false, configured: false };
      try {
        const result = await getSecureItem({ key: keyName });
        return { available: true, configured: !!result.value?.trim() };
      } catch {
        return { available: true, configured: false };
      }
    },
    async getKeyForRequest() {
      if (!(await isAvailable())) return null;
      try {
        return (await getSecureItem({ key: keyName })).value?.trim() || null;
      } catch {
        return null;
      }
    },
    async save(value) {
      const key = value.trim();
      if (!key) throw new Error('Enter a DeepSeek API key before saving.');
      if (!(await isAvailable())) throw new Error('System keychain is unavailable.');
      const result = await setSecureItem({ key: keyName, value: key });
      if (!result.success) throw new Error('System keychain could not save the DeepSeek API key.');
    },
    async clear() {
      if (!(await isAvailable())) throw new Error('System keychain is unavailable.');
      const result = await clearSecureItem({ key: keyName });
      if (!result.success)
        throw new Error('System keychain could not delete the DeepSeek API key.');
    },
  };
}

const defaultKeychain = createDeepSeekKeychain();

/** Returns status only; the API key is never exposed to UI state. */
export const getDeepSeekKeychainStatus = () => defaultKeychain.getStatus();
/** For the provider request path only. Callers must not retain or display this value. */
export const getDeepSeekApiKey = () => defaultKeychain.getKeyForRequest();
export const saveDeepSeekApiKey = (value: string) => defaultKeychain.save(value);
export const clearDeepSeekApiKey = () => defaultKeychain.clear();
