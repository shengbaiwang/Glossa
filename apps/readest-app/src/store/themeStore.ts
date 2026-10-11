import { create } from 'zustand';
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { AppService } from '@/types/system';
import { getThemeCode, ThemeCode } from '@/utils/style';
import {
  getSystemColorScheme,
  startAmbientLightUpdates,
  stopAmbientLightUpdates,
  type AmbientLightPayload,
} from '@/utils/bridge';
import {
  isValidThemeMode,
  readStoredAmbientIsDarkMode,
  resolveAmbientIsDarkMode,
  resolveThemeIsDarkMode,
} from '@/utils/ambientLight';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  applyCustomTheme,
  getStoredCustomThemes,
  CustomTheme,
  Palette,
  ThemeMode,
} from '@/styles/themes';
import { broadcastGlobalSettings } from '@/utils/settingsSync';
import { EnvConfigType, isWebAppPlatform } from '@/services/environment';
import { SystemSettings } from '@/types/settings';
import { Insets } from '@/types/misc';

declare global {
  interface Window {
    __READEST_IS_EINK?: boolean;
    onNativeColorSchemeChange?: (colorScheme: 'light' | 'dark') => void;
  }
}

interface ThemeState {
  themeMode: ThemeMode;
  themeColor: string;
  systemIsDarkMode: boolean;
  ambientIsDarkMode: boolean;
  themeCode: ThemeCode;
  isDarkMode: boolean;
  systemUIVisible: boolean;
  statusBarHeight: number;
  systemUIAlwaysHidden: boolean;
  safeAreaInsets: Insets | null;
  isRoundedWindow: boolean;
  setSystemUIAlwaysHidden: (hidden: boolean) => void;
  setStatusBarHeight: (height: number) => void;
  showSystemUI: () => void;
  dismissSystemUI: () => void;
  getIsDarkMode: () => boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeColor: (color: string) => void;
  updateAppTheme: (color: keyof Palette) => void;
  saveCustomTheme: (
    envConfig: EnvConfigType,
    settings: SystemSettings,
    theme: CustomTheme,
    isDelete?: boolean,
  ) => Promise<void>;
  handleSystemThemeChange: (isDark: boolean) => void;
  handleAmbientLightChange: (lux: number) => void;
  updateSafeAreaInsets: (insets: Insets) => void;
}

const getInitialThemeMode = (): ThemeMode => {
  if (typeof window !== 'undefined' && localStorage) {
    const stored = localStorage.getItem('themeMode');
    if (isValidThemeMode(stored)) return stored;
  }
  return 'auto';
};

const getInitialThemeColor = (): string => {
  if (typeof window !== 'undefined' && localStorage) {
    const defaultColor = window.__READEST_IS_EINK ? 'contrast' : 'default';
    return localStorage.getItem('themeColor') || defaultColor;
  }
  return 'default';
};

const getInitialAmbientIsDarkMode = (systemIsDarkMode: boolean): boolean => {
  if (typeof window !== 'undefined' && localStorage) {
    return readStoredAmbientIsDarkMode(localStorage.getItem('ambientIsDarkMode'), systemIsDarkMode);
  }
  return systemIsDarkMode;
};

const persistAmbientIsDarkMode = (isDark: boolean) => {
  if (typeof window !== 'undefined' && localStorage) {
    localStorage.setItem('ambientIsDarkMode', isDark ? 'true' : 'false');
  }
};

let themeTransitionFrame = 0;
const applyDataTheme = (themeColor: string, isDarkMode: boolean) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const colorScheme = isDarkMode ? 'dark' : 'light';
  const theme = `${themeColor}-${colorScheme}`;
  if (root.getAttribute('data-theme') !== theme) {
    // Color transitions on individual controls otherwise lag behind the page surface.
    root.classList.add('theme-changing');
    cancelAnimationFrame(themeTransitionFrame);
    themeTransitionFrame = requestAnimationFrame(() => {
      themeTransitionFrame = requestAnimationFrame(() => root.classList.remove('theme-changing'));
    });
  }
  root.setAttribute('data-theme', theme);
  root.style.setProperty('color-scheme', colorScheme);
  root.style.setProperty('--bg-texture-blend-mode', isDarkMode ? 'lighten' : 'multiply');
};

let ambientLightListener: PluginListener | null = null;
let ambientLightListening = false;
let ambientHasLuxReading = false;

const stopAmbientLightListening = async () => {
  if (ambientLightListener) {
    try {
      await ambientLightListener.unregister();
    } catch {
      // ignore unregister races on teardown
    }
    ambientLightListener = null;
  }
  if (ambientLightListening) {
    ambientLightListening = false;
    try {
      await stopAmbientLightUpdates();
    } catch {
      // platform may not support ambient light
    }
  }
  ambientHasLuxReading = false;
};

