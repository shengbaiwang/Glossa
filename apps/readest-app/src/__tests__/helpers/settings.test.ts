import { describe, test, expect, beforeEach, vi } from 'vitest';

const getViewSettingsMock = vi.fn<(bookKey: string) => Partial<ViewSettings> | undefined>(
  () => undefined,
);
const setViewSettingsMock = vi.fn();
const setStylesMock = vi.fn();
const getViewMock = vi.fn<() => { renderer: { setStyles: typeof setStylesMock } } | null>(
  () => null,
);
const getViewStateMock = vi.fn<() => { isPrimary: boolean } | undefined>(() => undefined);
const getConfigMock = vi.fn<() => { viewSettings: Partial<ViewSettings> } | null>(() => null);
const saveConfigMock = vi.fn(async () => {});
const openBookKeys: string[] = [];

vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      bookKeys: openBookKeys,
      getView: getViewMock,
      getViewState: getViewStateMock,
      getViewSettings: getViewSettingsMock,
      setViewSettings: setViewSettingsMock,
    }),
  },
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getConfig: getConfigMock,
      saveConfig: saveConfigMock,
    }),
  },
}));

vi.mock('@/utils/style', () => ({
  getStyles: vi.fn(() => ''),
}));

import {
  getBackgroundTextureSettings,
  getLibraryViewSettings,
  saveViewSettings,
  saveReadingDefaults,
  saveSysSettings,
} from '@/helpers/settings';
import { useSettingsStore } from '@/store/settingsStore';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import type { ViewSettings } from '@/types/book';

const envConfig = {} as EnvConfigType;

const makeSettings = (): SystemSettings =>
  ({
    globalViewSettings: { userStylesheet: '', userUIStylesheet: '' },
  }) as unknown as SystemSettings;

const makeTextureSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    globalViewSettings: {
      backgroundTextureId: 'paper',
      backgroundTransparency: 0.4,
      backgroundSize: 'cover',
    },
    ...overrides,
  }) as unknown as SystemSettings;

