import {
  LIBRARY_DISPLAY_KEYS,
  editLibraryDisplay,
  type LibraryDisplayKey,
} from '@/utils/libraryDisplaySettings';
import { ViewSettings } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getStyles } from '@/utils/style';

/** Keep the previous local preference until the user changes it in Settings. */
export const getFolderImportReadInPlace = (settings: SystemSettings): boolean =>
  settings.folderImportReadInPlace ??
  (typeof window !== 'undefined' &&
    window.localStorage.getItem('readest:lastImportFolderReadInPlace') === '1');

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

  const effectiveSettingsIsGlobal = !bookKey;
  const applyViewSettings = async (bookKey: string, effectiveSettings = settings) => {
    const viewSettings = getViewSettings(bookKey);
    const viewState = getViewState(bookKey);
    if (bookKey && viewSettings && (viewSettings[key] !== value || forceSave)) {
      const changed = viewSettings[key] !== value;
      const detach =
        !!bookKey &&
        !effectiveSettingsIsGlobal &&
        key !== 'isGlobal' &&
        viewSettings.isGlobal !== false;
      if (changed || detach) {
        if (detach) viewSettings.isGlobal = false;
        viewSettings[key] = value;
        setViewSettings(bookKey, viewSettings);
        if (applyStyles && changed) {
          const view = getView(bookKey);
          view?.renderer.setStyles?.(getStyles(viewSettings));
        }
      }
      // A failed disk write already updated the live view. Explicit retries must
      // persist that unchanged value without restyling or moving the reading view.
      const config = getConfig(bookKey);
      if (viewState?.isPrimary && config) {
        await saveConfig(envConfig, bookKey, config, effectiveSettings);
      }
    }
  };

  const isSettingsGlobal = !bookKey;
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

    for (const targetBookKey of bookKeys) {
      // A default must not overwrite another book's explicit local preferences.
      if (getViewSettings(targetBookKey)?.isGlobal !== false) {
        await applyViewSettings(targetBookKey, nextSettings);
      }
    }
    await saveSettings(envConfig, nextSettings);
  } else if (bookKey) {
    await applyViewSettings(bookKey);
  }
};

/** Only presentation preferences become defaults; book locations and private text never do. */
const READING_DEFAULT_KEYS = [
  'serifFont',
  'sansSerifFont',
  'monospaceFont',
  'defaultFont',
  'defaultCJKFont',
  'defaultFontSize',
  'fontWeight',
  'overrideFont',
  'overrideLayout',
  'useBookLayout',
  'paragraphMargin',
  'lineHeight',
  'wordSpacing',
  'letterSpacing',
  'textIndent',
  'fullJustification',
  'hyphenation',
  'marginTopPx',
  'marginBottomPx',
  'marginLeftPx',
  'marginRightPx',
  'compactMarginTopPx',
  'compactMarginBottomPx',
  'compactMarginLeftPx',
  'compactMarginRightPx',
  'gapPercent',
  'maxColumnCount',
  'maxInlineSize',
  'maxBlockSize',
  'writingMode',
  'scrolled',
  'scrolledDirection',
  'scrollingOverlap',
  'hideScrollbar',
  'noContinuousScroll',
  'overrideColor',
  'invertImgColorInDark',
  'applyThemeToPDF',
  'backgroundTextureId',
  'backgroundTransparency',
  'backgroundSize',
  'highlightTransparency',
  'codeHighlighting',
  'codeLanguage',
  'userStylesheet',
  'userUIStylesheet',
  'disableClick',
  'disableSwipe',
  'fullscreenClickArea',
  'swapClickArea',
  'disableDoubleClick',
  'volumeKeysToFlip',
  'animated',
  'pageTurnStyle',
  'showHeader',
  'showFooter',
  'showRemainingTime',
  'showRemainingPages',
  'showProgressInfo',
  'showStickyProgressBar',
  'showCurrentTime',
  'use24HourClock',
  'showCurrentBatteryStatus',
  'showBatteryPercentage',
  'showPaginationButtons',
  'progressStyle',
  'readingRulerEnabled',
  'readingRulerLines',
  'readingRulerTransparency',
  'readingRulerColor',
  'zoomLevel',
  'zoomMode',
  'spreadMode',
  'keepCoverSpread',
  'contrast',
  'webtoonMode',
  'autoScrollSpeed',
  'replaceQuotationMarks',
  'convertChineseVariant',
  'doubleBorder',
  'borderColor',
  'paragraphMode',
  'ttsRate',
  'ttsSentenceGap',
  'ttsParagraphGap',
  'ttsVoice',
  'ttsHighlightOptions',
  'ttsHighlightGranularity',
  'ttsMediaMetadata',
  'ttsPlayerStyle',
  'enableAnnotationQuickActions',
  'annotationQuickAction',
  'annotationToolbarItems',
] as const satisfies readonly (keyof ViewSettings)[];

export const saveReadingDefaults = async (envConfig: EnvConfigType, bookKey: string) => {
  const view = useReaderStore.getState().getViewSettings(bookKey);
  if (!view) throw new Error('Reading settings unavailable');
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  const copied = Object.fromEntries(
    READING_DEFAULT_KEYS.filter((key) => view[key] !== undefined).map((key) => [
      key,
      structuredClone(view[key]),
    ]),
  );
  const nextSettings = {
    ...settings,
    globalViewSettings: { ...settings.globalViewSettings, ...copied },
  };
  await saveSettings(envConfig, nextSettings);
  // Retain unrelated changes that arrived while the disk write was in progress.
  const latest = useSettingsStore.getState().settings;
  setSettings({ ...latest, globalViewSettings: { ...latest.globalViewSettings, ...copied } });
};

export const saveSysSettings = async <K extends keyof SystemSettings>(
  envConfig: EnvConfigType,
  key: K,
  value: SystemSettings[K],
) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  const isDisplay = (LIBRARY_DISPLAY_KEYS as readonly string[]).includes(key);
  if (isDisplay || settings[key] !== value) {
    const next = isDisplay
      ? editLibraryDisplay(
          settings,
          key as LibraryDisplayKey,
          value as SystemSettings[LibraryDisplayKey],
        )
      : { ...settings, [key]: value };
    setSettings(next);
    try {
      await saveSettings(envConfig, next);
    } catch (error) {
      // Revert this edit only if no later action has replaced it. The same value can retry.
      if (useSettingsStore.getState().settings === next) setSettings(settings);
      throw error;
    }
  }
};
