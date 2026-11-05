import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import {
  CommandPaletteProvider,
  useCommandPalette,
} from '@/components/command-palette/CommandPaletteProvider';
import useShortcuts from '@/hooks/useShortcuts';
import { loadShortcuts, saveShortcuts } from '@/helpers/shortcuts';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {},
    setSettingsDialogOpen: vi.fn(),
    setActiveSettingsItemId: vi.fn(),
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeMode: 'light', setThemeMode: vi.fn() }),
}));
vi.mock('@/services/environment', () => ({
  isMacPlatform: () => false,
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
  default: ({
    id,
    isOpen,
    children,
  }: {
    id: string;
    isOpen: boolean;
    children: React.ReactNode;
  }) => <div id={id}>{isOpen ? children : null}</div>,
}));
vi.mock('@/components/Link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  cleanup();
  localStorage.removeItem('customShortcuts');
  vi.unstubAllGlobals();
});

it('updates mounted shortcut handlers on save and storage events', () => {
  const turnPage = vi.fn();
  function Fixture() {
    useShortcuts({ onGoRight: turnPage });
    return null;
  }
  render(<Fixture />);
  const config = loadShortcuts();
  act(() => saveShortcuts({ ...config, onGoRight: { ...config.onGoRight, keys: ['x'] } }));
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(turnPage).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'x' });
  expect(turnPage).toHaveBeenCalledTimes(1);
  localStorage.setItem('customShortcuts', JSON.stringify({ onGoRight: ['z'] }));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'customShortcuts' })));
  fireEvent.keyDown(window, { key: 'z' });
  expect(turnPage).toHaveBeenCalledTimes(2);
});

it('honors the configured help key and refreshes the displayed bindings', () => {
  const config = loadShortcuts();
  saveShortcuts({
    ...config,
    onOpenShortcutsHelp: { ...config.onOpenShortcutsHelp, keys: ['F8'] },
  });
  function Fixture() {
    useShortcuts({
      onOpenShortcutsHelp: () => {
        document
          .getElementById('shortcuts_help')
          ?.dispatchEvent(new CustomEvent('setDialogVisibility', { detail: { visible: true } }));
      },
    });
    return (
      <>
        <input data-shortcut-recorder='true' readOnly />
        <KeyboardShortcutsHelp />
      </>
    );
  }
  render(<Fixture />);
  fireEvent.keyDown(window, { key: '?', shiftKey: true });
  expect(screen.queryByText('Show Keyboard Shortcuts')).toBeNull();
  screen.getByRole('textbox').focus();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'F8' });
  expect(screen.queryByText('Show Keyboard Shortcuts')).toBeNull();
  screen.getByRole('textbox').blur();
  fireEvent.keyDown(window, { key: 'F8' });
  expect(screen.getByText('Show Keyboard Shortcuts')).toBeTruthy();
  act(() =>
    saveShortcuts({ ...loadShortcuts(), onGoRight: { ...config.onGoRight, keys: ['F9'] } }),
  );
  expect(screen.getByText('F9')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'F8' });
  expect(screen.queryByText('Show Keyboard Shortcuts')).toBeNull();
});

it('lets the recorder own the command-palette key and honors a changed binding', () => {
  function Status() {
    const { isOpen } = useCommandPalette();
    return (
      <>
        <span>{isOpen ? 'open' : 'closed'}</span>
        <input data-shortcut-recorder='true' readOnly />
      </>
    );
  }
  render(
    <CommandPaletteProvider>
      <Status />
    </CommandPaletteProvider>,
  );
  const config = loadShortcuts();
  act(() =>
    saveShortcuts({
      ...config,
      onOpenCommandPalette: { ...config.onOpenCommandPalette, keys: ['F7'] },
    }),
  );
  fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
  expect(screen.getByText('closed')).toBeTruthy();
  screen.getByRole('textbox').focus();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'F7' });
  expect(screen.getByText('closed')).toBeTruthy();
  screen.getByRole('textbox').blur();
  fireEvent.keyDown(window, { key: 'F7' });
  expect(screen.getByText('open')).toBeTruthy();
});

it('leaves an unmodified command-palette binding to text entry controls', () => {
  function Status() {
    const { isOpen } = useCommandPalette();
    return (
      <>
        <span>{isOpen ? 'open' : 'closed'}</span>
        <input aria-label='single line' />
        <textarea aria-label='multiple lines' />
        <div
          aria-label='rich text'
          role='textbox'
          tabIndex={0}
          contentEditable
          suppressContentEditableWarning
        >
          Draft
        </div>
      </>
    );
  }
  render(
    <CommandPaletteProvider>
      <Status />
    </CommandPaletteProvider>,
  );
  const config = loadShortcuts();
  act(() =>
    saveShortcuts({
      ...config,
      onOpenCommandPalette: { ...config.onOpenCommandPalette, keys: ['p'] },
    }),
  );
  const richText = screen.getByRole('textbox', { name: 'rich text' });
  // jsdom has no contenteditable editing engine or isContentEditable getter.
  Object.defineProperty(richText, 'isContentEditable', { value: true });
  for (const name of ['single line', 'multiple lines', 'rich text']) {
    const control = screen.getByRole('textbox', { name });
    control.focus();
    fireEvent.keyDown(control, { key: 'p' });
    expect(screen.getByText('closed')).toBeTruthy();
    control.blur();
  }
  fireEvent.keyDown(window, { key: 'p' });
  expect(screen.getByText('open')).toBeTruthy();
});
