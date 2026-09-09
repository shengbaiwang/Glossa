import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_BOOK_FONT } from '@/services/constants';
import FontPanel from '@/components/settings/FontPanel';
import { saveViewSettings } from '@/helpers/settings';

const saved = { ...DEFAULT_BOOK_FONT, overrideFont: false, isGlobal: false };
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
const appService = {
  isAndroidApp: false,
  getDefaultViewSettings: () => ({ ...DEFAULT_BOOK_FONT, overrideFont: false }),
};
const setFontPanelView = vi.fn();
let activeSettingsItemId: string | null = null;
const nativeFonts = vi.fn(async () => ({
  fonts: Object.fromEntries([...removed, 'My System Font'].map((font) => [font, font])),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService }) }));
vi.mock('@/utils/bridge', () => ({
  getSysFontsList: () => nativeFonts(),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: vi.fn() }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn(async () => {}) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/utils/misc', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getOSPlatform: () => 'macos',
  getLocale: () => 'zh-CN',
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: () => null, getViewSettings: () => saved }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: saved },
    fontPanelView: 'main-fonts',
    setFontPanelView,
    activeSettingsItemId,
  }),
}));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getFontFamilies: () => [...imported] }),
}));
vi.mock('@/components/settings/CustomFonts', () => ({ default: () => null }));