const startAmbientLightListening = async () => {
  if (ambientLightListening) return;
  try {
    const started = await startAmbientLightUpdates();
    if (!started.success) {
      useThemeStore.getState().setThemeMode('auto');
      return;
    }
    ambientLightListening = true;
    ambientLightListener = await addPluginListener<AmbientLightPayload>(
      'native-bridge',
      'ambient-light',
      (payload) => {
        if (typeof payload?.lux === 'number') {
          useThemeStore.getState().handleAmbientLightChange(payload.lux);
        }
      },
    );
  } catch {
    useThemeStore.getState().setThemeMode('auto');
  }
};

// Start and stop both span several awaits, so overlapping calls could
// interleave: a stop landing after a start leaves the sensor off while we
// still believe we are listening, and two starts leak the first listener.
// Chaining every transition keeps the sensor in step with the last mode set.
let ambientLightSync: Promise<void> = Promise.resolve();

const syncAmbientLightSubscription = (mode: ThemeMode) => {
  ambientLightSync = ambientLightSync.then(() =>
    mode === 'ambient' ? startAmbientLightListening() : stopAmbientLightListening(),
  );
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialThemeMode = getInitialThemeMode();
  const initialThemeColor = getInitialThemeColor();
  const systemIsDarkMode =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const ambientIsDarkMode = getInitialAmbientIsDarkMode(systemIsDarkMode);
  const isDarkMode = resolveThemeIsDarkMode(initialThemeMode, systemIsDarkMode, ambientIsDarkMode);
  const themeCode = getThemeCode(initialThemeColor, isDarkMode);

  const updateTheme = (
    changes: Partial<
      Pick<
        ThemeState,
        'themeMode' | 'themeColor' | 'isDarkMode' | 'systemIsDarkMode' | 'ambientIsDarkMode'
      >
    >,
    refreshColors = false,
  ) => {
    const previous = get();
    const { themeColor, isDarkMode } = { ...previous, ...changes };
    applyDataTheme(themeColor, isDarkMode);
    const colorsChanged =
      refreshColors || themeColor !== previous.themeColor || isDarkMode !== previous.isDarkMode;
    if (
      !colorsChanged &&
      Object.entries(changes).every(([key, value]) => previous[key as keyof ThemeState] === value)
    )
      return;
    set({
      ...changes,
      themeCode: colorsChanged ? getThemeCode(themeColor, isDarkMode) : previous.themeCode,
    });
  };

  return {
    themeMode: initialThemeMode,
    themeColor: initialThemeColor,
    systemIsDarkMode,
    ambientIsDarkMode,
    isDarkMode,
    themeCode,
    systemUIVisible: false,
    statusBarHeight: 24,
    systemUIAlwaysHidden: false,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    isRoundedWindow: true,
    showSystemUI: () => set({ systemUIVisible: true }),
    dismissSystemUI: () => set({ systemUIVisible: false }),
    setStatusBarHeight: (height: number) => set({ statusBarHeight: height }),
    setSystemUIAlwaysHidden: (hidden: boolean) => set({ systemUIAlwaysHidden: hidden }),
    getIsDarkMode: () => get().isDarkMode,
    setThemeMode: (mode) => {
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem('themeMode', mode);
      }
      const isDarkMode = resolveThemeIsDarkMode(
        mode,
        get().systemIsDarkMode,
        get().ambientIsDarkMode,
      );
      updateTheme({ themeMode: mode, isDarkMode });
      syncAmbientLightSubscription(mode);
    },
    setThemeColor: (color) => {
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem('themeColor', color);
      }
      updateTheme({ themeColor: color }, true);
    },
    updateAppTheme: (color) => {
      if (isWebAppPlatform()) {
        const { palette } = get().themeCode;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette[color]);
      }
    },
    saveCustomTheme: async (envConfig, settings, theme, isDelete) => {
      const customThemes = [...(settings.globalReadSettings.customThemes || [])];
      const index = customThemes.findIndex((t) => t.name === theme.name);
      if (isDelete) {
        if (index > -1) {
          customThemes.splice(index, 1);
        }
      } else {
        if (index > -1) {
          customThemes[index] = theme;
        } else {
          customThemes.push(theme);
        }
      }
      const appService = await envConfig.getAppService();
      await appService.saveSettings({
        ...settings,
        globalReadSettings: { ...settings.globalReadSettings, customThemes },
      });
      // A failed write leaves both the live settings and the startup cache intact.
      settings.globalReadSettings = { ...settings.globalReadSettings, customThemes };
      localStorage.setItem('customThemes', JSON.stringify(customThemes));
      void broadcastGlobalSettings(settings);
    },
    handleSystemThemeChange: (systemIsDarkMode) => {
      localStorage.setItem('systemIsDarkMode', String(systemIsDarkMode));
      const mode = get().themeMode;
      const isDarkMode = resolveThemeIsDarkMode(mode, systemIsDarkMode, get().ambientIsDarkMode);
      updateTheme({ systemIsDarkMode, isDarkMode });
    },
    handleAmbientLightChange: (lux) => {
      if (get().themeMode !== 'ambient') return;
      const previous = ambientHasLuxReading ? get().ambientIsDarkMode : null;
      ambientHasLuxReading = true;
      const nextAmbientIsDark = resolveAmbientIsDarkMode(lux, previous);
      if (nextAmbientIsDark === get().ambientIsDarkMode && get().isDarkMode === nextAmbientIsDark) {
        return;
      }
      persistAmbientIsDarkMode(nextAmbientIsDark);
      updateTheme({ ambientIsDarkMode: nextAmbientIsDark, isDarkMode: nextAmbientIsDark });
    },
    updateSafeAreaInsets: (insets) => {
      set({ safeAreaInsets: insets });
    },
  };
});

