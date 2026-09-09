import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
vi.mock('@/components/Dialog', () => ({
  default: ({
    className,
    header,
    children,
  }: {
    className: string;
    header: ReactNode;
    children: ReactNode;
  }) => (
    <div role='dialog' className={className}>
      {header}
      {children}
    </div>
  ),
}));
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
  'Custom',
];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  fixture.requestedPanel = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('keeps every reader settings tab in the same side sheet', () => {
  render(<SettingsDialog bookKey='synthetic-book' />);
  for (const name of panels) {
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('dialog').classList.contains('glossa-reader-settings')).toBe(true);
  }
});

it('opens restored and requested non-font panels in the reader side sheet', () => {
  localStorage.setItem('lastConfigPanel', 'Theme');
  const view = render(<SettingsDialog bookKey='synthetic-book' />);
  expect(screen.getByRole('button', { name: 'Theme' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('dialog').classList.contains('glossa-reader-settings')).toBe(true);
  view.unmount();
  fixture.requestedPanel = 'Models';
  render(<SettingsDialog bookKey='synthetic-book' />);
  expect(screen.getByRole('button', { name: 'Model Services' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('dialog').classList.contains('glossa-reader-settings')).toBe(true);
});

it('retains the library settings dialog layout', () => {
  render(<SettingsDialog bookKey='' />);
  for (const name of panels) {
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('dialog').classList.contains('glossa-reader-settings')).toBe(false);
  }
});
