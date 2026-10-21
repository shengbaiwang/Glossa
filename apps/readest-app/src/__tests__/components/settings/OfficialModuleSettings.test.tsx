import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import OfficialModuleSettings from '@/components/settings/OfficialModuleSettings';
import { broadcastGlobalSettings } from '@/utils/settingsSync';

const f = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));
beforeEach(() => {
  f.save.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: { keepLogin: true } as SystemSettings,
    saveSettings: f.save,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('defaults to enabled and saves a module switch without modifying unrelated preferences', async () => {
  render(<OfficialModuleSettings />);
  expect((screen.getByRole('checkbox', { name: 'Conversation' }) as HTMLInputElement).checked).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Conversation' }));
  await waitFor(() => expect(f.save).toHaveBeenCalledOnce());
  expect(useSettingsStore.getState().settings).toEqual({
    keepLogin: true,
    officialModules: { conversation: false },
  });
  await waitFor(() =>
    expect(broadcastGlobalSettings).toHaveBeenCalledWith(expect.anything(), {
      officialModules: { conversation: false },
    }),
  );
  expect((screen.getByRole('checkbox', { name: 'Mind map' }) as HTMLInputElement).checked).toBe(
    true,
  );
});

it('restores a failed switch, preserves concurrent edits and allows retry', async () => {
  let reject!: (error: Error) => void;
  f.save.mockImplementationOnce(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  render(<OfficialModuleSettings />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Conversation' }));
  expect((screen.getByRole('checkbox', { name: 'Mind map' }) as HTMLInputElement).disabled).toBe(
    true,
  );
  act(() =>
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        keepLogin: false,
        officialModules: { conversation: false, mindmap: false },
      },
    }),
  );
  await act(async () => reject(new Error('disk full')));
  expect(screen.getByRole('alert').textContent).toContain(
    'Couldn’t save module settings. Please try again.',
  );
  expect(useSettingsStore.getState().settings.keepLogin).toBe(false);
  expect(useSettingsStore.getState().settings.officialModules).toEqual({ mindmap: false });
  expect(broadcastGlobalSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Conversation' }));
  await waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('offers PDF automatic contents as an independent bundled plugin', async () => {
  render(<OfficialModuleSettings />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'PDF automatic contents' }));
  await waitFor(() => expect(f.save).toHaveBeenCalledOnce());
  expect(useSettingsStore.getState().settings.officialModules).toEqual({ pdfAutoContents: false });
});
