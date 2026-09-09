import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ThemePanel from '@/components/settings/ThemePanel';
import type ThemeEditor from '@/components/settings/theme/ThemeEditor';
import { applyCustomTheme, type CustomTheme, themes } from '@/styles/themes';

type EditorProps = ComponentProps<typeof ThemeEditor>;
let editorProps: EditorProps | null = null;
const original: CustomTheme = {
  name: 'evening-paper',
  label: 'Evening paper',
  colors: {
    light: { bg: '#f4ead6', fg: '#352e24', primary: '#53452f' },
    dark: { bg: '#25211b', fg: '#e7ddcc', primary: '#c1b391' },
  },
};
const draft: CustomTheme = { ...original, label: 'Edited evening' };
const envConfig = {};
const viewSettings = {
  invertImgColorInDark: false,
  overrideColor: false,
  highlightTransparency: 0.7,
  backgroundTextureId: 'none',
  backgroundTransparency: 0.4,
  backgroundSize: 'cover',
};
const settings = {
  globalViewSettings: viewSettings,
  globalReadSettings: {
    customThemes: [original],
    customHighlightColors: {},
    userHighlightColors: [],
    defaultHighlightLabels: {},
  },
};
let themeColor = 'sepia';
const setThemeColor = vi.fn();
const setSettings = vi.fn();
const saveCustomTheme = vi.fn<(...args: unknown[]) => Promise<void>>();
const loadCustomTextures = vi.fn();

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig, appService: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    themeMode: 'light',
    themeColor,
    isDarkMode: false,
    setThemeMode: vi.fn(),
    setThemeColor,
    saveCustomTheme,
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings, setSettings, saveSettings: vi.fn() }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: () => null, getViewSettings: () => viewSettings }),
}));
vi.mock('@/styles/themes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/styles/themes')>()),
  applyCustomTheme: vi.fn(),
}));
vi.mock('@/hooks/useResetSettings', () => ({ useResetViewSettings: () => vi.fn() }));
vi.mock('@/store/customTextureStore', () => ({
  useCustomTextureStore: () => ({ textures: [], loadCustomTextures }),
}));
vi.mock('@/services/sync/replicaBinaryUpload', () => ({ queueReplicaBinaryUpload: vi.fn() }));
vi.mock('@/helpers/settings', () => ({
  getBackgroundTextureSettings: () => viewSettings,
  getLibraryViewSettings: () => viewSettings,
  saveSysSettings: vi.fn(),
  saveViewSettings: vi.fn(),
}));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: vi.fn() }),
}));
vi.mock('@/hooks/useFileSelector', () => ({ useFileSelector: () => ({ selectFiles: vi.fn() }) }));
vi.mock('@/utils/highlightjs', () => ({ manageSyntaxHighlighting: vi.fn() }));
vi.mock('@/components/settings/theme/ThemeModeSelector', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/BackgroundTextureSelector', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/HighlightColorsEditor', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/CodeHighlightingSettings', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/ReadingRulerSettings', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/LibrarySettings', () => ({ default: () => null }));
vi.mock('@/components/settings/theme/ThemeEditor', () => ({
  default: (props: EditorProps) => {
    editorProps = props;
    return (
      <section aria-label='Theme editor'>
        <input aria-label='Theme draft' defaultValue={props.customTheme?.label ?? 'New draft'} />
        <button type='button' onClick={props.onCancel}>
          Cancel
        </button>
      </section>
    );
  },
}));

function pendingWrite() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // Also observe the storage promise itself when reproducing a missing await.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function startWrite(action: 'save' | 'delete') {
  let result = Promise.resolve();
  act(() => {
    result = Promise.resolve(
      action === 'save' ? editorProps!.onSave(draft) : editorProps!.onDelete(original),
    );
  });
  return result;
}

const mount = () => render(<ThemePanel bookKey='book' onRegisterReset={vi.fn()} />);
const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

beforeEach(() => {
  vi.clearAllMocks();
  saveCustomTheme.mockReset().mockResolvedValue(undefined);
  themeColor = 'sepia';
  editorProps = null;
});
afterEach(cleanup);

describe('theme panel selection and persistence', () => {
  it('starts a fresh draft from the current palette after canceling an edit', () => {
    themeColor = original.name;
    const { rerender } = mount();
    edit();
    fireEvent.change(screen.getByRole('textbox', { name: 'Theme draft' }), {
      target: { value: 'Unsaved draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    themeColor = 'sepia';
    rerender(<ThemePanel bookKey='book' onRegisterReset={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Custom Theme' }));
    expect(editorProps!.customTheme).toBeNull();
    expect(editorProps!.baseTheme).toBe(themes.find((theme) => theme.name === 'sepia'));
    expect((screen.getByRole('textbox', { name: 'Theme draft' }) as HTMLInputElement).value).toBe(
      'New draft',
    );
    expect(saveCustomTheme).not.toHaveBeenCalled();
  });

  it('selects default and another built-in palette through the theme store', () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Default' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Soft gray' }));
    expect(setThemeColor.mock.calls).toEqual([['default'], ['darkreader']]);
    expect(saveCustomTheme).not.toHaveBeenCalled();
  });

  it('applies and selects a saved theme only after storage succeeds', async () => {
    themeColor = original.name;
    const pending = pendingWrite();
    saveCustomTheme.mockReturnValueOnce(pending.promise);
    mount();
    edit();
    const result = startWrite('save');
    expect(saveCustomTheme).toHaveBeenCalledWith(envConfig, settings, draft);
    expect(screen.queryByRole('region', { name: 'Theme editor' })).not.toBeNull();
    expect(applyCustomTheme).not.toHaveBeenCalled();
    expect(setThemeColor).not.toHaveBeenCalled();
    expect(setSettings).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve();
      await result;
    });
    expect(applyCustomTheme).toHaveBeenCalledExactlyOnceWith(draft);
    expect(setThemeColor).toHaveBeenCalledExactlyOnceWith(draft.name);
    expect(setSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Theme editor' })).toBeNull();
  });

  it('leaves the failed save draft open and propagates the failure to the editor', async () => {
    themeColor = original.name;
    const pending = pendingWrite();
    saveCustomTheme.mockReturnValueOnce(pending.promise);
    mount();
    edit();
    fireEvent.change(screen.getByRole('textbox', { name: 'Theme draft' }), {
      target: { value: draft.label },
    });
    const result = startWrite('save');
    await act(async () => {
      pending.reject(new Error('storage unavailable'));
      await expect(result).rejects.toThrow('storage unavailable');
    });
    expect((screen.getByRole('textbox', { name: 'Theme draft' }) as HTMLInputElement).value).toBe(
      draft.label,
    );
    expect(applyCustomTheme).not.toHaveBeenCalled();
    expect(setThemeColor).not.toHaveBeenCalled();
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('retains the selected custom theme and editor after deletion fails', async () => {
    themeColor = original.name;
    const pending = pendingWrite();
    saveCustomTheme.mockReturnValueOnce(pending.promise);
    mount();
    edit();
    const result = startWrite('delete');
    expect(saveCustomTheme).toHaveBeenCalledWith(envConfig, settings, original, true);
    expect(setThemeColor).not.toHaveBeenCalled();
    await act(async () => {
      pending.reject(new Error('storage unavailable'));
      await expect(result).rejects.toThrow('storage unavailable');
    });
    expect(screen.queryByRole('region', { name: 'Theme editor' })).not.toBeNull();
    expect(setThemeColor).not.toHaveBeenCalled();
    expect(setSettings).not.toHaveBeenCalled();
  });
});