beforeEach(() => {
  openBookKeys.length = 0;
  getViewSettingsMock.mockReset();
  getViewSettingsMock.mockReturnValue(undefined);
  setViewSettingsMock.mockReset();
  setStylesMock.mockReset();
  getViewMock.mockReset().mockReturnValue(null);
  getViewStateMock.mockReset().mockReturnValue(undefined);
  getConfigMock.mockReset().mockReturnValue(null);
  saveConfigMock.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: makeSettings(),
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe('getLibraryViewSettings', () => {
  test('inherits the reader/global texture when no library override is set', () => {
    const result = getLibraryViewSettings(makeTextureSettings());

    expect(result.backgroundTextureId).toBe('paper');
    expect(result.backgroundTransparency).toBe(0.4);
    expect(result.backgroundSize).toBe('cover');
  });

  test('ignores the library overrides while the reader is linked', () => {
    // Default mode: the library shares the reader/global background even when
    // stale `libraryBackground*` values are present on disk.
    const result = getLibraryViewSettings(
      makeTextureSettings({
        libraryBackgroundTextureId: 'none',
        libraryBackgroundTransparency: 0.7,
        libraryBackgroundSize: 'contain',
      }),
    );

    expect(result.backgroundTextureId).toBe('paper');
    expect(result.backgroundTransparency).toBe(0.4);
    expect(result.backgroundSize).toBe('cover');
  });

  test('uses the library overrides when the reader background is separate', () => {
    const result = getLibraryViewSettings(
      makeTextureSettings({
        readerBackgroundSeparate: true,
        libraryBackgroundTextureId: 'none',
        libraryBackgroundTransparency: 0.7,
        libraryBackgroundSize: 'contain',
      }),
    );

    expect(result.backgroundTextureId).toBe('none');
    expect(result.backgroundTransparency).toBe(0.7);
    expect(result.backgroundSize).toBe('contain');
  });

  test("tolerates the store's initial empty settings (no globalViewSettings yet)", () => {
    // useSettingsStore starts as `{} as SystemSettings`; the library page's
    // texture effect can resolve before appService.loadSettings() populates it.
    // It must yield a usable "no texture" result instead of throwing.
    const result = getLibraryViewSettings({} as SystemSettings);

    expect(result.backgroundTextureId).toBe('none');
  });

  test('resolves each field independently — an unset field still inherits', () => {
    // Only the texture id is decoupled; transparency/size were never touched and
    // must keep tracking the reader/global values.
    const result = getLibraryViewSettings(
      makeTextureSettings({ readerBackgroundSeparate: true, libraryBackgroundTextureId: 'sand' }),
    );

    expect(result.backgroundTextureId).toBe('sand');
    expect(result.backgroundTransparency).toBe(0.4);
    expect(result.backgroundSize).toBe('cover');
  });
});

describe('getBackgroundTextureSettings', () => {
  test('library scope resolves like the library page, inheriting while linked', () => {
    expect(getBackgroundTextureSettings('library', makeTextureSettings())).toEqual({
      backgroundTextureId: 'paper',
      backgroundTransparency: 0.4,
      backgroundSize: 'cover',
    });
  });

  test('library scope uses the library override when the reader is separate', () => {
    expect(
      getBackgroundTextureSettings(
        'library',
        makeTextureSettings({
          readerBackgroundSeparate: true,
          libraryBackgroundTextureId: 'sand',
        }),
      ).backgroundTextureId,
    ).toBe('sand');
  });

  test('reader scope uses the open book view settings when provided', () => {
    const readerViewSettings = {
      backgroundTextureId: 'moon',
      backgroundTransparency: 0.6,
      backgroundSize: 'auto',
    } as unknown as ViewSettings;

    expect(
      getBackgroundTextureSettings('reader', makeTextureSettings(), readerViewSettings),
    ).toEqual({
      backgroundTextureId: 'moon',
      backgroundTransparency: 0.6,
      backgroundSize: 'auto',
    });
  });

  test('reader scope falls back to global view settings when no book is open', () => {
    expect(getBackgroundTextureSettings('reader', makeTextureSettings())).toEqual({
      backgroundTextureId: 'paper',
      backgroundTransparency: 0.4,
      backgroundSize: 'cover',
    });
  });

  test('reader scope tolerates the initial empty settings', () => {
    expect(getBackgroundTextureSettings('reader', {} as SystemSettings)).toEqual({
      backgroundTextureId: 'none',
      backgroundTransparency: 0.4,
      backgroundSize: 'cover',
    });
  });
});

describe('saveViewSettings', () => {
  test('keeps an adjustment inside the current book even when it followed defaults', async () => {
    const current = { isGlobal: true, fontWeight: 400 };
    const other = { isGlobal: true, fontWeight: 400 };
    openBookKeys.push('current', 'other');
    getViewSettingsMock.mockImplementation((key) => (key === 'current' ? current : other));
    getViewStateMock.mockReturnValue({ isPrimary: true });
    getConfigMock.mockReturnValue({ viewSettings: current });
    await saveViewSettings(envConfig, 'current', 'fontWeight', 600);
    expect(current).toEqual({ isGlobal: false, fontWeight: 600 });
    expect(other.fontWeight).toBe(400);
    expect(useSettingsStore.getState().saveSettings).not.toHaveBeenCalled();
    expect(saveConfigMock).toHaveBeenCalledOnce();
  });
  test('updates defaults and following books without replacing a book-specific override', async () => {
    openBookKeys.push('following', 'personal');
    const following = { isGlobal: true, fontWeight: 400 };
    const personal = { isGlobal: false, fontWeight: 650 };
    getViewSettingsMock.mockImplementation((key) =>
      key === 'following' ? following : key === 'personal' ? personal : undefined,
    );
    await saveViewSettings(envConfig, '', 'fontWeight', 500);
    expect(following.fontWeight).toBe(500);
    expect(personal.fontWeight).toBe(650);
    expect(useSettingsStore.getState().settings.globalViewSettings.fontWeight).toBe(500);
  });
  test('explicitly retries a failed per-book write without applying unchanged styles again', async () => {
    const viewSettings = { isGlobal: false, fontWeight: 400 };
    const config = { viewSettings };
    getViewSettingsMock.mockReturnValue(viewSettings);
    getViewMock.mockReturnValue({ renderer: { setStyles: setStylesMock } });
    getViewStateMock.mockReturnValue({ isPrimary: true });
    getConfigMock.mockReturnValue(config);
    saveConfigMock.mockRejectedValueOnce(new Error('disk full'));

    await expect(saveViewSettings(envConfig, 'book-1', 'fontWeight', 700)).rejects.toThrow(
      'disk full',
    );
    expect(viewSettings.fontWeight).toBe(700);
    expect(setViewSettingsMock).toHaveBeenCalledOnce();
    expect(setStylesMock).toHaveBeenCalledOnce();

    await saveViewSettings(envConfig, 'book-1', 'fontWeight', 700);
    expect(saveConfigMock).toHaveBeenCalledOnce();

    await saveViewSettings(envConfig, 'book-1', 'fontWeight', 700, false, true, true);
    expect(saveConfigMock).toHaveBeenCalledTimes(2);
    expect(saveConfigMock).toHaveBeenLastCalledWith(
      envConfig,
      'book-1',
      config,
      useSettingsStore.getState().settings,
    );
    expect(setViewSettingsMock).toHaveBeenCalledOnce();
    expect(setStylesMock).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().saveSettings).not.toHaveBeenCalled();
  });

  test('serializes a following book against the newly saved defaults', async () => {
    const viewSettings = { isGlobal: true, fontWeight: 400 };
    const config = { viewSettings };
    openBookKeys.push('book-1');
    getViewSettingsMock.mockReturnValue(viewSettings);
    getViewStateMock.mockReturnValue({ isPrimary: true });
    getConfigMock.mockReturnValue(config);
    await saveViewSettings(envConfig, '', 'fontWeight', 700);
    expect(saveConfigMock).toHaveBeenCalledWith(
      envConfig,
      'book-1',
      config,
      useSettingsStore.getState().settings,
    );
  });

  test('global write swaps the settings reference so replicaSettingsSync subscribers fire', async () => {
    // Mirrors the gating subscriber installed by replicaSettingsSync.initSettingsSync.
    // The publish path is bypassed entirely when this never fires, which is exactly
    // why the MiscPanel "Apply" button was failing to ship custom CSS to the server
    // until some unrelated setSettings call (e.g. dictionary provider toggle)
    // happened to create a new top-level reference and trigger a diff sweep.
    const referenceChanges: SystemSettings[] = [];
    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (state.settings && state.settings !== prev?.settings) {
        referenceChanges.push(state.settings);
      }
    });

    try {
      await saveViewSettings(envConfig, '', 'userStylesheet', 'body { color: red; }');
    } finally {
      unsubscribe();
    }

    expect(referenceChanges).toHaveLength(1);
    expect(referenceChanges[0]!.globalViewSettings.userStylesheet).toBe('body { color: red; }');
  });

  test('global write persists with the same new reference passed to setSettings', async () => {
    let savedSettings: SystemSettings | null = null;
    const saveSettingsMock = vi.fn(async (_env: EnvConfigType, s: SystemSettings) => {
      savedSettings = s;
    });
    useSettingsStore.setState({
      saveSettings: saveSettingsMock,
    } as unknown as ReturnType<typeof useSettingsStore.getState>);

    await saveViewSettings(envConfig, '', 'userUIStylesheet', '.app { background: black; }');

    expect(saveSettingsMock).toHaveBeenCalledTimes(1);
    expect(savedSettings!.globalViewSettings.userUIStylesheet).toBe('.app { background: black; }');
    expect(savedSettings).toBe(useSettingsStore.getState().settings);
  });

  test('per-book write (isGlobal=false) does not touch the global settings reference', async () => {
    getViewSettingsMock.mockImplementation(() => ({ isGlobal: false }));
    const initial = useSettingsStore.getState().settings;
    const referenceChanges: SystemSettings[] = [];
    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (state.settings && state.settings !== prev?.settings) {
        referenceChanges.push(state.settings);
      }
    });

    try {
      await saveViewSettings(envConfig, 'book-1', 'userStylesheet', 'body { color: blue; }');
    } finally {
      unsubscribe();
    }

    // Per-book writes go through applyViewSettings on the readerStore — they
    // must NOT publish global settings, otherwise per-book overrides would leak
    // into the cross-device globals.
    expect(referenceChanges).toHaveLength(0);
    expect(useSettingsStore.getState().settings).toBe(initial);
  });
});