export const loadDataTheme = () => {
  if (typeof localStorage === 'undefined' || typeof document === 'undefined') return;

  const themeMode = getInitialThemeMode();
  const themeColor = getInitialThemeColor();
  const { systemIsDarkMode } = useThemeStore.getState();
  const ambientIsDarkMode = getInitialAmbientIsDarkMode(systemIsDarkMode);
  const isDarkMode = resolveThemeIsDarkMode(themeMode, systemIsDarkMode, ambientIsDarkMode);
  const customTheme = getStoredCustomThemes().find((theme) => theme.name === themeColor);
  if (customTheme) applyCustomTheme(customTheme, undefined, true);
  applyDataTheme(themeColor, isDarkMode);
  useThemeStore.setState({
    themeMode,
    themeColor,
    ambientIsDarkMode,
    isDarkMode,
    themeCode: getThemeCode(themeColor, isDarkMode),
  });
};

export const initSystemThemeListener = (appService: AppService) => {
  if (typeof window === 'undefined' || !appService) return;

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const applySystemTheme = (systemIsDarkMode: boolean) => {
    useThemeStore.getState().handleSystemThemeChange(systemIsDarkMode);
  };
  const updateColorTheme = async () => {
    let systemIsDarkMode;
    if (appService.isIOSApp) {
      const res = await getSystemColorScheme();
      systemIsDarkMode = res.colorScheme === 'dark';
    } else {
      systemIsDarkMode = mediaQuery.matches;
    }
    applySystemTheme(systemIsDarkMode);
  };

  const updateWindowTheme = async () => {
    if (!appService.hasWindow || !appService.isLinuxApp) return;
    const currentWindow = getCurrentWindow();
    const isFullscreen = await currentWindow.isFullscreen();
    const isMaximized = await currentWindow.isMaximized();
    useThemeStore.setState({ isRoundedWindow: !isMaximized && !isFullscreen });
  };

  const syncAmbientForVisibility = () => {
    const mode = useThemeStore.getState().themeMode;
    if (document.visibilityState === 'visible') {
      syncAmbientLightSubscription(mode);
    } else {
      void stopAmbientLightListening();
    }
  };

  const handleVisibilityChange = () => {
    void updateColorTheme();
    syncAmbientForVisibility();
  };
  const handleStorageChange = (event: StorageEvent) => {
    if (event.storageArea !== localStorage) return;
    if (
      event.key === null ||
      ['themeMode', 'themeColor', 'ambientIsDarkMode', 'customThemes'].includes(event.key)
    ) {
      loadDataTheme();
      syncAmbientLightSubscription(useThemeStore.getState().themeMode);
    }
  };
  mediaQuery?.addEventListener('change', updateColorTheme);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('storage', handleStorageChange);
  window.addEventListener('resize', updateWindowTheme);

  // iOS WKWebView never fires the `prefers-color-scheme` media query
  // `change` event while the app stays foregrounded (e.g. toggling dark
  // mode from Control Center), so the native plugin pushes the new
  // appearance through this callback instead.
  if (appService.isIOSApp) {
    window.onNativeColorSchemeChange = (colorScheme) => {
      applySystemTheme(colorScheme === 'dark');
    };
  }

  updateColorTheme();

  // appService.init() has already probed the sensor by the time this runs, so
  // fall back when Ambient Mode was persisted on a device that lacks one.
  const themeMode = useThemeStore.getState().themeMode;
  if (themeMode === 'ambient' && !appService.hasAmbientLightSensor) {
    useThemeStore.getState().setThemeMode('auto');
  } else {
    syncAmbientLightSubscription(themeMode);
  }

  return () => {
    mediaQuery.removeEventListener('change', updateColorTheme);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('resize', updateWindowTheme);
    window.removeEventListener('storage', handleStorageChange);
    if (appService.isIOSApp) delete window.onNativeColorSchemeChange;
    syncAmbientLightSubscription('auto');
  };
};
