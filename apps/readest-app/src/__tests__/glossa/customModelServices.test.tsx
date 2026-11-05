import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  getActiveProviderConfig,
  activateProviderConfig,
  getProviderStatus,
  getSavedProviderConfigs,
  saveProviderConfig,
} from '@/glossa/ai/provider';
import ModelSettingsPanel from '@/glossa/ui/ModelSettingsPanel';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function addService(name: string, key = '') {
  const add = screen.getByRole('option', { name: 'Add custom service' }) as HTMLOptionElement;
  fireEvent.change(screen.getByRole('combobox', { name: 'Model service' }), {
    target: { value: add.value },
  });
  fireEvent.change(screen.getByLabelText('Service name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('API Base URL'), {
    target: { value: 'https://models.example/v1' },
  });
  fireEvent.change(screen.getByLabelText('Model name'), { target: { value: `${name}-model` } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
}

it('saves multiple named services, restores them on reopen, and edits without duplicating', async () => {
  const view = render(<ModelSettingsPanel />);
  await addService('First', 'synthetic-first-key');
  await screen.findByText('Model service saved.');
  const first = getSavedProviderConfigs()[0]!;
  expect(getActiveProviderConfig()).toBeNull();
  expect(screen.getByRole('option', { name: 'First' })).toBeTruthy();
  await addService('Second');
  await screen.findByText('Model service saved.');
  const second = getSavedProviderConfigs().find((config) => config.id !== first.id)!;
  expect(first.id).not.toBe(second.id);
  expect(getSavedProviderConfigs()).toHaveLength(2);
  expect(await getProviderStatus(first)).toMatchObject({ hasApiKey: true });
  expect(await getProviderStatus(second)).toMatchObject({ hasApiKey: false });
  expect(JSON.stringify(localStorage)).not.toContain('synthetic-first-key');

  view.unmount();
  render(<ModelSettingsPanel />);
  const picker = screen.getByRole('combobox', { name: 'Model service' }) as HTMLSelectElement;
  expect(picker.value).toBe(first.id);
  expect(screen.getByRole('option', { name: 'First' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Second' })).toBeTruthy();
  fireEvent.change(picker, { target: { value: first.id } });
  expect((screen.getByLabelText('Model name') as HTMLInputElement).value).toBe('First-model');
  fireEvent.change(screen.getByLabelText('Service name'), { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
  await screen.findByText('Model service saved.');
  expect(screen.getByRole('option', { name: 'Renamed' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'First' })).toBeNull();
  expect(getActiveProviderConfig()).toBeNull();
  expect(getSavedProviderConfigs()).toContainEqual(
    expect.objectContaining({ id: first.id, name: 'Renamed' }),
  );
  expect(getSavedProviderConfigs()).toHaveLength(2);
});

it('keeps the legacy custom service and its key when adding another service', async () => {
  const legacy = await saveProviderConfig(
    {
      id: 'custom',
      name: 'Legacy',
      baseUrl: 'https://legacy.example/v1',
      model: 'legacy-model',
    },
    'synthetic-legacy-key',
  );
  render(<ModelSettingsPanel />);
  expect(screen.getByRole('option', { name: 'Legacy' })).toBeTruthy();
  await addService('New');
  await screen.findByText('Model service saved.');
  expect(getSavedProviderConfigs()).toContainEqual(legacy);
  expect(await getProviderStatus(legacy)).toMatchObject({ hasApiKey: true });
});

it('does not add a menu entry or replace the active service when saving fails', async () => {
  const saved = await saveProviderConfig({
    id: 'custom',
    name: 'Existing',
    baseUrl: 'https://existing.example/v1',
    model: 'existing-model',
  });
  await activateProviderConfig(saved);
  render(<ModelSettingsPanel />);
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable');
  });
  await addService('Unsaved');
  await screen.findByRole('alert');
  expect(screen.queryByRole('option', { name: 'Unsaved' })).toBeNull();
  expect(getActiveProviderConfig()).toEqual(saved);
  setItem.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
  await waitFor(() => expect(getSavedProviderConfigs()).toHaveLength(2));
  expect(await screen.findByRole('option', { name: 'Unsaved' })).toBeTruthy();
});
