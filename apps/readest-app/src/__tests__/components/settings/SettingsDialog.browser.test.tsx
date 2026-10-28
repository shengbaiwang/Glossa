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
vi.mock('@/utils/rtl', async (original) => ({
  ...(await original<typeof import('@/utils/rtl')>()),
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
vi.mock('@/helpers/settings', async (original) => ({
  ...(await original<typeof import('@/helpers/settings')>()),
  saveViewSettings: fixture.save,
  saveSysSettings: vi.fn(),
}));
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
  expect(screen.getByText(t('This Book Only'))).toBeTruthy();
  expect(screen.getByRole('button', { name: t('Set as Reading Defaults') })).toBeTruthy();
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
  expect(
    screen
      .getAllByRole('button')
      .filter((button) => button.matches('.glossa-settings-navigation button'))
      .map((button) => button.textContent),
  ).toEqual(['Account', 'General', 'Reading', 'Library & Sync', 'Plugins', 'About'].map(t));
  expect(screen.queryByRole('radiogroup')).toBeNull();
  const startup = screen
    .getByRole('button', { name: t('Startup & Window') })
    .getBoundingClientRect();
  const language = screen.getByRole('button', { name: t('Language') }).getBoundingClientRect();
  expect(startup.right).toBeLessThanOrEqual(language.left);
  fireEvent.click(screen.getByRole('button', { name: t('Account') }));
  expect(screen.getByRole('button', { name: t('Sign In') })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('Library & Sync') }));
  fireEvent.click(screen.getByRole('button', { name: t('Cloud Sync') }));
  expect(screen.queryByRole('button', { name: t('Sign In') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('General') }));
  boundsOK(sheet);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/menu-application-light.png' });
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/menu-application-dark.png' });
  fireEvent.click(screen.getByRole('button', { name: t('Reading') }));
  await waitFor(() => expect(screen.getByText('微雨从东来，好风与之俱')).toBeTruthy());
  await page.viewport(390, 844);
  const category = screen.getByRole('combobox', { name: t('Settings Panels') });
  fireEvent.change(category, { target: { value: 'General' } });
  expect(screen.getByText(t('App Lock'))).toBeTruthy();
  boundsOK(sheet);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/menu-application-narrow.png' });
});

