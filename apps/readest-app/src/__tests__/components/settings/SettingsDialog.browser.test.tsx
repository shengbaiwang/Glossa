import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import SettingsDialog from '@/components/settings/SettingsDialog';

const fixture = vi.hoisted(() => ({
  setFontPanelView: vi.fn(),
  setSettingsDialogOpen: vi.fn(),
  setActiveSettingsItemId: vi.fn(),
  setRequestedPanel: vi.fn(),
  requestedPanel: null as string | null,
  fontPanelView: 'main-fonts',
  settingsDialogScope: 'application',
  settings: {
    globalReadSettings: {},
    globalViewSettings: {
      serifFont: 'Times New Roman',
      sansSerifFont: 'Arial',
      monospaceFont: 'Courier New',
      defaultFont: 'Serif',
      defaultCJKFont: 'SimSun',
      defaultFontSize: 18,
      fontWeight: 400,
      minimumFontSize: 8,
      overrideFont: true,
      isGlobal: false,
    },
    i18nLang: 'zh-CN',
    pinCodeEnabled: false,
  },
  envConfig: {},
  appService: { isMobile: false, hasWindow: true, isAndroidApp: false, isMacOSApp: true },
  save: vi.fn(),
}));
const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
const t = (key: string) => zh[key] || key;
// Synthetic preferences replace every disk, account, font and native boundary.
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: fixture.envConfig, appService: fixture.appService }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: () => ({ setLibrary: vi.fn() }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => t }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/utils/rtl', () => ({
  getDirFromUILanguage: () => (document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'),
}));
vi.mock('@/services/environment', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getCommandPaletteShortcut: () => '⌘K',
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
}));
vi.mock('@/components/command-palette', () => ({ useCommandPalette: () => ({ open: vi.fn() }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => fixture }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ safeAreaInsets: {} }) }));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ language: { canonical: 'zh-CN', isCJK: true, direction: 'ltr' } }),
    getViewSettings: () => fixture.settings.globalViewSettings,
    setViewSettings: vi.fn(),
  }),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: fixture.save, saveSysSettings: vi.fn() }));
vi.mock('@/utils/bridge', () => ({
  getSysFontsList: async () => ({ fonts: { 'Synthetic System Font': 'Synthetic System Font' } }),
  selectDirectory: vi.fn(),
}));
vi.mock('@/services/biometric', () => ({
  isBiometricSupported: () => false,
  getBiometricStatus: vi.fn(),
  getBiometryLabelKey: vi.fn(),
}));
vi.mock('@/components/AboutWindow', () => ({ setAboutDialogVisible: vi.fn() }));
vi.mock('@/app/library/components/BackupWindow', () => ({ setBackupDialogVisible: vi.fn() }));
vi.mock('@/app/library/components/CacheManagerWindow', () => ({
  setCacheManagerDialogVisible: vi.fn(),
}));
vi.mock('@/app/library/components/MigrateDataWindow', () => ({
  setMigrateDataDirDialogVisible: vi.fn(),
}));
vi.mock('@/utils/misc', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getOSPlatform: () => 'macos',
  getLocale: () => 'zh-CN',
  getUserLang: () => 'zh-CN',
  isCJKEnv: () => true,
  isCaselessUILang: () => true,
}));
vi.mock('@/hooks/useResetSettings', () => ({ useResetViewSettings: () => vi.fn() }));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ fonts: [], getFontFamilies: () => [] }),
}));
vi.mock('@/components/settings/CustomFonts', () => ({ default: () => null }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/settings/DialogMenu', () => ({ default: () => null }));
vi.mock('@/components/settings/ReadingDisplayControls', () => ({ default: () => null }));
vi.mock('@/components/settings/LayoutPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ThemePanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ControlPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LangPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/IntegrationsPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/MiscPanel', () => ({ default: () => null }));
vi.mock('@/glossa/ui/ModelSettingsPanel', () => ({ default: () => null }));
vi.mock('@/glossa/ui/PromptSettingsPanel', () => ({ default: () => null }));

const boundsOK = (sheet: Element) => {
  expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  fixture.requestedPanel = null;
  vi.clearAllMocks();
  for (const attr of ['dir', 'data-eink', 'data-theme', 'lang'])
    document.documentElement.removeAttribute(attr);
});
it('keeps Aa limited to three tabs with scope visible in light, dark, narrow and RTL/e-ink', async () => {
  await page.viewport(1440, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const view = render(<SettingsDialog bookKey='synthetic-book' scope='reading' />);
  const sheet = view.container.querySelector('.modal-box')!;
  expect(sheet.getBoundingClientRect().width).toBe(440);
  expect(sheet.getBoundingClientRect().right).toBe(1420);
  expect(sheet.getBoundingClientRect().top).toBe(64);
  expect(screen.queryByRole('button', { name: t('Cloud Sync') })).toBeNull();
  expect(
    screen.getByRole('radio', { name: t('This Book Only') }).getAttribute('aria-checked'),
  ).toBe('true');
  boundsOK(sheet);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/menu-reading-light.png' });
  const font = screen.getByRole('button', { name: t('Font') });
  fireEvent.keyDown(font, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: t('Layout') }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.click(font);
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/menu-reading-dark.png' });
  document.documentElement.dir = 'rtl';
  document.documentElement.setAttribute('data-eink', 'true');
  expect(sheet.getBoundingClientRect().left).toBe(20);
  boundsOK(sheet);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/menu-reading-rtl-eink.png' });
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('data-eink');
  await page.viewport(390, 844);
  expect(sheet.getBoundingClientRect().width).toBeLessThanOrEqual(390);
  boundsOK(sheet);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/menu-reading-narrow.png' });
});
it('shows readable global categories and switches to a grouped selector on narrow screens', async () => {
  await page.viewport(1440, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const view = render(<SettingsDialog bookKey='synthetic-book' scope='application' />);
  const sheet = view.container.querySelector('.modal-box')!;
  expect(sheet.getBoundingClientRect().width).toBe(760);
  expect(screen.getByRole('button', { name: t('General') }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByText(t('Application'))).toBeTruthy();
  expect(screen.getByText(t('Reading Defaults'))).toBeTruthy();
  expect(screen.queryByRole('radiogroup')).toBeNull();
  boundsOK(sheet);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/menu-application-light.png' });
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/menu-application-dark.png' });
  fireEvent.click(screen.getByRole('button', { name: t('Font') }));
  await waitFor(() => expect(screen.getByText('微雨从东来，好风与之俱')).toBeTruthy());
  await page.viewport(390, 844);
  const category = screen.getByRole('combobox', { name: t('Settings Panels') });
  fireEvent.change(category, { target: { value: 'General' } });
  expect(screen.getByText(t('App Lock'))).toBeTruthy();
  boundsOK(sheet);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/menu-application-narrow.png' });
});
