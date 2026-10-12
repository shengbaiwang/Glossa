import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/utils/bridge', () => ({
  getSecureItem: vi.fn(),
  setSecureItem: vi.fn(),
  clearSecureItem: vi.fn(),
}));
import { getSecureItem, setSecureItem, clearSecureItem } from '@/utils/bridge';
import { glossaAuthStorage } from '@/glossa/account/storage';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  localStorage.clear();
});
describe('Glossa native auth storage', () => {
  it('does not access native or browser storage during static rendering', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    vi.stubGlobal('window', undefined);
    await expect(glossaAuthStorage.getItem('glossa-auth-own')).resolves.toBeNull();
    await glossaAuthStorage.setItem('glossa-auth-own', 'session');
    await glossaAuthStorage.removeItem('glossa-auth-own');
    expect(getSecureItem).not.toHaveBeenCalled();
    expect(setSecureItem).not.toHaveBeenCalled();
    expect(clearSecureItem).not.toHaveBeenCalled();
    expect(localStorage.getItem('glossa-auth-own')).toBeNull();
  });
  it('keeps the session in keychain without writing a browser copy', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    vi.mocked(setSecureItem).mockResolvedValue({ success: true });
    vi.mocked(getSecureItem).mockResolvedValue({ value: 'session' });
    vi.mocked(clearSecureItem).mockResolvedValue({ success: true });
    await glossaAuthStorage.setItem('glossa-auth-own', 'session');
    expect(await glossaAuthStorage.getItem('glossa-auth-own')).toBe('session');
    await glossaAuthStorage.removeItem('glossa-auth-own');
    expect(localStorage.getItem('glossa-auth-own')).toBeNull();
    expect(clearSecureItem).toHaveBeenCalledWith({ key: 'glossa-auth-own' });
  });
  it('fails without plaintext fallback when keychain refuses a write', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', 'tauri');
    vi.mocked(setSecureItem).mockResolvedValue({ success: false });
    await expect(glossaAuthStorage.setItem('glossa-auth-own', 'session')).rejects.toThrow(
      'secure storage',
    );
    expect(localStorage.length).toBe(0);
  });
});
