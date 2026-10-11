import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore, initSystemThemeListener, loadDataTheme } from '@/store/themeStore';
import { getThemeCode } from '@/utils/style';
import { themes } from '@/styles/themes';
import type { AppService } from '@/types/system';

vi.mock('@/utils/bridge', () => ({
  getSystemColorScheme: vi.fn(async () => ({ colorScheme: 'light' })),
  startAmbientLightUpdates: vi.fn(async () => ({ success: true })),
  stopAmbientLightUpdates: vi.fn(async () => ({ success: true })),
}));
vi.mock('@tauri-apps/api/core', () => ({ addPluginListener: vi.fn() }));

const appService = { hasAmbientLightSensor: false } as AppService;
let stopListening: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState({
    themeMode: 'light',
    themeColor: 'default',
    isDarkMode: false,
    systemIsDarkMode: false,
    ambientIsDarkMode: false,
    themeCode: getThemeCode(),
  });
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.cssText = '';
});
afterEach(() => stopListening?.());

describe('theme synchronization', () => {
  it('publishes one consistent update for a mode switch', () => {
    const updates: boolean[] = [];
    const unsubscribe = useThemeStore.subscribe((state) => {
      updates.push(state.themeCode.isDarkMode);
      expect(state.themeCode.isDarkMode).toBe(state.isDarkMode);
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });
    try {
      useThemeStore.getState().setThemeMode('dark');
      expect(updates).toEqual([true]);
    } finally {
      unsubscribe();
    }
  });

  it('resolves auto mode from live system appearance instead of a stale cache', () => {
    localStorage.setItem('systemIsDarkMode', 'false');
    useThemeStore.setState({ systemIsDarkMode: true });
    useThemeStore.getState().setThemeMode('auto');
    expect(useThemeStore.getState().themeCode.isDarkMode).toBe(true);
    expect(useThemeStore.getState().themeCode.bg).toBe(themes[0]!.colors.dark['base-100']);
  });

  it('does not invalidate reader colors when system appearance cannot change the selected mode', () => {
    useThemeStore.getState().setThemeMode('light');
    const palette = useThemeStore.getState().themeCode;
    useThemeStore.getState().handleSystemThemeChange(true);
    expect(useThemeStore.getState().themeCode).toBe(palette);
  });

  it('applies stored preferences to both the root and the store, including first-launch defaults', () => {
    loadDataTheme();
    expect(document.documentElement.dataset['theme']).toBe('default-light');
    localStorage.setItem('themeMode', 'dark');
    localStorage.setItem('themeColor', 'sepia');
    loadDataTheme();
    expect(document.documentElement.dataset['theme']).toBe('sepia-dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(useThemeStore.getState()).toMatchObject({
      themeMode: 'dark',
      themeColor: 'sepia',
      isDarkMode: true,
      themeCode: { isDarkMode: true },
    });
  });

  it("adopts other windows' preferences and removes its listener on unmount", () => {
    stopListening = initSystemThemeListener(appService);
    localStorage.setItem('themeMode', 'dark');
    localStorage.setItem('themeColor', 'sepia');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'themeMode', storageArea: localStorage }),
    );
    expect(useThemeStore.getState()).toMatchObject({ themeColor: 'sepia', isDarkMode: true });
    expect(document.documentElement.dataset['theme']).toBe('sepia-dark');
    stopListening?.();
    localStorage.setItem('themeMode', 'light');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'themeMode', storageArea: localStorage }),
    );
    expect(useThemeStore.getState().isDarkMode).toBe(true);
  });

  it('ignores malformed cached custom palettes without preventing a theme switch', () => {
    localStorage.setItem('themeColor', 'broken');
    localStorage.setItem('themeMode', 'dark');
    for (const cache of ['{', '[null]', '{"name":"broken"}']) {
      localStorage.setItem('customThemes', cache);
      expect(() => loadDataTheme()).not.toThrow();
      expect(useThemeStore.getState().themeCode.isDarkMode).toBe(true);
    }
  });
});
