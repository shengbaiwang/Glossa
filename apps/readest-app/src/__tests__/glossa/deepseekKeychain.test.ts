import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: vi.fn() }));
vi.mock('@/utils/bridge', () => ({
  clearSecureItem: vi.fn(),
  getSecureItem: vi.fn(),
  isSyncKeychainAvailable: vi.fn(),
  setSecureItem: vi.fn(),
}));

import { isTauriAppPlatform } from '@/services/environment';
import {
  clearSecureItem,
  getSecureItem,
  isSyncKeychainAvailable,
  setSecureItem,
} from '@/utils/bridge';
import {
  DEEPSEEK_API_KEYCHAIN_KEY,
  clearDeepSeekApiKey,
  createDeepSeekKeychain,
  getDeepSeekKeychainStatus,
  saveDeepSeekApiKey,
} from '@/glossa/ai';

afterEach(() => vi.clearAllMocks());

describe('DeepSeek keychain storage', () => {
  const available = () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValue({ available: true });
  };

  test('stores and deletes only through the dedicated system-keychain key', async () => {
    available();
    vi.mocked(setSecureItem).mockResolvedValue({ success: true });
    await saveDeepSeekApiKey(' key-for-test ');
    expect(setSecureItem).toHaveBeenCalledWith({
      key: DEEPSEEK_API_KEYCHAIN_KEY,
      value: 'key-for-test',
    });
    vi.mocked(clearSecureItem).mockResolvedValue({ success: true });
    await clearDeepSeekApiKey();
    expect(clearSecureItem).toHaveBeenCalledWith({ key: DEEPSEEK_API_KEYCHAIN_KEY });
  });

  test('reports configuration without returning the key to UI callers', async () => {
    available();
    vi.mocked(getSecureItem).mockResolvedValue({ value: 'key-for-test' });
    await expect(getDeepSeekKeychainStatus()).resolves.toEqual({
      available: true,
      configured: true,
    });
  });

  test('disables the real provider off-Tauri or when the keychain is unavailable', async () => {
    vi.mocked(isTauriAppPlatform).mockReturnValue(false);
    await expect(getDeepSeekKeychainStatus()).resolves.toEqual({
      available: false,
      configured: false,
    });
    expect(isSyncKeychainAvailable).not.toHaveBeenCalled();

    vi.mocked(isTauriAppPlatform).mockReturnValue(true);
    vi.mocked(isSyncKeychainAvailable).mockResolvedValue({ available: false });
    await expect(getDeepSeekKeychainStatus()).resolves.toEqual({
      available: false,
      configured: false,
    });
  });

  test('fails loudly when saving or deleting is rejected without exposing a key', async () => {
    available();
    vi.mocked(setSecureItem).mockResolvedValue({ success: false, error: 'denied' });
    await expect(saveDeepSeekApiKey('key-for-test')).rejects.toThrow(
      'System keychain could not save',
    );
    vi.mocked(clearSecureItem).mockResolvedValue({ success: false, error: 'denied' });
    await expect(clearDeepSeekApiKey()).rejects.toThrow('System keychain could not delete');
  });

  test('can use a test-only key name without touching the production key entry', async () => {
    available();
    vi.mocked(setSecureItem).mockResolvedValue({ success: true });
    const keychain = createDeepSeekKeychain('glossa.test.deepseek.api-key.v1');
    await keychain.save('test-only-key');
    expect(setSecureItem).toHaveBeenCalledWith({
      key: 'glossa.test.deepseek.api-key.v1',
      value: 'test-only-key',
    });
  });
});
