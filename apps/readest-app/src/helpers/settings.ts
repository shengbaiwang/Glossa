import { ViewSettings } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getStyles } from '@/utils/style';

/**
 * Resolve the effective background texture for the library page (issue #4743).
 * By default the library and the reader share one linked background, so the
 * library simply inherits the reader/global value. When the user opts into a
 * separate reader background (`readerBackgroundSeparate`), the library falls
 * back to its own `libraryBackground*` values, per-field, and only inherits a
 * field that was never decoupled. Returns a `ViewSettings` so it can be handed
 * straight to `useBackgroundTexture().applyBackgroundTexture`.
 */
export const getLibraryViewSettings = (settings: SystemSettings): ViewSettings => {
  // globalViewSettings can be absent on the very first renders — the store
  // starts as `{} as SystemSettings` until appService.loadSettings() runs — so
  // every read is optional and falls back to a no-texture default.
  const globalViewSettings = settings.globalViewSettings;
  const separate = settings.readerBackgroundSeparate === true;
  return {
    ...globalViewSettings,
    backgroundTextureId: separate
      ? (settings.libraryBackgroundTextureId ?? globalViewSettings?.backgroundTextureId ?? 'none')
      : (globalViewSettings?.backgroundTextureId ?? 'none'),
    backgroundTransparency: separate
      ? (settings.libraryBackgroundTransparency ??
        globalViewSettings?.backgroundTransparency ??
        0.4)
      : (globalViewSettings?.backgroundTransparency ?? 0.4),
    backgroundSize: separate
      ? (settings.libraryBackgroundSize ?? globalViewSettings?.backgroundSize ?? 'cover')
      : (globalViewSettings?.backgroundSize ?? 'cover'),
  };
};

export type BackgroundTextureScope = 'library' | 'reader';

/**
 * Resolve the three background-texture fields for one scope of the Settings →
 * Theme picker. 'library' resolves exactly like the library page; 'reader'
 * reads the open book's view settings when provided, else the global defaults.
 */
export const getBackgroundTextureSettings = (
  scope: BackgroundTextureScope,
  settings: SystemSettings,
  readerViewSettings?: ViewSettings,
): Pick<ViewSettings, 'backgroundTextureId' | 'backgroundTransparency' | 'backgroundSize'> => {
  const source =
    scope === 'library'
      ? getLibraryViewSettings(settings)
      : (readerViewSettings ?? settings.globalViewSettings);
  return {
    backgroundTextureId: source?.backgroundTextureId ?? 'none',
    backgroundTransparency: source?.backgroundTransparency ?? 0.4,
    backgroundSize: source?.backgroundSize ?? 'cover',
  };
};

export const saveViewSettings = async <K extends keyof ViewSettings>(
  envConfig: EnvConfigType,
  bookKey: string,
  key: K,
  value: ViewSettings[K],
  skipGlobal = false,
  applyStyles = true,
  forceSave = false,
) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  const { bookKeys, getView, getViewState, getViewSettings, setViewSettings } =
    useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();

  const applyViewSettings = async (bookKey: string) => {
    const viewSettings = getViewSettings(bookKey);
    const viewState = getViewState(bookKey);
    if (bookKey && viewSettings && (viewSettings[key] !== value || forceSave)) {
      if (viewSettings[key] !== value) {
        viewSettings[key] = value;
        setViewSettings(bookKey, viewSettings);
        if (applyStyles) {
          const view = getView(bookKey);
          view?.renderer.setStyles?.(getStyles(viewSettings));
        }
      }
      // A failed disk write already updated the live view. Explicit retries must
      // persist that unchanged value without restyling or moving the reading view.
      const config = getConfig(bookKey);
      if (viewState?.isPrimary && config) {
        await saveConfig(envConfig, bookKey, config, settings);
      }
    }
  };

  const isSettingsGlobal = getViewSettings(bookKey)?.isGlobal ?? true;
  if (isSettingsGlobal && !skipGlobal) {
    // Build a NEW settings object (and a NEW globalViewSettings) so the
    // settingsStore subscriber that gates replica push fires — it compares
    // `state.settings !== prev.settings`, so an in-place mutation followed
    // by setSettings(same_ref) silently bypasses the publish path and
    // whitelisted writes (userStylesheet, userUIStylesheet) only ship
    // on the next unrelated setSettings call.
    const nextSettings: SystemSettings = {
      ...settings,
      globalViewSettings: { ...settings.globalViewSettings, [key]: value },
    };
    setSettings(nextSettings);

    for (const bookKey of bookKeys) {
      await applyViewSettings(bookKey);
    }
    await saveSettings(envConfig, nextSettings);
  } else if (bookKey) {
    await applyViewSettings(bookKey);
  }
};

export const saveSysSettings = async <K extends keyof SystemSettings>(
  envConfig: EnvConfigType,
  key: K,
  value: SystemSettings[K],
) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  if (settings[key] !== value) {
    settings[key] = value;
    setSettings(settings);
    await saveSettings(envConfig, settings);
  }
};
