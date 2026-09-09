import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_BOOK_FONT } from '@/services/constants';
import FontPanel from '@/components/settings/FontPanel';
import { saveViewSettings } from '@/helpers/settings';

const saved = {
  ...DEFAULT_BOOK_FONT,
  serifFont: 'Bitter',
  defaultCJKFont: 'LXGW WenKai GB Screen',
};
const removed = [
  '100-SS Xian Song Ti',
  '173-SSShanShuiSongTi',
  '波本威士忌',
  '寒蝉锦书宋Compact',
  '三极花朝体',
  '三极花朝体 粗',
  '三极花朝体 细',
  '三极花朝体 纤细',
];
const imported = [...removed, 'My Reading Font'];
const appService = { isAndroidApp: false };
const setFontPanelView = vi.fn();
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService }) }));
vi.mock('@/utils/bridge', () => ({
  getSysFontsList: async () => ({
    fonts: Object.fromEntries([...removed, 'My System Font'].map((font) => [font, font])),
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: () => 16 }));
vi.mock('@/hooks/useResetSettings', () => ({ useResetViewSettings: () => vi.fn() }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: vi.fn() }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/misc', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getOSPlatform: () => 'macos',
  isCJKEnv: () => true,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: () => null, getViewSettings: () => saved }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: saved },
    fontPanelView: 'main-fonts',
    setFontPanelView,
  }),
}));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ fonts: [], getFontFamilies: () => imported }),
}));
vi.mock('@/components/settings/CustomFonts', () => ({ default: () => null }));
// Keep the real panel/state/option wiring, simplify only the virtualized dropdown renderer.
vi.mock('@/components/settings/FontDropDown', () => ({
  default: ({
    selected,
    options,
    moreOptions = [],
    onSelect,
  }: {
    selected: string;
    options: { option: string; label: string }[];
    moreOptions?: { option: string; label: string }[];
    onSelect: (value: string) => void;
  }) => (
    <select value={selected} onChange={(event) => onSelect(event.target.value)}>
      {[...options, ...moreOptions].map(({ option, label }, index) => (
        <option key={`${index}-${option}`} value={option}>
          {label}
        </option>
      ))}
    </select>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('common font settings', () => {
  it('does not reinsert a removed saved font into any dropdown', () => {
    const previous = saved.serifFont;
    saved.serifFont = removed[0]!;
    try {
      const { container } = render(<FontPanel bookKey='book' onRegisterReset={vi.fn()} />);
      const serif = container.querySelector<HTMLSelectElement>(
        '[data-setting-id="settings.font.serifFont"] select',
      )!;
      expect(serif.value).toBe('Times New Roman');
      for (const font of removed) expect(screen.queryAllByText(font)).toHaveLength(0);
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'serifFont', 'Times New Roman');
    } finally {
      saved.serifFont = previous;
    }
  });
  it('keeps system expansion and font management while excluding only the unwanted fonts', async () => {
    const { container } = render(<FontPanel bookKey='book' onRegisterReset={vi.fn()} />);
    const serif = container.querySelector<HTMLSelectElement>(
      '[data-setting-id="settings.font.serifFont"] select',
    )!;
    await waitFor(() =>
      expect([...serif.options].map((option) => option.value)).toContain('My System Font'),
    );
    expect(serif.value).toBe('Times New Roman');
    expect([...serif.options].map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'Times New Roman',
        'Georgia',
        'SimSun',
        'KaiTi',
        'Yu Mincho',
        'Batang',
        'Traditional Arabic',
        'My Reading Font',
      ]),
    );
    for (const font of removed) expect(screen.queryAllByText(font)).toHaveLength(0);
    fireEvent.click(screen.getByText('Manage Fonts'));
    expect(setFontPanelView).toHaveBeenCalledWith('custom-fonts');
    expect(screen.queryByText('Bitter')).toBeNull();
    expect(screen.queryByText('LXGW WenKai GB Screen')).toBeNull();
    const cjk = container.querySelector<HTMLSelectElement>(
      '[data-setting-id="settings.font.cjkFont"] select',
    )!;
    expect(cjk.value).toBe('Auto');
    fireEvent.change(cjk, { target: { value: 'KaiTi' } });
    expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'defaultCJKFont', 'KaiTi');
  });
});
