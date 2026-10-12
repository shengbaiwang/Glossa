import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ApplicationSettingsButton from '@/components/settings/ApplicationSettingsButton';
import SettingsToggler from '@/app/reader/components/SettingsToggler';
import { useSettingsStore } from '@/store/settingsStore';
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/store/readerStore', () => ({ useReaderStore: () => ({ setHoveredBookKey: vi.fn() }) }));
beforeEach(() => {
  useSettingsStore.setState({
    isSettingsDialogOpen: false,
    settingsDialogBookKey: '',
    settingsDialogScope: 'application',
    requestedPanel: null,
    activeSettingsItemId: null,
    requestedSubPage: null,
  });
});
afterEach(cleanup);
it('switches between book appearance and global settings without carrying the book target', () => {
  render(
    <>
      <SettingsToggler bookKey='book-2' />
      <ApplicationSettingsButton />
    </>,
  );
  const appearance = screen.getByRole('button', { name: 'Reading Appearance' });
  const settings = screen.getByRole('button', { name: 'Settings' });
  fireEvent.click(appearance);
  expect(useSettingsStore.getState()).toMatchObject({
    settingsDialogScope: 'reading',
    settingsDialogBookKey: 'book-2',
    isSettingsDialogOpen: true,
  });
  expect(appearance.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(settings);
  expect(useSettingsStore.getState()).toMatchObject({
    settingsDialogScope: 'application',
    settingsDialogBookKey: '',
    requestedPanel: 'General',
  });
  expect(appearance.getAttribute('aria-expanded')).toBe('false');
  expect(settings.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(appearance);
  fireEvent.click(appearance);
  expect(useSettingsStore.getState().isSettingsDialogOpen).toBe(false);
});
it('opens model preferences globally and clears stale navigation', () => {
  useSettingsStore.setState({
    requestedSubPage: 'gdrive',
    activeSettingsItemId: 'settings.color.themeMode',
  });
  useSettingsStore.getState().openSettingsDialog('application', '', 'Models');
  expect(useSettingsStore.getState()).toMatchObject({
    settingsDialogScope: 'application',
    settingsDialogBookKey: '',
    requestedPanel: 'Models',
    requestedSubPage: null,
    activeSettingsItemId: null,
  });
});
