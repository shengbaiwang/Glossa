import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  native: true,
  get: vi.fn(),
  status: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => mocks.native }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.fetch }));
vi.mock('@/utils/bridge', () => ({
  getSecureItem: mocks.get,
  getSecureItemStatus: mocks.status,
  setSecureItem: mocks.set,
  clearSecureItem: mocks.clear,
}));
import {
  activateProviderConfig,
  deleteProviderConfig,
  getActiveProviderConfig,
  getCachedProviderModels,
  getProviderModels,
  getProviderModelConfig,
  getProviderStatus,
  getSavedProviderConfigs,
  isProviderEnabled,
  listProviderModels,
  MODEL_SETTINGS_EVENT,
  MODEL_STORAGE_KEY,
  providerCapabilities,
  removeProviderModel,
  saveProviderConfig,
  setProviderEnabled,
  setProviderModelFavorite,
  streamCompletion,
  streamToolCompletion,
  testProviderConnection,
  validateProviderConfig,
  type ProviderConfig,
} from '@/glossa/ai/provider';
import { getMapCheckpointKey } from '@/glossa/mindmap/checkpoints';
import { getMindmapIdentity } from '@/glossa/mindmap/identity';
const config: ProviderConfig = {
  id: 'test-service',
  name: 'Test service',
  baseUrl: 'https://models.example/v1',
  model: 'chat',
};
const response = () =>
  Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