it('moves, resizes, constrains and restores the desktop settings window', async () => {
  await page.viewport(1440, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const view = render(<SettingsDialog bookKey='' scope='application' />);
  const sheet = view.container.querySelector('.modal-box')!;
  const initial = sheet.getBoundingClientRect();
  const heading = view.container.querySelector('[data-settings-drag-handle]')!;
  expect(heading).not.toBeNull();
  const drag = (target: Element, from: { x: number; y: number }, to: { x: number; y: number }) => {
    fireEvent.mouseDown(target, { button: 0, clientX: from.x, clientY: from.y });
    fireEvent.mouseMove(window, { clientX: to.x, clientY: to.y });
    fireEvent.mouseUp(window, { clientX: to.x, clientY: to.y });
  };
  drag(
    heading,
    { x: initial.left + 180, y: initial.top + 20 },
    { x: initial.left + 260, y: initial.top + 60 },
  );
  const moved = sheet.getBoundingClientRect();
  expect(moved.left).toBeCloseTo(initial.left + 80);
  expect(moved.top).toBeCloseTo(initial.top + 40);
  const southeast = view.container.querySelector('[data-resize-direction="se"]')!;
  drag(
    southeast,
    { x: moved.right - 2, y: moved.bottom - 2 },
    { x: moved.right + 58, y: moved.bottom + 38 },
  );
  const resized = sheet.getBoundingClientRect();
  expect(resized.width).toBeCloseTo(moved.width + 60);
  expect(resized.height).toBeCloseTo(moved.height + 40);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/settings-window-resized.png' });
  view.unmount();
  const restoredView = render(<SettingsDialog bookKey='' scope='application' />);
  const restoredSheet = restoredView.container.querySelector('.modal-box')!;
  const restored = restoredSheet.getBoundingClientRect();
  expect(restored.left).toBeCloseTo(resized.left);
  expect(restored.top).toBeCloseTo(resized.top);
  expect(restored.width).toBeCloseTo(resized.width);
  expect(restored.height).toBeCloseTo(resized.height);
  const beforeNorthwest = restoredSheet.getBoundingClientRect();
  const northwest = restoredView.container.querySelector('[data-resize-direction="nw"]')!;
  const northwestStart = { x: beforeNorthwest.left + 2, y: Math.ceil(beforeNorthwest.top) + 2 };
  drag(northwest, northwestStart, { x: northwestStart.x - 40, y: northwestStart.y - 20 });
  const northwestResized = restoredSheet.getBoundingClientRect();
  expect(northwestResized.left).toBeCloseTo(beforeNorthwest.left - 40);
  expect(northwestResized.top).toBeCloseTo(beforeNorthwest.top - 20);
  expect(northwestResized.right).toBeCloseTo(beforeNorthwest.right);
  expect(northwestResized.bottom).toBeCloseTo(beforeNorthwest.bottom);
  const restoredSoutheast = restoredView.container.querySelector('[data-resize-direction="se"]')!;
  drag(
    restoredSoutheast,
    { x: restored.right - 2, y: restored.bottom - 2 },
    { x: restored.right - 2000, y: restored.bottom - 2000 },
  );
  expect(restoredSheet.getBoundingClientRect().width).toBe(640);
  expect(restoredSheet.getBoundingClientRect().height).toBe(420);
  const beforeControl = restoredSheet.getBoundingClientRect();
  const close = screen.getByRole('button', { name: t('Close') });
  drag(
    close,
    { x: beforeControl.right - 20, y: beforeControl.top + 20 },
    { x: beforeControl.right + 200, y: beforeControl.top + 120 },
  );
  expect(restoredSheet.getBoundingClientRect().left).toBeCloseTo(beforeControl.left);
  expect(restoredSheet.getBoundingClientRect().top).toBeCloseTo(beforeControl.top);
  const restoredHeading = restoredView.container.querySelector('[data-settings-drag-handle]')!;
  drag(
    restoredHeading,
    { x: beforeControl.left + 180, y: beforeControl.top + 20 },
    { x: beforeControl.left + 2200, y: beforeControl.top - 2000 },
  );
  const constrained = restoredSheet.getBoundingClientRect();
  expect(constrained.left).toBeGreaterThanOrEqual(16);
  expect(constrained.top).toBe(16);
  expect(constrained.right).toBeLessThanOrEqual(window.innerWidth - 16);
  await page.viewport(900, 640);
  await waitFor(() => expect(restoredSheet.getBoundingClientRect().right).toBeLessThanOrEqual(884));
  expect(restoredSheet.getBoundingClientRect().bottom).toBeLessThanOrEqual(624);
  await page.viewport(390, 844);
  await waitFor(() => expect(restoredSheet.getBoundingClientRect().width).toBeLessThanOrEqual(390));
  expect(
    getComputedStyle(restoredView.container.querySelector('[data-resize-direction="se"]')!).display,
  ).toBe('none');
  boundsOK(restoredSheet);
});

it('gives plugins a dedicated category in wide, narrow, dark and RTL/e-ink settings', async () => {
  await page.viewport(1440, 900);
  document.documentElement.setAttribute('data-theme', 'default-light');
  const view = render(<SettingsDialog bookKey='synthetic-book' scope='application' />);
  const sheet = view.container.querySelector('.modal-box')!;
  expect(screen.queryByRole('checkbox', { name: t('Mind map') })).toBeNull();
  const plugins = screen.getByRole('button', { name: t('Plugins') });
  fireEvent.click(plugins);
  expect(plugins.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(t('Built-in plugins'))).toBeTruthy();
  expect(screen.getByText(t('Third-party plugins'))).toBeTruthy();
  expect(screen.getByText(t('Installation is not available yet.'))).toBeTruthy();
  const builtInCard = screen
    .getByRole('checkbox', { name: t('Mind map') })
    .closest('.glossa-plugin-grid')!;
  expect(
    screen.getByText(t('Third-party plugins')).getBoundingClientRect().top -
      builtInCard.getBoundingClientRect().bottom,
  ).toBeGreaterThanOrEqual(24);
  for (const label of ['Conversation', 'Mind map', 'PDF automatic contents']) {
    expect((screen.getByRole('checkbox', { name: t(label) }) as HTMLInputElement).checked).toBe(
      true,
    );
  }
  boundsOK(sheet);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/plugin-menu-light.png' });
  fireEvent.keyDown(plugins, { key: 'ArrowDown' });
  expect(screen.queryByText(t('Built-in plugins'))).toBeNull();
  fireEvent.keyDown(screen.getByRole('button', { name: t('About') }), { key: 'ArrowUp' });
  expect(screen.getByText(t('Built-in plugins'))).toBeTruthy();
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/plugin-menu-dark.png' });
  await page.viewport(390, 844);
  const category = screen.getByRole('combobox', { name: t('Settings Panels') });
  expect((category as HTMLSelectElement).value).toBe('Plugins');
  fireEvent.change(category, { target: { value: 'General' } });
  expect(screen.queryByRole('checkbox', { name: t('Mind map') })).toBeNull();
  fireEvent.change(category, { target: { value: 'Plugins' } });
  boundsOK(sheet);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/plugin-menu-narrow-dark.png' });
  document.documentElement.dir = 'rtl';
  document.documentElement.setAttribute('data-eink', 'true');
  boundsOK(sheet);
  await page.screenshot({
    path: '../../../../../../.glossa-dev/qa/plugin-menu-narrow-rtl-eink.png',
  });
});
