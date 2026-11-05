import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import ShortcutsPanel from '@/components/settings/ShortcutsPanel';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import {
  CommandPaletteProvider,
  useCommandPalette,
} from '@/components/command-palette/CommandPaletteProvider';
import { loadShortcuts } from '@/helpers/shortcuts';
import useShortcuts from '@/hooks/useShortcuts';
import '@/styles/globals.css';
import '@/styles/glossa.css';

const fixture = vi.hoisted(() => ({ closeSettings: vi.fn() }));
const zh: Record<string, string> = await (await fetch('/locales/zh-CN/translation.json')).json();
const t = (key: string, values?: Record<string, string>) =>
  (zh[key] || key).replace(/{{(\w+)}}/g, (_, name: string) => values?.[name] ?? name);

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => t }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {},
    setSettingsDialogOpen: fixture.closeSettings,
    setActiveSettingsItemId: vi.fn(),
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeMode: 'light', setThemeMode: vi.fn() }),
}));
vi.mock('@/services/environment', () => ({
  isMacPlatform: () => true,
  isTauriAppPlatform: () => false,
}));
vi.mock('@/utils/window', () => ({
  tauriHandleSetAlwaysOnTop: vi.fn(),
  tauriHandleToggleFullScreen: vi.fn(),
}));
vi.mock('@/components/AboutWindow', () => ({ setAboutDialogVisible: vi.fn() }));
vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn() }));
vi.mock('@/services/commandRegistry', () => ({
  buildCommandRegistry: () => [],
  searchCommands: () => [],
  groupResultsByCategory: () => ({}),
  trackCommandUsage: vi.fn(),
  getRecentCommands: () => [],
}));
vi.mock('@/components/Dialog', () => ({
  default: ({ id, isOpen, children }: { id: string; isOpen: boolean; children: ReactNode }) => (
    <div id={id}>{isOpen ? children : null}</div>
  ),
}));
vi.mock('@/components/Link', () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  for (const attr of ['data-theme', 'dir', 'data-eink', 'lang'])
    document.documentElement.removeAttribute(attr);
});

const row = (action: string) => {
  const element = document.querySelector(`[data-setting-id="settings.shortcuts.${action}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing shortcut row: ${action}`);
  return within(element);
};
const addLabel = (label: string) => t('Add shortcut for {{action}}', { action: t(label) });

it('records a real key combination and applies it to a mounted reader immediately', async () => {
  await page.viewport(900, 720);
  const toggle = vi.fn();
  function Reader() {
    useShortcuts({ onToggleSideBar: toggle });
    return null;
  }
  render(
    <main className='settings-content p-4'>
      <Reader />
      <ShortcutsPanel />
    </main>,
  );
  await userEvent.fill(screen.getByRole('searchbox'), t('Toggle Sidebar'));
  await userEvent.click(
    row('onToggleSideBar').getByRole('button', { name: addLabel('Toggle Sidebar') }),
  );
  expect(document.activeElement).toBe(screen.getByLabelText(t('Press a shortcut')));
  await userEvent.keyboard('{Meta>}{Shift>}Y{/Shift}{/Meta}');
  expect(loadShortcuts().onToggleSideBar.keys).toContain('cmd+shift+y');
  await userEvent.keyboard('{Meta>}{Shift>}Y{/Shift}{/Meta}');
  expect(toggle).toHaveBeenCalledTimes(1);
});

it('keeps the recorder in control of command/help shortcuts, Escape and Tab', async () => {
  await page.viewport(900, 720);
  const outerKey = vi.fn();
  function Status() {
    const { isOpen } = useCommandPalette();
    return <output data-testid='palette-state'>{String(isOpen)}</output>;
  }
  render(
    <CommandPaletteProvider>
      <main className='settings-content p-4' onKeyDown={outerKey}>
        <Status />
        <ShortcutsPanel />
        <KeyboardShortcutsHelp />
      </main>
    </CommandPaletteProvider>,
  );
  await userEvent.fill(screen.getByRole('searchbox'), t('Toggle Sidebar'));
  const add = row('onToggleSideBar').getByRole('button', { name: addLabel('Toggle Sidebar') });
  await userEvent.click(add);
  await userEvent.keyboard('{Control>}{Shift>}P{/Shift}{/Control}');
  expect(screen.getByRole('alert').textContent).toContain(t('Open Command Palette'));
  expect(screen.getByTestId('palette-state').textContent).toBe('false');
  expect(fixture.closeSettings).not.toHaveBeenCalled();
  await userEvent.keyboard('{Shift>}?{/Shift}');
  expect(screen.getByRole('alert').textContent).toContain(t('Show Keyboard Shortcuts'));
  expect(document.querySelector('#shortcuts_help')?.childElementCount).toBe(0);
  outerKey.mockClear();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByLabelText(t('Press a shortcut'))).toBeNull();
  expect(document.activeElement).toBe(add);
  expect(outerKey).not.toHaveBeenCalled();
  await userEvent.click(add);
  await userEvent.tab();
  expect(screen.queryByLabelText(t('Press a shortcut'))).toBeNull();
  expect(document.activeElement).toBe(add);
});

const layouts = [
  { theme: 'default-light', width: 900, dir: 'ltr', eink: false, name: 'light' },
  { theme: 'default-dark', width: 900, dir: 'ltr', eink: false, name: 'dark' },
  { theme: 'default-light', width: 320, dir: 'ltr', eink: false, name: 'narrow' },
  { theme: 'default-dark', width: 320, dir: 'rtl', eink: true, name: 'rtl-eink' },
] as const;

it.each(
  layouts,
)('wraps Chinese shortcut rows in $name without horizontal overflow', async (layout) => {
  await page.viewport(layout.width, 900);
  document.documentElement.setAttribute('data-theme', layout.theme);
  document.documentElement.setAttribute('data-eink', String(layout.eink));
  document.documentElement.dir = layout.dir;
  document.documentElement.lang = 'zh-CN';
  const view = render(
    <main
      className='settings-content bg-base-200 text-base-content p-4'
      style={{ height: 900, overflowY: 'auto' }}
    >
      <ShortcutsPanel />
    </main>,
  );
  expect(view.container.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  for (const element of view.container.querySelectorAll('.glossa-settings-row')) {
    const bounds = element.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth + 1);
    for (const button of element.querySelectorAll('button')) {
      const box = button.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  }
  await page.screenshot({
    element: view.container.firstElementChild!,
    path: `../../../../../../.glossa-dev/qa/shortcuts-settings-20261101/${layout.name}.png`,
  });
  await userEvent.click(
    row('onToggleSideBar').getByRole('button', { name: addLabel('Toggle Sidebar') }),
  );
  const recorder = screen.getByLabelText(t('Press a shortcut'));
  expect(recorder.getBoundingClientRect().width).toBeGreaterThan(80);
  expect(recorder.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  if (layout.eink) expect(getComputedStyle(recorder).borderTopWidth).toBe('1px');
  await userEvent.keyboard('{Escape}');
});