beforeEach(() => {
  localStorage.clear();
  mocks.native = true;
  mocks.get.mockReset().mockResolvedValue({ value: 'synthetic-secure-key' });
  mocks.status.mockReset().mockResolvedValue({ status: 'present' });
  mocks.set.mockReset().mockResolvedValue({ success: true });
  mocks.clear.mockReset().mockResolvedValue({ success: true });
  mocks.fetch.mockReset().mockImplementation(async () => response());
});
it('migrates legacy defaults and valid connections without reading secrets or discarding the migration source', async () => {
  const legacy = JSON.stringify({ activeId: config.id, providers: [config, { corrupt: true }] });
  localStorage.setItem('glossa.study-models.v1', legacy);
  expect(getActiveProviderConfig('conversation')).toEqual(config);
  expect(getActiveProviderConfig('mindmap')).toEqual(config);
  await saveProviderConfig({ ...config, model: 'second' });
  expect(getActiveProviderConfig('conversation')?.model).toBe('chat');
  expect(getProviderModels(config).map((item) => item.model)).toEqual(['chat', 'second']);
  expect(localStorage.getItem('glossa.study-models.v1')).toBe(legacy);
  expect(mocks.get).not.toHaveBeenCalled();
});
it('saving and testing a second service leaves both task defaults and credentials untouched', async () => {
  await activateProviderConfig(config, 'conversation');
  await activateProviderConfig({ ...config, model: 'map' }, 'mindmap');
  const draft = { ...config, id: 'draft', baseUrl: 'https://draft.example/v1' };
  await saveProviderConfig(draft);
  const before = localStorage.getItem(MODEL_STORAGE_KEY);
  await expect(
    testProviderConnection(draft, undefined, ' synthetic-draft-key '),
  ).resolves.toMatchObject({ checked: 'chat' });
  expect(localStorage.getItem(MODEL_STORAGE_KEY)).toBe(before);
  expect(getActiveProviderConfig('conversation')?.model).toBe('chat');
  expect(getActiveProviderConfig('mindmap')?.model).toBe('map');
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.fetch.mock.calls[0]![1].headers.Authorization).toBe('Bearer synthetic-draft-key');
  expect(JSON.stringify(localStorage)).not.toContain('synthetic');
});
it('a failed draft connection test does not save its provider or change defaults', async () => {
  await activateProviderConfig(config);
  mocks.fetch.mockResolvedValue(new Response('private failure', { status: 401 }));
  await expect(
    testProviderConnection({ ...config, id: 'unsaved' }, undefined, 'synthetic'),
  ).rejects.toThrow('The API key was rejected.');
  expect(getSavedProviderConfigs().map((item) => item.id)).toEqual([config.id]);
  expect(getActiveProviderConfig()).toEqual(config);
});
it('keeps per-model parameters and independent conversation and mind-map defaults', async () => {
  await activateProviderConfig({ ...config, maxTokens: 1024 }, 'conversation');
  await activateProviderConfig(
    { ...config, model: 'map', maxTokens: 8192, capabilityOverrides: { json: true } },
    'mindmap',
  );
  expect(getActiveProviderConfig('conversation')?.maxTokens).toBe(1024);
  expect(getActiveProviderConfig('mindmap')?.maxTokens).toBe(8192);
  expect(getProviderModelConfig(config, 'unknown')).toEqual({ ...config, model: 'unknown' });
  expect(getProviderModelConfig(config, 'map').capabilityOverrides).toEqual({ json: true });
});
it('a passive status check never reads or migrates the credential, including unavailable status', async () => {
  for (const status of ['present', 'missing', 'unavailable'] as const) {
    mocks.status.mockResolvedValue({ status });
    expect(await getProviderStatus(config)).toMatchObject({
      credentialStatus: status,
      configured: status !== 'missing',
      hasApiKey: status === 'present',
    });
  }
  mocks.status.mockRejectedValue(new Error('private metadata error'));
  expect(await getProviderStatus(config)).toMatchObject({
    credentialStatus: 'unavailable',
    configured: true,
  });
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});
it('unavailable metadata does not bypass an actual denied credential read', async () => {
  mocks.status.mockResolvedValue({ status: 'unavailable' });
  expect((await getProviderStatus(config)).configured).toBe(true);
  mocks.get.mockResolvedValue({ error: 'denied' });
  await expect(testProviderConnection(config)).rejects.toThrow(
    'Unable to read the API key from secure storage.',
  );
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('missing credentials prevent remote requests but a local model remains usable', async () => {
  mocks.get.mockResolvedValue({ value: '' });
  await expect(testProviderConnection(config)).rejects.toThrow('Enter an API key');
  expect(mocks.fetch).not.toHaveBeenCalled();
  await expect(
    testProviderConnection({ ...config, baseUrl: 'http://localhost:11434/v1' }),
  ).resolves.toMatchObject({ checked: 'chat' });
});
it('rejects unsafe temporary credentials without issuing a request', async () => {
  for (const key of ['bad\r\nheader', 'x'.repeat(4097)])
    await expect(testProviderConnection(config, undefined, key)).rejects.toThrow(
      'The API key is invalid.',
    );
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('retains favorites and last-used timestamps without transferring another model settings', async () => {
  await activateProviderConfig({ ...config, maxTokens: 2048 });
  setProviderModelFavorite(config, config.model, true);
  await saveProviderConfig({ ...config, maxTokens: 4096 });
  expect(getProviderModels(config)[0]).toMatchObject({
    favorite: true,
    lastUsedAt: expect.any(Number),
    maxTokens: 4096,
  });
  setProviderModelFavorite(config, 'second', true);
  expect(getProviderModelConfig(config, 'second').maxTokens).toBeUndefined();
});
it('caches discovery without changing defaults, preserves cache on failure, and isolates endpoints', async () => {
  mocks.fetch.mockResolvedValueOnce(
    Response.json({ data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }),
  );
  expect(await listProviderModels(config, undefined, { apiKey: 'synthetic' })).toEqual(['a', 'b']);
  expect(getCachedProviderModels(config)).toEqual({
    models: ['a', 'b'],
    updatedAt: expect.any(Number),
  });
  expect(getActiveProviderConfig()).toBeNull();
  expect(getCachedProviderModels({ ...config, baseUrl: 'https://other.example/v1' })).toBeNull();
  mocks.fetch.mockRejectedValueOnce(new Error('offline'));
  await expect(listProviderModels(config)).rejects.toThrow();
  expect(getCachedProviderModels(config)?.models).toEqual(['a', 'b']);
});
it('disabling a provider prevents new work, preserves defaults for re-enable, and does not read secrets', async () => {
  await activateProviderConfig(config, 'mindmap');
  setProviderEnabled(config.id, false);
  expect(isProviderEnabled(config.id)).toBe(false);
  expect(getActiveProviderConfig('mindmap')).toBeNull();
  await expect(testProviderConnection(config)).rejects.toThrow('Enable this model service first.');
  expect(mocks.get).not.toHaveBeenCalled();
  setProviderEnabled(config.id, true);
  expect(getActiveProviderConfig('mindmap')).toEqual(config);
});
it('removing a model clears only its own purpose default', async () => {
  await activateProviderConfig(config, 'conversation');
  await activateProviderConfig({ ...config, model: 'map' }, 'mindmap');
  removeProviderModel(config, 'chat');
  expect(getActiveProviderConfig('conversation')).toBeNull();
  expect(getActiveProviderConfig('mindmap')?.model).toBe('map');
});
it('failed secure deletion retains the provider and successful deletion leaves history storage alone', async () => {
  await activateProviderConfig(config);
  localStorage.setItem('synthetic-history', 'preserve me');
  mocks.clear.mockResolvedValueOnce({ success: false });
  await expect(deleteProviderConfig(config)).rejects.toThrow();
  expect(getActiveProviderConfig()).toEqual(config);
  await deleteProviderConfig(config);
  expect(getSavedProviderConfigs()).toEqual([]);
  expect(getActiveProviderConfig()).toBeNull();
  expect(localStorage.getItem('synthetic-history')).toBe('preserve me');
});
it('explicit capability overrides control request parameters and reject unsupported structured work locally', async () => {
  const custom = {
    ...config,
    reasoningEffort: 'high' as const,
    capabilityOverrides: {
      reasoningEfforts: ['high' as const],
      maxTokensParam: 'max_completion_tokens' as const,
      tools: false,
      json: false,
    },
  };
  await streamCompletion({
    config: custom,
    messages: [{ role: 'user', content: 'Synthetic' }],
    maxTokens: 128,
  });
  const body = JSON.parse(mocks.fetch.mock.calls[0]![1].body);
  expect(body).toMatchObject({ reasoning_effort: 'high', max_completion_tokens: 128 });
  expect(body.max_tokens).toBeUndefined();
  mocks.fetch.mockClear();
  await expect(
    streamCompletion({
      config: custom,
      messages: [{ role: 'user', content: 'Synthetic' }],
      responseFormat: { type: 'json_object' },
    }),
  ).rejects.toMatchObject({ code: 'unsupported_format' });
  await expect(
    streamToolCompletion({
      config: custom,
      messages: [{ role: 'user', content: 'Synthetic' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Lookup',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    }),
  ).rejects.toMatchObject({ code: 'unsupported_tools' });
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(() =>
    validateProviderConfig({ ...config, capabilityOverrides: { tools: 'yes' } }),
  ).toThrow();
  expect(providerCapabilities(custom).tools).toBe(false);
});
it('capability changes invalidate checkpoint and map identities while equivalent override ordering is stable', async () => {
  const input = { bookId: 'book', title: 'Synthetic', target: { kind: 'book' as const }, config };
  const changed = {
    ...config,
    capabilityOverrides: { json: false, reasoningEfforts: ['high', 'low'] as ('high' | 'low')[] },
  };
  expect(await getMapCheckpointKey(input)).not.toBe(
    await getMapCheckpointKey({ ...input, config: changed }),
  );
  expect(await getMindmapIdentity('book', 'passage', [], config)).not.toEqual(
    await getMindmapIdentity('book', 'passage', [], changed),
  );
  expect(await getMapCheckpointKey({ ...input, config: changed })).toBe(
    await getMapCheckpointKey({
      ...input,
      config: {
        ...config,
        capabilityOverrides: { reasoningEfforts: ['low', 'high'], json: false },
      },
    }),
  );
});
it('forwards only model-storage cross-window events to active readers', () => {
  const changed = vi.fn();
  window.addEventListener(MODEL_SETTINGS_EVENT, changed);
  window.dispatchEvent(new StorageEvent('storage', { key: MODEL_STORAGE_KEY }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
  expect(changed).toHaveBeenCalledOnce();
  window.removeEventListener(MODEL_SETTINGS_EVENT, changed);
});

it('refuses to remove a connection saved again while secure deletion was pending', async () => {
  await activateProviderConfig(config);
  let finishClear!: (value: { success: boolean }) => void;
  mocks.clear.mockReturnValueOnce(
    new Promise((resolve) => {
      finishClear = resolve;
    }),
  );
  const deletion = deleteProviderConfig(config);
  await saveProviderConfig(config, 'synthetic-new-key');
  finishClear({ success: true });
  await expect(deletion).rejects.toThrow('The model settings changed.');
  expect(getActiveProviderConfig()).toEqual(config);
});
it('treats unexpected credential metadata as unavailable rather than absent or readable', async () => {
  mocks.status.mockResolvedValue({ status: 'future-status' });
  expect(await getProviderStatus(config)).toMatchObject({
    credentialStatus: 'unavailable',
    hasApiKey: false,
    configured: true,
  });
  expect(mocks.get).not.toHaveBeenCalled();
});

it('resetting a draft capability override to automatic restores inferred values', () => {
  const inferred = { ...config, baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.2' };
  expect(
    providerCapabilities({
      ...inferred,
      capabilityOverrides: { reasoningEfforts: undefined, maxTokensParam: undefined },
    }),
  ).toEqual(providerCapabilities(inferred));
});
