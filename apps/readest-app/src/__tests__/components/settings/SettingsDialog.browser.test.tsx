import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/utils/rtl', () => ({ getDirFromUILanguage: () => 'ltr' }));
vi.mock('@/services/environment', () => ({ getCommandPaletteShortcut: () => '⌘K' }));
vi.mock('@/components/command-palette', () => ({ useCommandPalette: () => ({ open: vi.fn() }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => fixture }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ safeAreaInsets: {} }) }));
vi.mock('@/store/deviceStore', () => ({ useDeviceControlStore: () => ({}) }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/settings/DialogMenu', () => ({ default: () => null }));
vi.mock('@/components/settings/FontPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LayoutPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ThemePanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ControlPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LangPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/IntegrationsPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/MiscPanel', () => ({ default: () => null }));
vi.mock('@/glossa/ui/ModelSettingsPanel', () => ({ default: () => null }));

const panels = [
  'Font',
  'Layout',
  'Theme',
  'Behavior',
  'Language',
  'Cloud Sync',
  'Model Services',
  'Conversation',
  'Custom',
];
afterEach(() => {
  cleanup();
  localStorage.clear();
  fixture.requestedPanel = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('keeps every tab at the same desktop edge and supports RTL and narrow screens', async () => {
  await page.viewport(1440, 900);
  document.documentElement.setAttribute('data-theme', 'default-dark');
  const view = render(<SettingsDialog bookKey='synthetic-book' />);
  const sheet = view.container.querySelector('.modal-box')!;
  for (const name of panels) {
    fireEvent.click(screen.getByRole('button', { name }));
    const bounds = sheet.getBoundingClientRect();
    expect(bounds.width).toBe(440);
    expect(bounds.right).toBe(1420);
    expect(bounds.top).toBe(64);
    expect(bounds.height).toBe(812);
    expect(getComputedStyle(view.container.querySelector('.dialog-overlay')!).backgroundColor).toBe(
      'rgba(0, 0, 0, 0)',
    );
  }
  fireEvent.click(screen.getByRole('button', { name: 'Conversation' }));
  await screen.findByRole('button', { name: 'New prompt' });
  await page.screenshot({
    path: '../../../../../../.glossa-dev/qa/settings-conversation-prompts.png',
  });
  document.documentElement.dir = 'rtl';
  document.documentElement.setAttribute('data-eink', 'true');
  expect(sheet.getBoundingClientRect().left).toBe(20);
  expect(sheet.getBoundingClientRect().width).toBe(440);
  await page.viewport(390, 844);
  expect(sheet.getBoundingClientRect().width).toBeLessThanOrEqual(390);
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
});
