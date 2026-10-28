import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettingsDialog from '@/components/settings/SettingsDialog';

const fixture = vi.hoisted(() => ({
  setFontPanelView: vi.fn(),
  setSettingsDialogOpen: vi.fn(),
  setActiveSettingsItemId: vi.fn(),
  setRequestedPanel: vi.fn(),
  settings: { officialModules: {} as { conversation?: boolean; mindmap?: boolean } },
  requestedPanel: null as string | null,
  activeSettingsItemId: null as string | null,
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
vi.mock('@/components/settings/ApplicationPanel', () => ({
  default: ({ section }: { section: string }) => (
    <div data-testid='application-panel'>{section}</div>
  ),
}));
vi.mock('@/components/settings/PluginsPanel', () => ({
  default: ({ initialSettings }: { initialSettings?: string }) => (
    <p>Plugin controls {initialSettings}</p>
  ),
}));
vi.mock('@/components/settings/SettingsScopeControl', () => ({ default: () => null }));
vi.mock('@/components/settings/ReadingDisplayControls', () => ({ default: () => null }));
vi.mock('@/components/settings/LayoutPanel', () => ({
  default: ({ bookKey }: { bookKey: string }) => {
    const [source] = useState(bookKey);
    return <div data-testid='layout-scope'>{source || 'defaults'}</div>;
  },
}));
vi.mock('@/components/settings/ThemePanel', () => ({ default: () => null }));
vi.mock('@/components/settings/ControlPanel', () => ({
  default: () => (
    <details>
      <summary>More reading controls</summary>
      <div data-setting-id='settings.control.allowJavascript'>JavaScript target</div>
    </details>
  ),
}));
vi.mock('@/components/settings/LangPanel', () => ({ default: () => null }));
vi.mock('@/components/settings/IntegrationsPanel', () => ({
  default: () => <div>Cloud sync providers</div>,
}));
vi.mock('@/components/settings/SpeechPanel', () => ({ default: () => <p>Speech preferences</p> }));
vi.mock('@/components/AboutContent', () => ({ default: () => <p>Version and licenses</p> }));
vi.mock('@/components/settings/MiscPanel', () => ({ default: () => null }));
vi.mock('@/glossa/ui/ModelSettingsPanel', () => ({ default: () => null }));
vi.mock('@/glossa/ui/PromptSettingsPanel', () => ({ default: () => null }));

const panels = ['Account', 'General', 'Reading', 'Library & Sync', 'Plugins', 'About'];
beforeEach(() => {
  fixture.settings.officialModules = {};
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
  fixture.activeSettingsItemId = null;
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

it('offers six application categories with reading controls nested inside Reading', () => {
  render(<SettingsDialog bookKey='' />);
  const navigation = screen.getByRole('navigation', { name: 'Settings Panels' });
  expect(
    within(navigation)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['Account', 'General', 'Reading', 'Library & Sync', 'Plugins', 'About']);
  expect(screen.queryByRole('button', { name: 'Font' })).toBeNull();
  fireEvent.click(within(navigation).getByRole('button', { name: 'Reading' }));
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }));
  expect(screen.getByTestId('layout-scope').textContent).toBe('defaults');
  expect(
    within(navigation).getByRole('button', { name: 'Reading' }).getAttribute('aria-pressed'),
  ).toBe('true');
});

it('separates account identity from cloud sync settings', () => {
  render(<SettingsDialog bookKey='' />);
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  expect(screen.getByTestId('application-panel').textContent).toBe('Account');
  expect(screen.queryByText('Cloud sync providers')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Library & Sync' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cloud Sync' }));
  expect(screen.getByText('Cloud sync providers')).toBeTruthy();
  expect(screen.queryByTestId('application-panel')).toBeNull();
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
  expect(screen.getByRole('button', { name: 'App Appearance' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('dialog').classList.contains('glossa-application-settings')).toBe(true);
  view.unmount();
  fixture.requestedPanel = 'Models';
  render(<SettingsDialog bookKey='synthetic-book' />);
  expect(screen.getByRole('button', { name: 'Plugins' }).getAttribute('aria-pressed')).toBe('true');
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
  for (const name of [
    'Plugins',
    'Cloud Sync',
    'Model Services',
    'Conversation',
    'Language',
    'Reading Controls',
  ]) {
    expect(screen.queryByRole('button', { name })).toBeNull();
  }
  expect(screen.getByRole('button', { name: 'Font' }).getAttribute('aria-pressed')).toBe('true');
});

it('edits defaults from global settings opened inside a book', () => {
  render(<SettingsDialog bookKey='synthetic-book' scope='application' />);
  fireEvent.click(screen.getByRole('button', { name: 'Reading' }));
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

it('opens collapsed ancestors before revealing a searched reading control', async () => {
  fixture.requestedPanel = 'Control';
  fixture.activeSettingsItemId = 'settings.control.allowJavascript';
  const scroll = vi.fn();
  const originalScroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    const { container } = render(<SettingsDialog bookKey='' />);
    await waitFor(() => expect(container.querySelector('details')?.open).toBe(true));
    expect(scroll).toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.scrollIntoView = originalScroll;
  }
});

it('routes old plugin settings shortcuts into Plugins even while disabled', () => {
  fixture.requestedPanel = 'Conversation';
  fixture.settings.officialModules = { conversation: false, mindmap: false };
  const view = render(<SettingsDialog bookKey='' />);
  expect(screen.getByRole('button', { name: 'Plugins' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Plugin controls conversation')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Conversation' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Model Services' })).toBeNull();
  fixture.requestedPanel = 'Models';
  view.rerender(<SettingsDialog bookKey='' />);
  expect(screen.getByText('Plugin controls models')).toBeTruthy();
  view.unmount();
  fixture.requestedPanel = null;
  localStorage.setItem('lastApplicationSettingsPanel', 'Models');
  render(<SettingsDialog bookKey='' />);
  expect(screen.getByRole('button', { name: 'Plugins' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Plugin controls models')).toBeTruthy();
});

it('reveals nested PDF import settings when searched', () => {
  fixture.activeSettingsItemId = 'settings.plugins.pdfContentsOnImport';
  render(<SettingsDialog bookKey='' />);
  expect(screen.getByRole('button', { name: 'Plugins' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Plugin controls pdfAutoContents')).toBeTruthy();
});

it('provides a dedicated Plugins menu and restores it on the next open', () => {
  const view = render(<SettingsDialog bookKey='' />);
  fireEvent.click(screen.getByRole('button', { name: 'Plugins' }));
  expect(screen.getByText('Plugin controls')).toBeTruthy();
  expect(localStorage.getItem('lastApplicationSettingsPanel')).toBe('Plugins');
  view.unmount();
  render(<SettingsDialog bookKey='' />);
  expect(screen.getByRole('button', { name: 'Plugins' }).getAttribute('aria-pressed')).toBe('true');
});
it.each([
  'settings.plugins.pdfAutoContents',
  'settings.general.module.pdfAutoContents',
])('routes plugin search targets to the dedicated menu: %s', (id) => {
  fixture.activeSettingsItemId = id;
  render(<SettingsDialog bookKey='' />);
  expect(screen.getByRole('button', { name: 'Plugins' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Plugin controls')).toBeTruthy();
});
