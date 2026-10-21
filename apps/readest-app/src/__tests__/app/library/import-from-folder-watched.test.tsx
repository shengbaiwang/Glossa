import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FolderImportSettings from '@/components/settings/FolderImportSettings';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';

const mocks = vi.hoisted(() => ({ saveSettings: vi.fn(), envConfig: {} }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: mocks.envConfig }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));
vi.mock('@/utils/rtl', () => ({ getDirFromUILanguage: () => 'ltr' }));

beforeEach(() => {
  mocks.saveSettings.mockReset().mockResolvedValue(undefined);
  window.localStorage.removeItem('readest:lastImportFolderReadInPlace');
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      externalLibraryFolders: ['/Books', '/Comics'],
      autoImportFolders: ['/Books', '/Comics'],
      autoImportFlattenFolders: ['/Comics'],
      autoImportFolderGroups: { '/Books': 'Books', '/Comics': 'Comics' },
    } as SystemSettings,
    saveSettings: mocks.saveSettings,
  });
});
afterEach(cleanup);

it('keeps file handling in Settings and defaults new folders to a library copy', () => {
  render(<FolderImportSettings />);
  expect(
    (screen.getByRole('combobox', { name: 'File handling for new folders' }) as HTMLSelectElement)
      .value,
  ).toBe('copy');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
});

it('preserves the old reading preference until explicitly changed', async () => {
  window.localStorage.setItem('readest:lastImportFolderReadInPlace', '1');
  render(<FolderImportSettings />);
  const select = screen.getByRole('combobox', { name: 'File handling for new folders' });
  expect((select as HTMLSelectElement).value).toBe('original');
  fireEvent.change(select, { target: { value: 'copy' } });
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledOnce());
  expect(useSettingsStore.getState().settings.folderImportReadInPlace).toBe(false);
  expect(useSettingsStore.getState().settings.externalLibraryFolders).toEqual([
    '/Books',
    '/Comics',
  ]);
  expect(useSettingsStore.getState().settings.autoImportFolders).toEqual(['/Books', '/Comics']);
});

it('enables automatic import for newly imported folders without changing existing watches', async () => {
  render(<FolderImportSettings />);
  fireEvent.change(screen.getByRole('combobox', { name: 'File handling for new folders' }), {
    target: { value: 'original' },
  });
  await waitFor(() =>
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Watch newly imported folders' }));
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(2));
  expect(useSettingsStore.getState().settings.folderImportAutoImport).toBe(true);
  expect(useSettingsStore.getState().settings.autoImportFolders).toEqual(['/Books', '/Comics']);
});

it('shows existing watched folders and their individual structure', () => {
  render(<FolderImportSettings />);
  expect(screen.getByText('Books')).toBeTruthy();
  expect(screen.getByText('Comics')).toBeTruthy();
  expect(
    screen
      .getAllByRole('combobox', { name: 'Folder Structure' })
      .map((item) => (item as HTMLSelectElement).value),
  ).toEqual(['keep', 'flatten']);
});

it('changes grouping for only the selected watched folder', async () => {
  render(<FolderImportSettings />);
  fireEvent.change(screen.getAllByRole('combobox', { name: 'Folder Structure' })[0]!, {
    target: { value: 'flatten' },
  });
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledOnce());
  expect(useSettingsStore.getState().settings.autoImportFlattenFolders).toEqual([
    '/Comics',
    '/Books',
  ]);
  expect(useSettingsStore.getState().settings.autoImportFolders).toEqual(['/Books', '/Comics']);
});

it('stops watching without unregistering or deleting the original files', async () => {
  render(<FolderImportSettings />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Stop watching' })[1]!);
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledOnce());
  expect(useSettingsStore.getState().settings.autoImportFolders).toEqual(['/Books']);
  expect(useSettingsStore.getState().settings.autoImportFlattenFolders).toEqual([]);
  expect(useSettingsStore.getState().settings.autoImportFolderGroups).toEqual({
    '/Books': 'Books',
  });
  expect(useSettingsStore.getState().settings.externalLibraryFolders).toEqual([
    '/Books',
    '/Comics',
  ]);
});

it('restores a failed preference or watch change and offers another attempt', async () => {
  mocks.saveSettings.mockRejectedValueOnce(new Error('disk full'));
  render(<FolderImportSettings />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Stop watching' })[0]!);
  await screen.findByRole('alert');
  expect(screen.getByText('Books')).toBeTruthy();
  expect(useSettingsStore.getState().settings.autoImportFolders).toEqual(['/Books', '/Comics']);
  fireEvent.click(screen.getAllByRole('button', { name: 'Stop watching' })[0]!);
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(useSettingsStore.getState().settings.autoImportFolders).toEqual(['/Comics']);
});