beforeEach(() => {
  Object.assign(saved, DEFAULT_BOOK_FONT, { overrideFont: false, isGlobal: false });
  activeSettingsItemId = null;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const mount = () => render(<FontPanel bookKey='book' onRegisterReset={vi.fn()} />);

describe('Glossa font settings', () => {
  it('does not save unchanged settings merely by opening the panel', async () => {
    mount();
    await waitFor(() => expect(nativeFonts).toHaveBeenCalledOnce());
    expect(saveViewSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'This Book' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByText('Minimum Font Size')).toBeNull();
  });
  it('switches font source without losing the chosen fonts', async () => {
    saved.serifFont = 'Georgia';
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'My Fonts' }));
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'overrideFont', true),
    );
    expect(screen.getByText('微雨从东来，好风与之俱')).toBeTruthy();
    expect(screen.getByText('Sunt lacrimae rerum et mentem mortalia tangunt.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Book Fonts' }));
    expect(screen.getByRole('button', { name: 'Western Font: Georgia' })).toBeTruthy();
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'overrideFont', false),
    );
  });
  it('migrates obsolete selections and never reinserts removed fonts', async () => {
    saved.serifFont = removed[0]!;
    saved.defaultCJKFont = 'LXGW WenKai GB Screen';
    mount();
    expect(screen.getByRole('button', { name: 'Western Font: Times New Roman' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chinese Font: Auto' })).toBeTruthy();
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'serifFont', 'Times New Roman'),
    );
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'defaultCJKFont', 'Auto'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Western Font: Times New Roman' }));
    for (const font of removed) expect(screen.queryAllByText(font)).toHaveLength(0);
  });
  it('searches system and imported fonts, selects directly and enables custom fonts', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Western Font: Times New Roman' }));
    await screen.findByRole('button', { name: 'My System Font' });
    expect(screen.getByRole('button', { name: 'My Reading Font' })).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Georgia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Georgia' }));
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'serifFont', 'Georgia'),
    );
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'overrideFont', true),
    );
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chinese Font: Auto' }));
    fireEvent.click(screen.getByRole('button', { name: 'KaiTi' }));
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'defaultCJKFont', 'KaiTi'),
    );
    const preview = screen.getByRole('region', { name: 'Font Preview' });
    expect(preview.querySelector('p')!.style.fontFamily).toContain('Kaiti SC');
    fireEvent.click(screen.getByRole('button', { name: 'Manage Fonts' }));
    expect(setFontPanelView).toHaveBeenCalledWith('custom-fonts');
  });
  it('uses labeled bounded size and weight controls and exposes advanced fields on demand', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Increase Font Size' }));
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'defaultFontSize', 17),
    );
    const size = screen.getByRole('spinbutton', { name: 'Font Size' });
    fireEvent.change(size, { target: { value: '999' } });
    fireEvent.blur(size);
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'defaultFontSize', 120),
    );
    expect(
      (screen.getByRole('button', { name: 'Increase Font Size' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Medium' }));
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'fontWeight', 500),
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('spinbutton', { name: 'Minimum Font Size' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Monospace Font: Courier New' })).toBeTruthy();
  });
  it('restores current defaults explicitly and preserves scope', async () => {
    saved.defaultFontSize = 24;
    saved.overrideFont = true;
    saved.serifFont = 'Georgia';
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'defaultFontSize', 16),
    );
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'serifFont', 'Times New Roman'),
    );
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'overrideFont', false),
    );
    expect(vi.mocked(saveViewSettings).mock.calls.some((call) => call[2] === 'isGlobal')).toBe(
      false,
    );
  });
  it('shows inherited global scope and changes it only on explicit selection', async () => {
    saved.isGlobal = true;
    mount();
    expect(screen.getByRole('button', { name: 'All Books' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'This Book' }));
    await waitFor(() =>
      expect(saveViewSettings).toHaveBeenCalledWith({}, 'book', 'isGlobal', false, true, false),
    );
  });
  it('opens advanced options for a settings search target', async () => {
    activeSettingsItemId = 'settings.font.monospaceFont';
    mount();
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Monospace Font: Courier New' })).toBeTruthy();
  });
  it('updates after externally changed font selections without restoring a deleted font', async () => {
    saved.serifFont = 'My Reading Font';
    const rendered = mount();
    saved.serifFont = 'Times New Roman';
    rendered.rerender(<FontPanel bookKey='book' onRegisterReset={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Western Font: Times New Roman' })).toBeTruthy();
    expect(saveViewSettings).not.toHaveBeenCalled();
  });
  it('keeps builtin choices available when system font loading fails and offers retry', async () => {
    nativeFonts.mockRejectedValueOnce(new Error('native unavailable'));
    mount();
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('System fonts unavailable');
    fireEvent.click(within(status).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('System fonts unavailable')).toBeNull());
  });
  it('reports save failures and retries the chosen value', async () => {
    vi.mocked(saveViewSettings).mockRejectedValueOnce(new Error('disk full'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(saveViewSettings).toHaveBeenLastCalledWith(
      {},
      'book',
      'fontWeight',
      700,
      false,
      true,
      true,
    );
  });
  it('serializes rapid edits and preserves the latest preview while an earlier write completes', async () => {
    let finishFirst!: () => void;
    vi.mocked(saveViewSettings).mockImplementationOnce(async (_env, _book, key, value) => {
      Object.assign(saved, { [key]: value });
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });
    const rendered = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Increase Font Size' }));
    await waitFor(() => expect(saveViewSettings).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Increase Font Size' }));
    rendered.rerender(<FontPanel bookKey='book' onRegisterReset={vi.fn()} />);
    expect((screen.getByRole('spinbutton', { name: 'Font Size' }) as HTMLInputElement).value).toBe(
      '18',
    );
    expect(saveViewSettings).toHaveBeenCalledTimes(1);
    await act(async () => finishFirst());
    await waitFor(() => expect(saveViewSettings).toHaveBeenCalledTimes(2));
    expect(saveViewSettings).toHaveBeenLastCalledWith({}, 'book', 'defaultFontSize', 18);
  });
  it('reports and explicitly retries a failed scope save', async () => {
    vi.mocked(saveViewSettings).mockRejectedValueOnce(new Error('disk full'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'All Books' }));
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(saveViewSettings).toHaveBeenLastCalledWith(
      {},
      'book',
      'isGlobal',
      true,
      true,
      false,
      true,
    );
  });
  it('does not retain a failed custom selection after that font is deleted', async () => {
    vi.mocked(saveViewSettings).mockRejectedValueOnce(new Error('disk full'));
    const rendered = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Western Font: Times New Roman' }));
    fireEvent.click(screen.getByRole('button', { name: 'My Reading Font' }));
    await screen.findByRole('alert');
    imported.pop();
    try {
      saved.serifFont = 'Times New Roman';
      rendered.rerender(<FontPanel bookKey='book' onRegisterReset={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Western Font: Times New Roman' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      imported.push('My Reading Font');
    }
  });
  it('discards a custom-font failure that finishes after the font was deleted', async () => {
    let rejectWrite!: (error: Error) => void;
    saved.overrideFont = true;
    vi.mocked(saveViewSettings).mockImplementationOnce(async (_env, _book, key, value) => {
      Object.assign(saved, { [key]: value });
      await new Promise<void>((_resolve, reject) => {
        rejectWrite = reject;
      });
    });
    const rendered = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Western Font: Times New Roman' }));
    fireEvent.click(screen.getByRole('button', { name: 'My Reading Font' }));
    await waitFor(() => expect(saveViewSettings).toHaveBeenCalledOnce());
    imported.pop();
    try {
      saved.serifFont = 'Times New Roman';
      rendered.rerender(<FontPanel bookKey='book' onRegisterReset={vi.fn()} />);
      await act(async () => rejectWrite(new Error('disk full')));
      expect(screen.getByRole('button', { name: 'Western Font: Times New Roman' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      imported.push('My Reading Font');
    }
  });
  it('retains a newer pending selection when an earlier deleted-font task is skipped', async () => {
    let finishFirst!: () => void;
    let finishLast!: () => void;
    saved.overrideFont = true;
    vi.mocked(saveViewSettings)
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
      })
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          finishLast = resolve;
        });
      });
    const rendered = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Increase Font Size' }));
    await waitFor(() => expect(saveViewSettings).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Western Font: Times New Roman' }));
    fireEvent.click(screen.getByRole('button', { name: 'My Reading Font' }));
    fireEvent.click(screen.getByRole('button', { name: 'Western Font: My Reading Font' }));
    fireEvent.click(screen.getByRole('button', { name: 'Georgia' }));
    imported.pop();
    try {
      rendered.rerender(<FontPanel bookKey='book' onRegisterReset={vi.fn()} />);
      await act(async () => finishFirst());
      await waitFor(() => expect(saveViewSettings).toHaveBeenCalledTimes(2));
      expect(saveViewSettings).toHaveBeenLastCalledWith({}, 'book', 'serifFont', 'Georgia');
      saved.fontWeight = 500;
      rendered.rerender(<FontPanel bookKey='book' onRegisterReset={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Western Font: Georgia' })).toBeTruthy();
    } finally {
      await act(async () => finishLast?.());
      imported.push('My Reading Font');
    }
  });
});
