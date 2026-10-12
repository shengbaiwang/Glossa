import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
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
vi.mock('@/components/settings/FontPanel', () => ({
  default: ({ bookKey }: { bookKey: string }) => (
    <div data-testid='font-scope'>{bookKey || 'defaults'}</div>
  ),
}));
vi.mock('@/components/settings/ApplicationPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/SettingsScopeControl', () => ({ default: () => null }));
vi.mock('@/components/settings/ReadingDisplayControls', () => ({ default: () => null }));
vi.mock('@/components/settings/LayoutPanel', () => ({
  default: ({ bookKey }: { bookKey: string }) => {
    const [source] = useState(bookKey);
    return <div data-testid='layout-scope'>{source || 'defaults'}</div>;
  },
}));
vi.mock('@/components/settings/ThemePanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ControlPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/LangPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/IntegrationsPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/MiscPanel', () => ({ default: () => null }));
vi.mock('@/glossa/ui/ModelSettingsPanel', () => ({ default: () => null }));
vi.mock('@/glossa/ui/PromptSettingsPanel', () => ({ default: () => null }));

const panels = [
  'Font',
  'Layout',
  'Theme',
  'Behavior',
  'Language',
  'Cloud Sync',
  'Model Services',
  'Conversation',
  'Custom Styles',
  'General',
  'Library Data',
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

it('keeps application categories in the global settings dialog', () => {
  render(<SettingsDialog bookKey='synthetic-book' />);
  for (const name of panels) {
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('dialog').classList.contains('glossa-application-settings')).toBe(true);
  }
});

it('clears book-specific panel state when switching to application defaults', () => {
  fixture.requestedPanel = 'Layout';
  const { rerender } = render(<SettingsDialog bookKey='synthetic-book' scope='reading' />);
  expect(screen.getByTestId('layout-scope').textContent).toBe('synthetic-book');
  rerender(<SettingsDialog bookKey='synthetic-book' scope='application' />);
  expect(screen.getByTestId('layout-scope').textContent).toBe('defaults');
});

it('opens restored and requested panels as application settings', () => {
  localStorage.setItem('lastConfigPanel', 'Theme');
  const view = render(<SettingsDialog bookKey='synthetic-book' />);
  expect(screen.getByRole('button', { name: 'Theme' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('dialog').classList.contains('glossa-application-settings')).toBe(true);
  view.unmount();
  fixture.requestedPanel = 'Models';
  render(<SettingsDialog bookKey='synthetic-book' />);
  expect(screen.getByRole('button', { name: 'Model Services' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('dialog').classList.contains('glossa-application-settings')).toBe(true);
});

it('retains the library settings dialog layout', () => {
  render(<SettingsDialog bookKey='' />);
  for (const name of panels) {
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('dialog').classList.contains('glossa-reader-settings')).toBe(false);
  }
});

it('limits Aa to reading appearance even when a global panel was previously selected', () => {
  localStorage.setItem('lastConfigPanel', 'Models');
  render(<SettingsDialog bookKey='synthetic-book' scope='reading' />);
  for (const name of ['Font', 'Layout', 'Theme']) {
    expect(screen.getByRole('button', { name })).toBeTruthy();
  }
  for (const name of ['Cloud Sync', 'Model Services', 'Conversation', 'Language', 'Behavior']) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
  expect(screen.getByRole('button', { name: 'Font' }).getAttribute('aria-pressed')).toBe('true');
});

it('edits defaults from global settings opened inside a book', () => {
  render(<SettingsDialog bookKey='synthetic-book' scope='application' />);
  fireEvent.click(screen.getByRole('button', { name: 'Font' }));
  expect(screen.getByTestId('font-scope').textContent).toBe('defaults');
});

it('retains the current book and allows keyboard navigation in Aa', () => {
  render(<SettingsDialog bookKey='synthetic-book' scope='reading' />);
  expect(screen.getByTestId('font-scope').textContent).toBe('synthetic-book');
  const font = screen.getByRole('button', { name: 'Font' });
  fireEvent.keyDown(font, { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: 'Layout' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Layout' }));
});
