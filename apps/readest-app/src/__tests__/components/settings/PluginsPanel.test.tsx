import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import PluginsPanel from '@/components/settings/PluginsPanel';

const f = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));
vi.mock('@/glossa/ui/ModelSettingsPanel', () => ({
  default: () => <p>Shared model configuration</p>,
}));
vi.mock('@/glossa/ui/PromptSettingsPanel', () => ({
  default: () => <p>Personal conversation prompts</p>,
}));
beforeEach(() => {
  f.save.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({ settings: {} as SystemSettings, saveSettings: f.save });
});
afterEach(cleanup);

it('shows one settings entry in every grid card and defers internal settings until opened', () => {
  const view = render(<PluginsPanel />);
  expect(view.container.querySelectorAll('.glossa-plugin-grid > article')).toHaveLength(4);
  for (const name of ['Conversation', 'Mind map', 'PDF automatic contents', 'Import webpage']) {
    expect(screen.getByRole('button', { name: `${name} - Settings` })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name })).toBeTruthy();
  }
  expect(screen.queryByText('Personal conversation prompts')).toBeNull();
  expect(screen.queryByText('Shared model configuration')).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Generate contents on import' })).toBeNull();
});

it('opens conversation prompts and shared models inside the plugin and returns to its card', async () => {
  render(<PluginsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Conversation - Settings' }));
  await screen.findByText('Personal conversation prompts');
  fireEvent.click(screen.getByRole('button', { name: 'Model Services' }));
  await screen.findByText('Shared model configuration');
  expect(screen.queryByText('Personal conversation prompts')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to plugins' }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Conversation - Settings' }),
  );
  expect(screen.queryByText('Shared model configuration')).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
});

it('keeps settings accessible while disabled and saves PDF import independently', async () => {
  useSettingsStore.setState({
    settings: { officialModules: { pdfAutoContents: false, mindmap: false } } as SystemSettings,
  });
  render(<PluginsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Mind map - Settings' }));
  await screen.findByText('Shared model configuration');
  fireEvent.click(screen.getByRole('button', { name: 'Back to plugins' }));
  fireEvent.click(screen.getByRole('button', { name: 'PDF automatic contents - Settings' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Generate contents on import' }));
  await waitFor(() => expect(f.save).toHaveBeenCalledOnce());
  expect(useSettingsStore.getState().settings.pdfContentsOnImport).toBe(false);
  expect(useSettingsStore.getState().settings.officialModules?.pdfAutoContents).toBe(false);
});

it('preserves a pending plugin save and its recovery while visiting internal settings', async () => {
  let reject!: (error: Error) => void;
  f.save.mockImplementationOnce(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  render(<PluginsPanel />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Conversation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Conversation - Settings' }));
  await screen.findByText('Personal conversation prompts');
  fireEvent.click(screen.getByRole('button', { name: 'Back to plugins' }));
  expect(
    (screen.getByRole('checkbox', { name: 'Conversation' }) as HTMLInputElement).disabled,
  ).toBe(true);
  await act(async () => reject(new Error('disk full')));
  expect((screen.getByRole('checkbox', { name: 'Conversation' }) as HTMLInputElement).checked).toBe(
    true,
  );
  expect(screen.getByRole('alert')).toBeTruthy();
});

it('opens webpage plugin information without loading model settings or making requests', async () => {
  useSettingsStore.setState({
    settings: { officialModules: { webImport: false } } as SystemSettings,
  });
  render(<PluginsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Import webpage - Settings' }));
  await screen.findByText('Save web articles to your library for offline reading.');
  expect(screen.queryByText('Shared model configuration')).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to plugins' }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Import webpage - Settings' }),
  );
});
