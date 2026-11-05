import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ShortcutsPanel from '@/components/settings/ShortcutsPanel';
import { loadShortcuts } from '@/helpers/shortcuts';
import useShortcuts from '@/hooks/useShortcuts';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string>) =>
    key.replace(/{{(\w+)}}/g, (_, name: string) => values?.[name] ?? name),
}));
vi.mock('@/services/environment', () => ({ isMacPlatform: () => true }));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const row = (action: string) => {
  const element = document.querySelector(`[data-setting-id="settings.shortcuts.${action}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing shortcut row: ${action}`);
  return within(element);
};

const showSidebar = () =>
  fireEvent.change(screen.getByLabelText('Search shortcuts'), {
    target: { value: 'Toggle Sidebar' },
  });

it('filters actions by their label and records a shortcut that immediately works', () => {
  const toggle = vi.fn();
  function Reader() {
    useShortcuts({ onToggleSideBar: toggle });
    return null;
  }
  render(
    <>
      <Reader />
      <ShortcutsPanel />
    </>,
  );
  showSidebar();
  expect(screen.queryByText('Next Page')).toBeNull();
  fireEvent.click(
    row('onToggleSideBar').getByRole('button', { name: 'Add shortcut for Toggle Sidebar' }),
  );
  fireEvent.keyDown(screen.getByLabelText('Press a shortcut'), {
    key: 'y',
    metaKey: true,
    shiftKey: true,
  });
  expect(loadShortcuts().onToggleSideBar.keys).toContain('cmd+shift+y');
  fireEvent.keyDown(window, { key: 'y', metaKey: true, shiftKey: true });
  expect(toggle).toHaveBeenCalledTimes(1);
});

it('cancels recording with Escape without closing settings, and rejects conflicting keys', () => {
  const close = vi.fn();
  render(
    <div onKeyDown={close}>
      <ShortcutsPanel />
    </div>,
  );
  showSidebar();
  const add = row('onToggleSideBar').getByRole('button', {
    name: 'Add shortcut for Toggle Sidebar',
  });
  fireEvent.click(add);
  fireEvent.keyDown(screen.getByLabelText('Press a shortcut'), { key: 'n' });
  expect(screen.getByRole('alert').textContent).toContain('Toggle Notebook');
  expect(loadShortcuts().onToggleSideBar.keys).toEqual(['s']);
  fireEvent.keyDown(screen.getByLabelText('Press a shortcut'), { key: 'Escape' });
  expect(screen.queryByLabelText('Press a shortcut')).toBeNull();
  expect(document.activeElement).toBe(add);
  expect(close).not.toHaveBeenCalled();
});

it('removes bindings, restores one action and can undo restoring all defaults', () => {
  render(<ShortcutsPanel />);
  showSidebar();
  fireEvent.click(row('onToggleSideBar').getByRole('button', { name: 'Remove shortcut S' }));
  expect(loadShortcuts().onToggleSideBar.keys).toEqual([]);
  expect(row('onToggleSideBar').getByText('Not assigned')).toBeTruthy();
  fireEvent.click(row('onToggleSideBar').getByRole('button', { name: 'Restore Toggle Sidebar' }));
  expect(loadShortcuts().onToggleSideBar.keys).toEqual(['s']);
  fireEvent.click(row('onToggleSideBar').getByRole('button', { name: 'Remove shortcut S' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore All Defaults' }));
  expect(loadShortcuts().onToggleSideBar.keys).toEqual(['s']);
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(loadShortcuts().onToggleSideBar.keys).toEqual([]);
});

it('keeps an unsaved binding visible and retries without overwriting another window’s change', () => {
  render(<ShortcutsPanel />);
  showSidebar();
  const setItem = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
    throw new Error('full');
  });
  fireEvent.click(
    row('onToggleSideBar').getByRole('button', { name: 'Add shortcut for Toggle Sidebar' }),
  );
  fireEvent.keyDown(screen.getByLabelText('Press a shortcut'), { key: 'y', ctrlKey: true });
  expect(screen.getByRole('alert').textContent).toContain('Could not save shortcuts');
  expect(row('onToggleSideBar').getByRole('button', { name: 'Change shortcut ⌃Y' })).toBeTruthy();
  setItem.mockRestore();
  localStorage.setItem('customShortcuts', JSON.stringify({ onToggleNotebook: ['ctrl+shift+z'] }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(loadShortcuts().onToggleSideBar.keys).toContain('ctrl+y');
  expect(loadShortcuts().onToggleNotebook.keys).toEqual(['ctrl+shift+z']);
});

it('cancels a replacement if its bindings changed in another window during recording', () => {
  render(<ShortcutsPanel />);
  showSidebar();
  fireEvent.click(row('onToggleSideBar').getByRole('button', { name: 'Change shortcut S' }));
  localStorage.setItem('customShortcuts', JSON.stringify({ onToggleSideBar: [] }));
  act(() => window.dispatchEvent(new Event('shortcutUpdate')));
  fireEvent.keyDown(screen.getByLabelText('Press a shortcut'), { key: 'y', metaKey: true });
  expect(screen.queryByLabelText('Press a shortcut')).toBeNull();
  expect(loadShortcuts().onToggleSideBar.keys).toEqual([]);
});

it('keeps a failed undo from overwriting a later edit when retried', () => {
  render(<ShortcutsPanel />);
  showSidebar();
  fireEvent.click(row('onToggleSideBar').getByRole('button', { name: 'Remove shortcut S' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore All Defaults' }));
  const save = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
    throw new Error('full');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  save.mockRestore();
  localStorage.setItem('customShortcuts', JSON.stringify({ onToggleSideBar: ['ctrl+y'] }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(loadShortcuts().onToggleSideBar.keys).toEqual(['ctrl+y']);
  expect(screen.getByRole('button', { name: 'Discard changes' })).toBeTruthy();
});

it('checks for a newly conflicting binding before retrying a draft', () => {
  render(<ShortcutsPanel />);
  showSidebar();
  const save = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
    throw new Error('full');
  });
  fireEvent.click(
    row('onToggleSideBar').getByRole('button', { name: 'Add shortcut for Toggle Sidebar' }),
  );
  fireEvent.keyDown(screen.getByLabelText('Press a shortcut'), { key: 'y', ctrlKey: true });
  save.mockRestore();
  localStorage.setItem('customShortcuts', JSON.stringify({ onToggleNotebook: ['ctrl+y'] }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(loadShortcuts().onToggleSideBar.keys).toEqual(['s']);
  expect(screen.getByRole('alert').textContent).toContain('Toggle Notebook');
});

it('keeps keyboard focus on a changed binding and returns to add after removing it', () => {
  render(<ShortcutsPanel />);
  showSidebar();
  fireEvent.click(row('onToggleSideBar').getByRole('button', { name: 'Change shortcut S' }));
  fireEvent.keyDown(screen.getByLabelText('Press a shortcut'), { key: 'y', metaKey: true });
  expect(document.activeElement).toBe(
    row('onToggleSideBar').getByRole('button', { name: 'Change shortcut ⌘Y' }),
  );
  fireEvent.click(row('onToggleSideBar').getByRole('button', { name: 'Remove shortcut ⌘Y' }));
  expect(document.activeElement).toBe(
    row('onToggleSideBar').getByRole('button', { name: 'Add shortcut for Toggle Sidebar' }),
  );
});
