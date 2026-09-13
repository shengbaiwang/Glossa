import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import {
  BoxedList,
  SectionTitle,
  SettingsInput,
  SettingsRow,
  SettingsSelect,
  Tips,
} from '@/components/settings/primitives';
import {
  clearProviderApiKey,
  getActiveProviderConfig,
  getProviderStatus,
  getSavedProviderConfigs,
  listProviderModels,
  ModelServiceError,
  PROVIDER_PRESETS,
  providerCapabilities,
  saveProviderConfig,
  testProviderConnection,
  type ProviderConfig,
  type ReasoningEffort,
} from '../ai/provider';

const builtinProviders = PROVIDER_PRESETS.filter((preset) => preset.id !== 'custom');
const newCustomService = 'new-custom';

const ModelSettingsPanel: React.FC = () => {
  const _ = useTranslation();
  const [savedProviders, setSavedProviders] = useState(getSavedProviderConfigs);
  const [config, setConfig] = useState<ProviderConfig>(
    () => getActiveProviderConfig() ?? { ...PROVIDER_PRESETS[0]! },
  );
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'models' | 'test' | 'remove' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const isNative = isTauriAppPlatform();
  const isCustom = !builtinProviders.some((preset) => preset.id === config.id);
  const isSaved = savedProviders.some((provider) => provider.id === config.id);
  const capabilities = providerCapabilities(config);
  const effortLabels: Record<ReasoningEffort, string> = {
    none: _('None'),
    minimal: _('Minimal'),
    low: _('Low'),
    medium: _('Medium'),
    high: _('High'),
    xhigh: _('Extra high'),
    max: _('Max'),
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);

  useEffect(() => {
    let current = true;
    setHasKey(false);
    getProviderStatus(config)
      .then((status) => {
        if (current) setHasKey(status.hasApiKey);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [config]);

  const updateConfig = (update: Partial<ProviderConfig>) => {
    setConfig((current) => ({ ...current, ...update }));
    setMessage('');
    setError('');
    if (update.baseUrl !== undefined) setModels([]);
  };

  const selectProvider = (id: string) => {
    const next =
      id === newCustomService
        ? {
            id: `custom-${crypto.randomUUID()}`,
            name: _('Custom service'),
            baseUrl: '',
            model: '',
          }
        : (getSavedProviderConfigs().find((item) => item.id === id) ??
          builtinProviders.find((item) => item.id === id));
    if (!next) return;
    setConfig({ ...next });
    setApiKey('');
    setModels([]);
    setMessage('');
    setError('');
  };

  const run = async (action: 'save' | 'models' | 'test' | 'remove') => {
    if (busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(action);
    setError('');
    setMessage('');
    try {
      if (action === 'remove') {
        await clearProviderApiKey(config);
        if (!mounted.current) return;
        setApiKey('');
        setHasKey(false);
        setMessage(_('API key removed.'));
        return;
      }
      const saved = await saveProviderConfig(config, apiKey || undefined);
      if (!mounted.current || controller.signal.aborted) return;
      setSavedProviders(getSavedProviderConfigs());
      setConfig(saved);
      setApiKey('');
      const status = await getProviderStatus(saved);
      if (!mounted.current || controller.signal.aborted) return;
      setHasKey(status.hasApiKey);
      if (action === 'models') {
        const result = await listProviderModels(saved, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        setModels(result);
        setMessage(
          result.length
            ? _('Choose a model below, or enter its name manually.')
            : _('No models returned. Enter a model name manually.'),
        );
      } else if (action === 'test') {
        await testProviderConnection(saved, controller.signal);
        if (mounted.current && !controller.signal.aborted)
          setMessage(_('Connection successful. This model is ready.'));
      } else {
        setMessage(_('Model service saved.'));
      }
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) {
        setError(
          cause instanceof ModelServiceError
            ? _(cause.message)
            : _('Unable to update model settings. Try again.'),
        );
      }
    } finally {
      if (mounted.current) setBusy(null);
      if (request.current === controller) request.current = null;
    }
  };

  return (
    <div className='my-4 w-full space-y-5' onKeyDown={(event) => event.stopPropagation()}>
      <div>
        <SectionTitle>{_('Model Service')}</SectionTitle>
        <p className='text-base-content/65 mt-2 text-sm leading-relaxed'>
          {_('Connect an OpenAI-compatible model service.')}
        </p>
      </div>

      <BoxedList>
        <SettingsRow label={_('Service')}>
          <SettingsSelect
            ariaLabel={_('Model service')}
            value={isCustom && !isSaved ? newCustomService : config.id}
            disabled={Boolean(busy)}
            onChange={(event) => selectProvider(event.target.value)}
            options={[
              ...builtinProviders.map((preset) => ({ value: preset.id, label: preset.name })),
              ...savedProviders
                .filter((provider) => !builtinProviders.some((preset) => preset.id === provider.id))
                .map((provider) => ({ value: provider.id, label: provider.name })),
              { value: newCustomService, label: _('Add custom service') },
            ]}
          />
        </SettingsRow>
        {isCustom && (
          <SettingsRow label={_('Service name')} asLabel>
            <SettingsInput
              aria-label={_('Service name')}
              value={config.name}
              maxLength={120}
              disabled={Boolean(busy)}
              onChange={(event) => updateConfig({ name: event.target.value })}
            />
          </SettingsRow>
        )}
        <SettingsRow
          label={_('API Base URL')}
          className='flex-col !items-stretch gap-1 py-3'
          asLabel
        >
          <SettingsInput
            aria-label={_('API Base URL')}
            type='url'
            value={config.baseUrl}
            placeholder='https://api.example.com/v1'
            className='!w-full !max-w-full !ps-0 !text-start text-sm'
            autoCapitalize='none'
            spellCheck={false}
            disabled={Boolean(busy)}
            onChange={(event) => updateConfig({ baseUrl: event.target.value })}
          />
        </SettingsRow>
        <SettingsRow label={_('API Key')} className='flex-col !items-stretch gap-1 py-3'>
          <div className='flex items-center gap-2'>
            <SettingsInput
              aria-label={_('API Key')}
              type='password'
              value={apiKey}
              placeholder={
                hasKey ? _('Key saved. Leave blank to keep it.') : _('Enter your API key')
              }
              className='!w-full !max-w-full !ps-0 !text-start text-sm'
              autoComplete='off'
              autoCapitalize='none'
              spellCheck={false}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setApiKey(event.target.value);
                setMessage('');
              }}
            />
            {hasKey && (
              <button
                type='button'
                className='glossa-button eink-bordered shrink-0 text-xs'
                disabled={Boolean(busy)}
                onClick={() => void run('remove')}
              >
                {_('Remove key')}
              </button>
            )}
          </div>
        </SettingsRow>
        <SettingsRow label={_('Model')} className='flex-col !items-stretch gap-1 py-3' asLabel>
          <SettingsInput
            aria-label={_('Model name')}
            value={config.model}
            placeholder={_('Enter a model name')}
            className='!w-full !max-w-full !ps-0 !text-start text-sm'
            autoCapitalize='none'
            spellCheck={false}
            disabled={Boolean(busy)}
            onChange={(event) => updateConfig({ model: event.target.value })}
          />
        </SettingsRow>
        {models.length > 0 && (
          <SettingsRow label={_('Available models')}>
            <SettingsSelect
              ariaLabel={_('Available models')}
              value={models.includes(config.model) ? config.model : ''}
              disabled={Boolean(busy)}
              options={[
                { value: '', label: _('Choose a model'), disabled: true },
                ...models.map((model) => ({ value: model, label: model })),
              ]}
              onChange={(event) => updateConfig({ model: event.target.value })}
            />
          </SettingsRow>
        )}
        {capabilities.reasoningEfforts.length > 0 && (
          <SettingsRow label={_('Reasoning effort')}>
            <SettingsSelect
              ariaLabel={_('Reasoning effort')}
              value={
                capabilities.reasoningEfforts.includes(config.reasoningEffort as ReasoningEffort)
                  ? (config.reasoningEffort as string)
                  : ''
              }
              disabled={Boolean(busy)}
              options={[
                { value: '', label: _('Service default') },
                ...capabilities.reasoningEfforts.map((effort) => ({
                  value: effort,
                  label: effortLabels[effort],
                })),
              ]}
              onChange={(event) =>
                updateConfig({
                  reasoningEffort: (event.target.value || undefined) as ReasoningEffort | undefined,
                })
              }
            />
          </SettingsRow>
        )}
        <SettingsRow label={_('Output limit')} asLabel>
          <SettingsInput
            aria-label={_('Output limit')}
            type='number'
            inputMode='numeric'
            min={1}
            max={65536}
            value={config.maxTokens ?? ''}
            placeholder={_('Service default')}
            disabled={Boolean(busy)}
            onChange={(event) => {
              const raw = event.target.value.trim();
              const parsed = raw ? Number(raw) : NaN;
              updateConfig({
                maxTokens:
                  Number.isInteger(parsed) && parsed >= 1 && parsed <= 65536 ? parsed : undefined,
              });
            }}
          />
        </SettingsRow>
      </BoxedList>

      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='button'
          className='glossa-button glossa-button-primary btn-contrast'
          disabled={Boolean(busy)}
          onClick={() => void run('save')}
        >
          {busy === 'save' ? _('Saving...') : _('Use this service')}
        </button>
        <button
          type='button'
          className='glossa-button eink-bordered'
          disabled={Boolean(busy)}
          onClick={() => void run('models')}
        >
          {busy === 'models' ? _('Fetching models...') : _('Fetch models')}
        </button>
        <button
          type='button'
          className='glossa-button eink-bordered'
          disabled={Boolean(busy) || !config.model.trim()}
          onClick={() => void run('test')}
        >
          {busy === 'test' ? _('Testing...') : _('Test connection')}
        </button>
        {(busy === 'models' || busy === 'test') && (
          <button
            type='button'
            className='glossa-button eink-bordered'
            onClick={() => request.current?.abort()}
          >
            {_('Cancel')}
          </button>
        )}
      </div>
      {error && (
        <p role='alert' className='text-error text-sm leading-relaxed'>
          {error}
        </p>
      )}
      {message && (
        <p role='status' className='text-base-content/70 text-sm leading-relaxed'>
          {message}
        </p>
      )}

      <Tips title={_('About this connection')}>
        <li>
          {isNative
            ? _('API keys are stored in your operating system keychain on this device.')
            : _(
                'In the browser, API keys last only for this session. Your service must allow browser connections.',
              )}
        </li>
        <li>
          {_(
            'Only the chapter you choose is sent when you generate notes. Connection tests send a short test message.',
          )}
        </li>
        <li>
          {_(
            'The API base usually ends in /v1. Local Ollama can use http://localhost:11434/v1 without a key.',
          )}
        </li>
      </Tips>
    </div>
  );
};

export default ModelSettingsPanel;
