import React, { useState, useEffect } from 'react';
import {
  applyCustomTheme,
  CustomTheme,
  generateDarkPalette,
  generateLightPalette,
  Theme,
  themes,
} from '@/styles/themes';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { queueReplicaBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import {
  BackgroundTextureScope,
  getBackgroundTextureSettings,
  getLibraryViewSettings,
  saveSysSettings,
  saveViewSettings,
} from '@/helpers/settings';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { manageSyntaxHighlighting } from '@/utils/highlightjs';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { useFileSelector } from '@/hooks/useFileSelector';
import { PREDEFINED_TEXTURES } from '@/styles/textures';

import { DefaultHighlightColor, HighlightColor, UserHighlightColor } from '@/types/book';
import clsx from 'clsx';
import { BoxedList, SettingsSwitchRow } from './primitives';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import ThemeEditor from './theme/ThemeEditor';
import ThemeModeSelector from './theme/ThemeModeSelector';
import ThemeColorSelector from './theme/ThemeColorSelector';
import BackgroundTextureSelector from './theme/BackgroundTextureSelector';
import HighlightColorsEditor from './theme/HighlightColorsEditor';
import CodeHighlightingSettings from './theme/CodeHighlightingSettings';
import ReadingRulerSettings from './theme/ReadingRulerSettings';
import LibrarySettings from './theme/LibrarySettings';

const ThemePanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { themeMode, themeColor, isDarkMode, setThemeMode, setThemeColor, saveCustomTheme } =
    useThemeStore();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { getView, getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  // The Background Image picker is linked by default: one texture drives both
  // the library page and the reader. Turning on "Use Separate Reader
  // Background" decouples them and exposes a Library|Reader scope switcher.
  const isLibraryContext = !bookKey;
  const separateReader = settings.readerBackgroundSeparate === true;
  const [textureScope, setTextureScope] = useState<BackgroundTextureScope>(
    isLibraryContext ? 'library' : 'reader',
  );
  const sharedBackground = {
    backgroundTextureId: settings.globalViewSettings?.backgroundTextureId ?? 'none',
    backgroundTransparency: settings.globalViewSettings?.backgroundTransparency ?? 0.4,
    backgroundSize: settings.globalViewSettings?.backgroundSize ?? 'cover',
  };
  const currentBackground = separateReader
    ? getBackgroundTextureSettings(textureScope, settings, bookKey ? viewSettings : undefined)
    : sharedBackground;
  const currentTextureId = currentBackground.backgroundTextureId;
  const currentBackgroundTransparency = currentBackground.backgroundTransparency;
  const currentBackgroundSize = currentBackground.backgroundSize;

  const [invertImgColorInDark, setInvertImgColorInDark] = useState(
    viewSettings.invertImgColorInDark,
  );
  const [editTheme, setEditTheme] = useState<CustomTheme | null>(null);
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [showCustomThemeEditor, setShowCustomThemeEditor] = useState(false);
  const [overrideColor, setOverrideColor] = useState(viewSettings.overrideColor);
  const [codeHighlighting, setcodeHighlighting] = useState(viewSettings.codeHighlighting);
  const [codeLanguage, setCodeLanguage] = useState(viewSettings.codeLanguage);
  const [selectedTextureId, setSelectedTextureId] = useState(currentTextureId);
  const [backgroundTransparency, setBackgroundTransparency] = useState(
    currentBackgroundTransparency,
  );
  const [backgroundSize, setBackgroundSize] = useState(currentBackgroundSize);
  const [highlightTransparency, setHighlightTransparency] = useState(
    viewSettings.highlightTransparency ?? 0.6,
  );
  const [customHighlightColors, setCustomHighlightColors] = useState(
    settings.globalReadSettings.customHighlightColors,
  );
  const [userHighlightColors, setUserHighlightColors] = useState<UserHighlightColor[]>(
    settings.globalReadSettings.userHighlightColors ?? [],
  );
  const [defaultHighlightLabels, setDefaultHighlightLabels] = useState<
    Partial<Record<DefaultHighlightColor, string>>
  >(settings.globalReadSettings.defaultHighlightLabels ?? {});

  const [readingRulerEnabled, setReadingRulerEnabled] = useState(viewSettings.readingRulerEnabled);
  const [readingRulerLines, setReadingRulerLines] = useState(viewSettings.readingRulerLines);
  const [readingRulerTransparency, setReadingRulerTransparency] = useState(
    viewSettings.readingRulerTransparency,
  );
  const [readingRulerColor, setReadingRulerColor] = useState(viewSettings.readingRulerColor);

  const [skeuomorphicCovers, setSkeuomorphicCovers] = useState(settings.librarySkeuomorphicCovers);

  const {
    textures: customTextures,
    addTexture,
    loadTexture,
    removeTexture,
    loadCustomTextures,
    saveCustomTextures,
  } = useCustomTextureStore();
  const resetToDefaults = useResetViewSettings();
  const { selectFiles } = useFileSelector(appService, _);
  const { applyBackgroundTexture } = useBackgroundTexture();

  const handleReset = () => {
    resetToDefaults({
      overrideColor: setOverrideColor,
      invertImgColorInDark: setInvertImgColorInDark,
      highlightTransparency: setHighlightTransparency,
      codeHighlighting: setcodeHighlighting,
      codeLanguage: setCodeLanguage,
      readingRulerEnabled: setReadingRulerEnabled,
      readingRulerLines: setReadingRulerLines,
      readingRulerTransparency: setReadingRulerTransparency,
    });
    setThemeColor('default');
    setThemeMode('auto');
    setSelectedTextureId('none');
    setBackgroundTransparency(0.4);
    setBackgroundSize('cover');
    setCustomHighlightColors(HIGHLIGHT_COLOR_HEX);
    setUserHighlightColors([]);
    setDefaultHighlightLabels({});
  };

  const handleTextureSelect = (id: string) => {
    setSelectedTextureId(id);
    const isAnimated = PREDEFINED_TEXTURES.some((t) => t.id === id && t.animated);
    if (isAnimated) {
    } else {
    }
  };

  const handleSeparateReaderChange = (separate: boolean) => {
    saveSysSettings(envConfig, 'readerBackgroundSeparate', separate);
    if (separate) {
      // Seed the library's independent values from the current shared look so
      // both pages start equal and the library can then diverge on its own.
      const shared = useSettingsStore.getState().settings.globalViewSettings;
      saveSysSettings(
        envConfig,
        'libraryBackgroundTextureId',
        shared?.backgroundTextureId ?? 'none',
      );
      saveSysSettings(
        envConfig,
        'libraryBackgroundTransparency',
        shared?.backgroundTransparency ?? 0.4,
      );
      saveSysSettings(envConfig, 'libraryBackgroundSize', shared?.backgroundSize ?? 'cover');
      const next = getBackgroundTextureSettings(
        textureScope,
        useSettingsStore.getState().settings,
        bookKey ? viewSettings : undefined,
      );
      setSelectedTextureId(next.backgroundTextureId);
      setBackgroundTransparency(next.backgroundTransparency);
      setBackgroundSize(next.backgroundSize);
    } else {
      // Back to linked: re-seed the editor from the shared value so the picker
      // highlights what both pages now show.
      const shared = useSettingsStore.getState().settings.globalViewSettings;
      setSelectedTextureId(shared?.backgroundTextureId ?? 'none');
      setBackgroundTransparency(shared?.backgroundTransparency ?? 0.4);
      setBackgroundSize(shared?.backgroundSize ?? 'cover');
    }
    // Repaint the open page: decoupling/relinking changes what the library
    // resolves even when the edited values themselves are unchanged.
    applyPageBackgroundTexture();
  };

  const handleScopeChange = (scope: BackgroundTextureScope) => {
    if (scope === textureScope) return;
    // Re-seed the editing state from the new scope's stored values; the
    // equality guards in the save effects keep this from writing anything.
    const next = getBackgroundTextureSettings(scope, settings, bookKey ? viewSettings : undefined);
    setTextureScope(scope);
    setSelectedTextureId(next.backgroundTextureId);
    setBackgroundTransparency(next.backgroundTransparency);
    setBackgroundSize(next.backgroundSize);
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCustomTextures(envConfig);
  }, [loadCustomTextures, envConfig]);

  useEffect(() => {
    if (invertImgColorInDark === viewSettings.invertImgColorInDark) return;
    saveViewSettings(envConfig, bookKey, 'invertImgColorInDark', invertImgColorInDark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invertImgColorInDark]);

  useEffect(() => {
    if (overrideColor === viewSettings.overrideColor) return;
    saveViewSettings(envConfig, bookKey, 'overrideColor', overrideColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideColor]);

  useEffect(() => {
    if (highlightTransparency === viewSettings.highlightTransparency) return;
    saveViewSettings(envConfig, bookKey, 'highlightTransparency', highlightTransparency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightTransparency]);

  useEffect(() => {
    let update = false;
    if (codeHighlighting !== viewSettings.codeHighlighting) {
      saveViewSettings(envConfig, bookKey, 'codeHighlighting', codeHighlighting);
      update = true;
    }
    if (codeLanguage !== viewSettings.codeLanguage) {
      saveViewSettings(envConfig, bookKey, 'codeLanguage', codeLanguage);
      update = true;
    }
    if (!update) return;
    const view = getView(bookKey);
    if (!view) return;
    const docs = view.renderer.getContents();
    docs.forEach(({ doc }) => manageSyntaxHighlighting(doc, viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeHighlighting, codeLanguage]);

  useEffect(() => {
    if (selectedTextureId === currentTextureId) return;
    if (!separateReader) {
      // Linked: the shared value lives in the global view settings so every
      // book and the library follow it.
      saveViewSettings(envConfig, '', 'backgroundTextureId', selectedTextureId);
    } else if (textureScope === 'library') {
      saveSysSettings(envConfig, 'libraryBackgroundTextureId', selectedTextureId);
    } else {
      saveViewSettings(envConfig, bookKey, 'backgroundTextureId', selectedTextureId);
    }
    applyPageBackgroundTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTextureId]);

  useEffect(() => {
    if (backgroundTransparency === currentBackgroundTransparency) return;
    if (!separateReader) {
      saveViewSettings(envConfig, '', 'backgroundTransparency', backgroundTransparency);
    } else if (textureScope === 'library') {
      saveSysSettings(envConfig, 'libraryBackgroundTransparency', backgroundTransparency);
    } else {
      saveViewSettings(envConfig, bookKey, 'backgroundTransparency', backgroundTransparency);
    }
    applyPageBackgroundTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundTransparency]);

  useEffect(() => {
    if (backgroundSize === currentBackgroundSize) return;
    if (!separateReader) {
      saveViewSettings(envConfig, '', 'backgroundSize', backgroundSize);
    } else if (textureScope === 'library') {
      saveSysSettings(envConfig, 'libraryBackgroundSize', backgroundSize);
    } else {
      saveViewSettings(envConfig, bookKey, 'backgroundSize', backgroundSize);
    }
    applyPageBackgroundTexture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundSize]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'readingRulerEnabled', readingRulerEnabled, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingRulerEnabled]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'readingRulerLines', readingRulerLines, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingRulerLines]);

  useEffect(() => {
    saveViewSettings(
      envConfig,
      bookKey,
      'readingRulerTransparency',
      readingRulerTransparency,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingRulerTransparency]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'readingRulerColor', readingRulerColor, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingRulerColor]);

  // Repaint the page the settings dialog is open on. The library resolves
  // through getLibraryViewSettings (linked to the reader unless decoupled);
  // the reader path passes the edited values straight through.
  const applyPageBackgroundTexture = () => {
    if (isLibraryContext) {
      applyBackgroundTexture(
        envConfig,
        getLibraryViewSettings(useSettingsStore.getState().settings),
      );
    } else {
      applyBackgroundTexture(envConfig, {
        ...viewSettings,
        backgroundTextureId: selectedTextureId,
        backgroundTransparency,
        backgroundSize,
      });
    }
  };

  useEffect(() => {
    const customThemes = settings.globalReadSettings.customThemes ?? [];
    setCustomThemes(
      customThemes.map((customTheme) => ({
        name: customTheme.name,
        label: customTheme.label,
        colors: {
          light: generateLightPalette(customTheme.colors.light),
          dark: generateDarkPalette(customTheme.colors.dark),
        },
        isCustomizable: true,
      })),
    );
  }, [settings]);

  useEffect(() => {
    if (skeuomorphicCovers === settings.librarySkeuomorphicCovers) return;

    saveSysSettings(envConfig, 'librarySkeuomorphicCovers', skeuomorphicCovers);
  }, [skeuomorphicCovers]);

  const handleSaveCustomTheme = async (customTheme: CustomTheme) => {
    await saveCustomTheme(envConfig, settings, customTheme);
    applyCustomTheme(customTheme);
    setSettings({ ...settings });
    setThemeColor(customTheme.name);
    setShowCustomThemeEditor(false);
  };

  const handleDeleteCustomTheme = async (customTheme: CustomTheme) => {
    await saveCustomTheme(envConfig, settings, customTheme, true);
    setSettings({ ...settings });
    setThemeColor('default');
    setShowCustomThemeEditor(false);
  };

  const handleEditTheme = (name: string) => {
    const customTheme = settings.globalReadSettings.customThemes.find((t) => t.name === name);
    if (customTheme) {
      setEditTheme(customTheme);
      setShowCustomThemeEditor(true);
    }
  };

  const handleImportImage = () => {
    selectFiles({ type: 'images', multiple: true }).then(async (result) => {
      if (result.error || result.files.length === 0) return;
      for (const selectedFile of result.files) {
        const textureInfo = await appService?.importImage(selectedFile.path || selectedFile.file);
        if (!textureInfo) continue;

        const customTexture = addTexture(textureInfo.path, {
          name: textureInfo.name,
          contentId: textureInfo.contentId,
          bundleDir: textureInfo.bundleDir,
          byteSize: textureInfo.byteSize,
        });
        if (customTexture && !customTexture.error) {
          await loadTexture(envConfig, customTexture.id);
          if (appService) void queueReplicaBinaryUpload('texture', customTexture, appService);
        }
      }
      saveCustomTextures(envConfig);
    });
  };

  const handleDeleteCustomTexture = (textureId: string) => {
    removeTexture(textureId);
    const updatedTextures = customTextures.filter((t) => t.id !== textureId);

    settings.customTextures = updatedTextures;
    setSettings(settings);

    if (selectedTextureId === textureId) {
      setSelectedTextureId('none');
    }
    saveCustomTextures(envConfig);
  };

  const handleCustomHighlightColorsChange = (colors: Record<HighlightColor, string>) => {
    setCustomHighlightColors(colors);
    settings.globalReadSettings.customHighlightColors = colors;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleUserHighlightColorsChange = (colors: UserHighlightColor[]) => {
    setUserHighlightColors(colors);
    settings.globalReadSettings.userHighlightColors = colors;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleDefaultHighlightLabelsChange = (
    labels: Partial<Record<DefaultHighlightColor, string>>,
  ) => {
    setDefaultHighlightLabels(labels);
    settings.globalReadSettings.defaultHighlightLabels = labels;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  return (
    // In editor mode the ThemeEditor owns its own top spacing (mt-6) and pins a
    // sticky Save/Cancel footer to the scroll bottom. Dropping the wrapper's
    // bottom margin here removes the gap between the editor's bottom edge and
    // the scroll viewport, so the footer sits flush with no bottom gap and no
    // upward jump when scrolled to the end.
    <div className={clsx('w-full', showCustomThemeEditor ? '' : 'my-4 space-y-6')}>
      {showCustomThemeEditor ? (
        <ThemeEditor
          customTheme={editTheme}
          baseTheme={themes.concat(customThemes).find((theme) => theme.name === themeColor)}
          onSave={handleSaveCustomTheme}
          onDelete={handleDeleteCustomTheme}
          onCancel={() => setShowCustomThemeEditor(false)}
        />
      ) : (
        <>
          <ThemeModeSelector
            themeMode={themeMode}
            onThemeModeChange={setThemeMode}
            hasAmbientLightSensor={!!appService?.hasAmbientLightSensor}
            data-setting-id='settings.color.themeMode'
          />

          <ThemeColorSelector
            themes={themes.concat(customThemes)}
            themeColor={themeColor}
            isDarkMode={isDarkMode}
            onThemeColorChange={setThemeColor}
            onEditTheme={handleEditTheme}
            onCreateTheme={() => {
              setEditTheme(null);
              setShowCustomThemeEditor(true);
            }}
            data-setting-id='settings.color.themeColor'
          />

          <BoxedList title={_('Reading colors')}>
            <SettingsSwitchRow
              data-setting-id='settings.color.overrideBookColor'
              label={_('Override Book Color')}
              checked={overrideColor}
              onChange={() => setOverrideColor(!overrideColor)}
            />
            <SettingsSwitchRow
              data-setting-id='settings.color.invertImageInDarkMode'
              label={_('Invert Image In Dark Mode')}
              checked={invertImgColorInDark}
              disabled={!isDarkMode}
              onChange={() => setInvertImgColorInDark(!invertImgColorInDark)}
            />
          </BoxedList>

          <BackgroundTextureSelector
            predefinedTextures={PREDEFINED_TEXTURES}
            customTextures={customTextures.filter((t) => !t.deletedAt)}
            separateReader={separateReader}
            onSeparateReaderChange={handleSeparateReaderChange}
            scope={textureScope}
            onScopeChange={handleScopeChange}
            selectedTextureId={selectedTextureId}
            backgroundTransparency={backgroundTransparency}
            backgroundSize={backgroundSize}
            onTextureSelect={handleTextureSelect}
            onTransparencyChange={setBackgroundTransparency}
            onSizeChange={setBackgroundSize}
            onImportImage={handleImportImage}
            onDeleteTexture={handleDeleteCustomTexture}
            data-setting-id='settings.color.backgroundTexture'
          />

          <HighlightColorsEditor
            customHighlightColors={customHighlightColors}
            userHighlightColors={userHighlightColors}
            defaultHighlightLabels={defaultHighlightLabels}
            highlightTransparency={highlightTransparency}
            onCustomHighlightColorsChange={handleCustomHighlightColorsChange}
            onUserHighlightColorsChange={handleUserHighlightColorsChange}
            onDefaultHighlightLabelsChange={handleDefaultHighlightLabelsChange}
            onTransparencyChange={setHighlightTransparency}
            data-setting-id='settings.color.highlightColors'
          />

          <ReadingRulerSettings
            enabled={readingRulerEnabled}
            lines={readingRulerLines}
            transparency={readingRulerTransparency}
            color={readingRulerColor}
            onEnabledChange={setReadingRulerEnabled}
            onLinesChange={setReadingRulerLines}
            onTransparencyChange={setReadingRulerTransparency}
            onColorChange={setReadingRulerColor}
            data-setting-id='settings.color.readingRuler'
          />

          <CodeHighlightingSettings
            codeHighlighting={codeHighlighting}
            codeLanguage={codeLanguage}
            onToggle={setcodeHighlighting}
            onLanguageChange={setCodeLanguage}
            data-setting-id='settings.color.codeHighlighting'
          />

          <LibrarySettings
            skeuomorphicCovers={skeuomorphicCovers}
            onToggle={setSkeuomorphicCovers}
            data-setting-id='settings.library.skeuomorphicCovers'
          />
        </>
      )}
    </div>
  );
};

export default ThemePanel;
