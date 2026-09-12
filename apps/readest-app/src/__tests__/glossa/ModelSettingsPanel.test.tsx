import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  active: {
    id: 'custom',
    name: 'Study service',
    baseUrl: 'https://models.example/v1',
    model: 'reader-model',
  },
  save: vi.fn(),
  status: vi.fn(),
  list: vi.fn(),
  test: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/glossa/ai/provider', async (original) => ({
  ...(await original<typeof import('@/glossa/ai/provider')>()),
  getActiveProviderConfig: () => mocks.active,
  getSavedProviderConfigs: () => [mocks.active],
  getProviderStatus: mocks.status,
  saveProviderConfig: mocks.save,
  listProviderModels: mocks.list,
  testProviderConnection: mocks.test,
  clearProviderApiKey: mocks.clear,
}));

import ModelSettingsPanel from '@/glossa/ui/ModelSettingsPanel';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockImplementation(async (config) => config);
  mocks.status.mockResolvedValue({ configured: true, hasApiKey: true, storage: 'session' });
  mocks.list.mockResolvedValue(['reader-model', 'other-model']);
  mocks.test.mockResolvedValue(undefined);
  mocks.clear.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('model service settings', () => {
  it('keeps the saved key hidden and clears newly entered key after saving', async () => {
    render(<ModelSettingsPanel />);
    const input = screen.getByLabelText('API Key') as HTMLInputElement;
    await waitFor(() => expect(input.placeholder).toBe('Key saved. Leave blank to keep it.'));
    expect(input.value).toBe('');
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'synthetic-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this service' }));
    await screen.findByText('Model service saved.');
    expect(mocks.save).toHaveBeenCalledWith(mocks.active, 'synthetic-secret');
    expect(input.value).toBe('');
    expect(
      screen.getByText(
        'In the browser, API keys last only for this session. Your service must allow browser connections.',
      ),
    ).toBeTruthy();
  });

  it('lets a fetched model become the manually editable selected model', async () => {
    render(<ModelSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));
    const models = await screen.findByRole('combobox', { name: 'Available models' });
    fireEvent.change(models, { target: { value: 'other-model' } });
    expect((screen.getByLabelText('Model name') as HTMLInputElement).value).toBe('other-model');
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByText('Connection successful. This model is ready for reading guides.');
    expect(mocks.test.mock.calls[0]![0].model).toBe('other-model');
  });

  it('cancels a connection test when the user leaves settings', async () => {
    mocks.test.mockImplementation(
      (_config, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const view = render(<ModelSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(mocks.test).toHaveBeenCalledOnce());
    const signal: AbortSignal = mocks.test.mock.calls[0]![1];
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('removes a saved key without deleting nonsecret service settings', async () => {
    render(<ModelSettingsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove key' }));
    await screen.findByText('API key removed.');
    expect(mocks.clear).toHaveBeenCalledWith(mocks.active);
    expect(mocks.save).not.toHaveBeenCalled();
    expect((screen.getByLabelText('API Base URL') as HTMLInputElement).value).toBe(
      mocks.active.baseUrl,
    );
  });

  it('hides reasoning effort for unsupported services but keeps the output limit', () => {
    render(<ModelSettingsPanel />);
    expect(screen.queryByLabelText('Reasoning effort')).toBeNull();
    expect(screen.getByLabelText('Output limit')).toBeTruthy();
  });

  it('offers reasoning effort for a supported model and saves both parameters', async () => {
    mocks.active = {
      ...mocks.active,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5.3-flash',
    };
    render(<ModelSettingsPanel />);
    const effort = await screen.findByLabelText('Reasoning effort');
    fireEvent.change(effort, { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('Output limit'), { target: { value: '2048' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this service' }));
    await screen.findByText('Model service saved.');
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: 'high', maxTokens: 2048 }),
      undefined,
    );
  });
});
