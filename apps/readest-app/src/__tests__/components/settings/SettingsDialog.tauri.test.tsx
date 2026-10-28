import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import SettingsDialog from '@/components/settings/SettingsDialog';

const fixture = vi.hoisted(() => ({
  setFontPanelView: vi.fn(),
  setSettingsDialogOpen: vi.fn(),
  setActiveSettingsItemId: vi.fn(),
  setRequestedPanel: vi.fn(),
  requestedPanel: null as string | null,
  activeSettingsItemId: null as string | null,
  settingsDialogScope: 'application',
  settings: { pinCodeEnabled: false },
  envConfig: {},
  appService: { isMobile: false, hasWindow: true, isMacOSApp: true },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: fixture.envConfig, appService: fixture.appService }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/utils/rtl', () => ({ getDirFromUILanguage: () => 'ltr' }));
vi.mock('@/services/environment', () => ({
  getCommandPaletteShortcut: () => '⌘K',
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
}));
vi.mock('@/components/command-palette', () => ({ useCommandPalette: () => ({ open: vi.fn() }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => fixture }));
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: () => ({ setLibrary: vi.fn() }) }));
vi.mock('@/store/appLockStore', () => ({ useAppLockStore: () => ({ openDialog: vi.fn() }) }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ safeAreaInsets: {} }) }));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn(), saveViewSettings: vi.fn() }));
vi.mock('@/utils/bridge', () => ({ selectDirectory: vi.fn() }));
vi.mock('@/utils/window', () => ({
  tauriHandleSetAlwaysOnTop: vi.fn(),
  tauriHandleToggleFullScreen: vi.fn(),
}));
vi.mock('@/utils/permission', () => ({ requestStoragePermission: vi.fn() }));
vi.mock('@/utils/nav', () => ({ navigateToLogin: vi.fn(), navigateToProfile: vi.fn() }));
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
vi.mock('@/components/settings/FolderImportSettings', () => ({ default: () => null }));
vi.mock('@/components/settings/DuplicateBooksPanel', () => ({ default: () => null }));
vi.mock('@/components/LegacyBookCaches', () => ({ default: () => null }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/settings/DialogMenu', () => ({ default: () => null }));
vi.mock('@/components/settings/PluginsPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/SettingsScopeControl', () => ({ default: () => null }));
vi.mock('@/components/settings/ReadingDisplayControls', () => ({ default: () => null }));
vi.mock('@/components/settings/FontPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LayoutPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ThemePanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ControlPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LangPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/IntegrationsPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/MiscPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/SpeechPanel', () => ({ default: () => null }));
vi.mock('@/components/AboutContent', () => ({ default: () => null }));

beforeAll(async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
  const frame = window.frameElement as HTMLElement | null;
  if (frame) {
    frame.style.width = `${window.top?.innerWidth ?? 1280}px`;
    frame.style.height = `${window.top?.innerHeight ?? 800}px`;
    window.dispatchEvent(new Event('resize'));
  }
  expect(window.innerWidth).toBeGreaterThanOrEqual(800);
  expect(window.innerHeight).toBeGreaterThanOrEqual(640);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  fixture.requestedPanel = null;
  fixture.activeSettingsItemId = null;
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

const drag = (target: Element, from: { x: number; y: number }, to: { x: number; y: number }) => {
  fireEvent.mouseDown(target, { button: 0, clientX: from.x, clientY: from.y });
  fireEvent.mouseMove(window, { clientX: to.x, clientY: to.y });
  fireEvent.mouseUp(window, { clientX: to.x, clientY: to.y });
};

it('separates account from cloud sync in the native settings window', () => {
  document.documentElement.setAttribute('data-theme', 'default-light');
  render(<SettingsDialog bookKey='' scope='application' />);
  const navigation = screen.getByRole('navigation', { name: 'Settings Panels' });
  expect(
    within(navigation)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Account', 'General', 'Reading', 'Library & Sync', 'Plugins', 'About']);
  fireEvent.click(within(navigation).getByRole('button', { name: 'Account' }));
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
  fireEvent.click(within(navigation).getByRole('button', { name: 'Library & Sync' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cloud Sync' }));
  expect(screen.queryByRole('button', { name: 'Sign In' })).toBeNull();
});

it('moves, resizes and restores the native settings window', () => {
  document.documentElement.setAttribute('data-theme', 'default-light');
  const view = render(<SettingsDialog bookKey='' scope='application' />);
  const sheet = view.container.querySelector('.modal-box')!;
  const initial = sheet.getBoundingClientRect();
  const heading = view.container.querySelector('[data-settings-drag-handle]')!;
  drag(
    heading,
    { x: initial.left + 180, y: initial.top + 20 },
    { x: initial.left + 260, y: initial.top + 60 },
  );
  const moved = sheet.getBoundingClientRect();
  expect(moved.left).toBeCloseTo(initial.left + 80);
  expect(moved.top).toBeCloseTo(initial.top + 40);
  drag(
    view.container.querySelector('[data-resize-direction="se"]')!,
    { x: moved.right - 2, y: moved.bottom - 2 },
    { x: moved.right + 58, y: moved.bottom + 38 },
  );
  const resized = sheet.getBoundingClientRect();
  expect(resized.width).toBeCloseTo(moved.width + 60);
  expect(resized.height).toBeCloseTo(moved.height + 40);
  view.unmount();
  const restoredView = render(<SettingsDialog bookKey='' scope='application' />);
  const restoredSheet = restoredView.container.querySelector('.modal-box')!;
  const restored = restoredSheet.getBoundingClientRect();
  expect(restored.left).toBeCloseTo(resized.left);
  expect(restored.top).toBeCloseTo(resized.top);
  expect(restored.width).toBeCloseTo(resized.width);
  expect(restored.height).toBeCloseTo(resized.height);
  const beforeNorthwest = restoredSheet.getBoundingClientRect();
  const northwestStart = { x: beforeNorthwest.left + 2, y: Math.ceil(beforeNorthwest.top) + 2 };
  drag(restoredView.container.querySelector('[data-resize-direction="nw"]')!, northwestStart, {
    x: northwestStart.x - 40,
    y: northwestStart.y - 20,
  });
  const northwestResized = restoredSheet.getBoundingClientRect();
  expect(northwestResized.left).toBeCloseTo(beforeNorthwest.left - 40);
  expect(northwestResized.top).toBeCloseTo(beforeNorthwest.top - 20);
  expect(northwestResized.right).toBeCloseTo(beforeNorthwest.right);
  expect(northwestResized.bottom).toBeCloseTo(beforeNorthwest.bottom);
  drag(
    restoredView.container.querySelector('[data-resize-direction="se"]')!,
    { x: northwestResized.right - 2, y: northwestResized.bottom - 2 },
    { x: northwestResized.right - 2000, y: northwestResized.bottom - 2000 },
  );
  expect(restoredSheet.getBoundingClientRect().width).toBe(640);
  expect(restoredSheet.getBoundingClientRect().height).toBe(420);
  const beforeMove = restoredSheet.getBoundingClientRect();
  drag(
    restoredView.container.querySelector('[data-settings-drag-handle]')!,
    { x: beforeMove.left + 180, y: beforeMove.top + 20 },
    { x: beforeMove.left + 2200, y: beforeMove.top - 2000 },
  );
  const constrained = restoredSheet.getBoundingClientRect();
  expect(constrained.left).toBeGreaterThanOrEqual(16);
  expect(constrained.top).toBe(16);
  expect(constrained.right).toBeLessThanOrEqual(window.innerWidth - 16);
});