describe('saveReadingDefaults', () => {
  test('copies reading preferences without locations, private text or application state', async () => {
    const current = {
      isGlobal: false,
      fontWeight: 650,
      ttsRate: 1.6,
      ttsLocation: 'private-cfi',
      ttsReadAloudText: 'private excerpt',
      sideBarTab: 'search',
      uiLanguage: 'fr',
      referencePageCount: 999,
    };
    getViewSettingsMock.mockReturnValue(current);
    await saveReadingDefaults(envConfig, 'current');
    const saved = useSettingsStore.getState().settings.globalViewSettings;
    expect(saved.fontWeight).toBe(650);
    expect(saved.ttsRate).toBe(1.6);
    for (const key of [
      'ttsLocation',
      'ttsReadAloudText',
      'sideBarTab',
      'uiLanguage',
      'referencePageCount',
      'isGlobal',
    ])
      expect(saved).not.toHaveProperty(key);
    expect(current.ttsLocation).toBe('private-cfi');
    expect(current.isGlobal).toBe(false);
    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().saveSettings).toHaveBeenCalledOnce();
  });
  test('keeps the previous defaults when persistence fails and allows retry', async () => {
    getViewSettingsMock.mockReturnValue({ fontWeight: 650 });
    const before = useSettingsStore.getState().settings;
    vi.mocked(useSettingsStore.getState().saveSettings).mockRejectedValueOnce(new Error('disk'));
    await expect(saveReadingDefaults(envConfig, 'current')).rejects.toThrow('disk');
    expect(useSettingsStore.getState().settings).toBe(before);
    await saveReadingDefaults(envConfig, 'current');
    expect(useSettingsStore.getState().settings.globalViewSettings.fontWeight).toBe(650);
  });
});

test('failed display edits retain retry and cannot revert a later preference', async () => {
  const save = vi.mocked(useSettingsStore.getState().saveSettings);
  save.mockRejectedValueOnce(new Error('disk'));
  await expect(saveSysSettings(envConfig, 'libraryCoverWidth', 220)).rejects.toThrow('disk');
  await saveSysSettings(envConfig, 'libraryCoverWidth', 220);
  expect(save).toHaveBeenCalledTimes(2);
  expect(useSettingsStore.getState().settings.libraryCoverWidth).toBe(220);
  let reject!: (error: Error) => void;
  save.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const earlier = saveSysSettings(envConfig, 'libraryCoverWidth', 200);
  await saveSysSettings(envConfig, 'libraryCoverWidth', 240);
  reject(new Error('late failure'));
  await expect(earlier).rejects.toThrow();
  expect(useSettingsStore.getState().settings.libraryCoverWidth).toBe(240);
});
