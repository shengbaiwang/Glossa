import { useCallback, useEffect, useLayoutEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSafeAreaInsets } from './useSafeAreaInsets';
import { themes, applyCustomTheme, Palette } from '@/styles/themes';
import { getStatusBarHeight, setSystemUIVisibility } from '@/utils/bridge';
import { getOSPlatform } from '@/utils/misc';
import { parseWebViewVersion } from '@/utils/ua';
import { getThemeCode } from '@/utils/style';

type UseThemeProps = {
  systemUIVisible?: boolean;
  appThemeColor?: keyof Palette;
};

export const useTheme = ({
  systemUIVisible = true,
  appThemeColor = 'base-100',
}: UseThemeProps = {}) => {
  const { appService } = useEnv();
  const {
    themeCode,
    isDarkMode,
    showSystemUI,
    dismissSystemUI,
    updateAppTheme,
    setStatusBarHeight,
    systemUIAlwaysHidden,
    setSystemUIAlwaysHidden,
  } = useThemeStore();
  const { onUpdateInsets } = useSafeAreaInsets();

  useLayoutEffect(() => {
    updateAppTheme(appThemeColor);
  }, [appThemeColor, themeCode, updateAppTheme]);

  useEffect(() => {
    if (appService?.isAndroidApp) {
      getStatusBarHeight().then((res) => {
        if (res.height && res.height > 0) {
          setStatusBarHeight(res.height / window.devicePixelRatio);
        }
      });
      handleSystemUIVisibility(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService?.isAndroidApp]);

  const handleSystemUIVisibility = useCallback(
    (updateInsets = false) => {
      if (!appService?.isMobileApp) return;

      const visible = !!(systemUIVisible && !systemUIAlwaysHidden);
      if (visible) {
        showSystemUI();
      } else {
        dismissSystemUI();
      }
      setSystemUIVisibility({ visible, darkMode: isDarkMode }).then(() => {
        if (updateInsets) {
          onUpdateInsets();
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appService, isDarkMode, systemUIVisible],
  );

  useEffect(() => {
    if (appService?.isMobileApp) {
      handleSystemUIVisibility();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSystemUIVisibility]);

  useEffect(() => {
    if (!appService?.isMobileApp) return;

    handleSystemUIVisibility();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleSystemUIVisibility();
      }
    };
    const handleOrientationChange = () => {
      if (appService?.isIOSApp && getOSPlatform() === 'ios') {
        // FIXME: This is a workaround for iPhone apps where the system UI is not visible in landscape mode
        // when the app is in fullscreen mode until we find a better solution to override the prefersStatusBarHidden
        // in the ViewController. Note that screen.orientation.type is not abailable in iOS before 16.4.
        const systemUIAlwaysHidden = screen.orientation?.type.includes('landscape');
        setSystemUIAlwaysHidden(systemUIAlwaysHidden);
        handleSystemUIVisibility();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    screen.orientation?.addEventListener('change', handleOrientationChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      screen.orientation?.removeEventListener('change', handleOrientationChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSystemUIVisibility]);
};

// Global styles belong to the persistent provider, including pages without system UI controls.
export const useThemeStyles = () => {
  const { appService } = useEnv();
  const themeColor = useThemeStore((state) => state.themeColor);
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const customThemes = useSettingsStore((state) => state.settings.globalReadSettings?.customThemes);
  const isBwEink = useSettingsStore((state) => {
    const view = state.settings.globalViewSettings;
    return view?.isEink && !view?.isColorEink;
  });
  const highlightTransparency = useSettingsStore(
    (state) => state.settings.globalViewSettings?.highlightTransparency ?? 0.6,
  );
  const useFallbackColors = !!appService?.isAndroidApp && parseWebViewVersion(appService) < 111;

  useLayoutEffect(() => {
    if (!themeColor || !themes.find((t) => t.name === themeColor)) return;
    if (useFallbackColors) {
      applyCustomTheme(undefined, themeColor, true);
    }
  }, [themeColor, useFallbackColors]);

  useLayoutEffect(() => {
    if (!customThemes) return;
    customThemes.forEach((customTheme) => {
      applyCustomTheme(customTheme, undefined, useFallbackColors);
    });
    localStorage.setItem('customThemes', JSON.stringify(customThemes));
    const { themeColor, isDarkMode, themeCode: previous } = useThemeStore.getState();
    if (customThemes.some((theme) => theme.name === themeColor)) {
      const themeCode = getThemeCode(themeColor, isDarkMode);
      if (
        themeCode.bg !== previous.bg ||
        themeCode.fg !== previous.fg ||
        themeCode.primary !== previous.primary
      ) {
        useThemeStore.setState({ themeCode });
      }
    }
  }, [customThemes, useFallbackColors]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--scroll-bg-opacity', isBwEink ? '1.0' : '0.5');
    document.documentElement.style.setProperty(
      '--overlayer-highlight-opacity',
      isBwEink ? '1.0' : String(1 - highlightTransparency),
    );
    document.documentElement.style.setProperty(
      '--overlayer-highlight-blend-mode',
      isBwEink ? 'difference' : isDarkMode ? 'screen' : 'multiply',
    );
  }, [isDarkMode, isBwEink, highlightTransparency]);
};
