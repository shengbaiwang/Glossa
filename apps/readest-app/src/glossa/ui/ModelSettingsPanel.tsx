import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  BoxedList,
  SectionTitle,
  SettingsInput,
  SettingsRow,
  SettingsSelect,
  SettingsSwitchRow,
} from '@/components/settings/primitives';
import {
  activateProviderConfig,
  clearProviderApiKey,
  deleteProviderConfig,
  getActiveProviderConfig,
  getCachedProviderModels,
  getProviderModelConfig,
  getProviderModels,
  getProviderStatus,
  getSavedProviderConfigs,
  isProviderEnabled,
  listProviderModels,
  ModelServiceError,
  PROVIDER_PRESETS,
  providerCapabilities,
  REASONING_EFFORTS,
  removeProviderModel,
  saveProviderConfig,
  setProviderEnabled,
  setProviderModelFavorite,
  testProviderConnection,
  type ProviderConfig,
  type ProviderPurpose,
  type ReasoningEffort,
} from '../ai/provider';

const builtinProviders = PROVIDER_PRESETS.filter((preset) => preset.id !== 'custom');
const newCustomService = 'new-custom';
type Action = 'save' | 'models' | 'test' | 'remove' | 'delete' | ProviderPurpose;
const cachedModels = (config: ProviderConfig) => {
  try {
    return getCachedProviderModels(config)?.models ?? [];
  } catch {
    return [];
  }
};

const ModelSettingsPanel: React.FC = () => {
  const _ = useTranslation();
  const [savedProviders, setSavedProviders] = useState(getSavedProviderConfigs);
  const [config, setConfig] = useState<ProviderConfig>(
    () => getActiveProviderConfig() ?? getSavedProviderConfigs()[0] ?? { ...PROVIDER_PRESETS[0]! },
  );
  const [apiKey, setApiKey] = useState('');
  const [credentialStatus, setCredentialStatus] = useState('missing');
  const [models, setModels] = useState<string[]>(() => cachedModels(config));
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const isCustom = !builtinProviders.some((preset) => preset.id === config.id);
  const isSaved = savedProviders.some((provider) => provider.id === config.id);
  const capabilities = providerCapabilities(config);
  const profiles = isSaved ? getProviderModels(config) : [];
  const effortLabels: Record<ReasoningEffort, string> = {
    none: _('None'),
    minimal: _('Minimal'),
    low: _('Low'),
    medium: _('Medium'),
    high: _('High'),
    xhigh: _('Extra high'),
    max: _('Max'),
  };
  const refreshSaved = () => setSavedProviders(getSavedProviderConfigs());
  const showError = (cause: unknown) => {
    setError(
      cause instanceof ModelServiceError
        ? _(cause.message)
        : _('Unable to update model settings. Try again.'),
    );
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
    setCredentialStatus('missing');
    if (config.baseUrl) {
      // This is an attribute-only query. Model/name edits never request a credential.
      getProviderStatus(config)
        .then((status) => {
          if (current)
            setCredentialStatus(
              status.credentialStatus ?? (status.hasApiKey ? 'present' : 'missing'),
            );
        })
        .catch(() => {
          if (current) setCredentialStatus('unavailable');
        });
    }
    return () => {
      current = false;
    };
  }, [config.id, config.baseUrl]);

  const updateConfig = (update: Partial<ProviderConfig>) => {
    setConfig((current) => ({ ...current, ...update }));
    setMessage('');
    setError('');
    if (update.baseUrl !== undefined) setModels([]);
  };
  const updateCapabilities = (update: NonNullable<ProviderConfig['capabilityOverrides']>) =>
    updateConfig({ capabilityOverrides: { ...config.capabilityOverrides, ...update } });

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
    setModels(cachedModels(next));
    setMessage('');
    setError('');
    setConfirmDelete(false);
  };

  const run = async (action: Action) => {
    if (busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(action);
    setError('');
    setMessage('');
    try {
      if (action === 'models') {
        const result = await listProviderModels(config, controller.signal, {
          apiKey: apiKey || undefined,
        });
        if (!mounted.current || controller.signal.aborted) return;
        setModels(result);
        setMessage(
          result.length
            ? _('Choose a model below, or enter its name manually.')
            : _('No models returned. Enter a model name manually.'),
        );
      } else if (action === 'test') {
        await testProviderConnection(config, controller.signal, apiKey || undefined);
        if (mounted.current && !controller.signal.aborted)
          setMessage(_('Chat connection successful.'));
      } else if (action === 'remove') {
        await clearProviderApiKey(config);
        if (!mounted.current) return;
        setApiKey('');
        setCredentialStatus('missing');
        setMessage(_('API key removed.'));
      } else if (action === 'delete') {
        await deleteProviderConfig(
          getSavedProviderConfigs().find((saved) => saved.id === config.id) ?? config,
        );
        if (!mounted.current) return;
        refreshSaved();
        selectProvider(getSavedProviderConfigs()[0]?.id ?? builtinProviders[0]!.id);
        setMessage(_('Model service deleted.'));
      } else {
        const saved = await saveProviderConfig(config, apiKey || undefined);
        if (!mounted.current || controller.signal.aborted) return;
        if (action !== 'save') await activateProviderConfig(saved, action);
        if (!mounted.current || controller.signal.aborted) return;
        refreshSaved();
        setConfig(saved);
        if (apiKey.trim()) setCredentialStatus('present');
        setApiKey('');
        setMessage(action === 'save' ? _('Model service saved.') : _('Default model updated.'));
      }
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) showError(cause);
    } finally {
      if (mounted.current) setBusy(null);
      if (request.current === controller) request.current = null;
    }
  };

  const editProfile = (model: string) => {
    setConfig(getProviderModelConfig(config, model));
    setMessage('');
    setError('');
  };
  const modelAction = (action: () => void) => {
    try {
      action();
      refreshSaved();
      setError('');
    } catch (cause) {
      showError(cause);
    }
  };

  return (
    <div
      className='my-4 w-full space-y-5 [&_button]:!min-h-11'
      data-setting-id='settings.plugins.models'
      onKeyDown={(event) => event.stopPropagation()}
    >
      <SectionTitle>{_('Model Service')}</SectionTitle>
      <BoxedList>
        <SettingsRow label={_('Service')}>
          <SettingsSelect
            ariaLabel={_('Model service')}
            value={isCustom && !isSaved ? newCustomService : config.id}
            disabled={Boolean(busy)}
            onChange={(event) => selectProvider(event.target.value)}
            options={[
              ...builtinProviders.map((preset) => ({
                value: preset.id,
                label:
                  savedProviders.find((provider) => provider.id === preset.id)?.name ?? preset.name,
              })),
              ...savedProviders
                .filter((provider) => !builtinProviders.some((preset) => preset.id === provider.id))
                .map((provider) => ({ value: provider.id, label: provider.name })),
              { value: newCustomService, label: _('Add custom service') },
            ]}
          />
        </SettingsRow>
        {isSaved && (
          <SettingsSwitchRow
            label={_('Enable service')}
            checked={isProviderEnabled(config.id)}
            disabled={Boolean(busy)}
            onChange={() =>
              modelAction(() => setProviderEnabled(config.id, !isProviderEnabled(config.id)))
            }
          />
        )}
        <SettingsRow label={_('Service name')} asLabel>
          <SettingsInput
            aria-label={_('Service name')}
            value={config.name}
            maxLength={120}
            disabled={Boolean(busy)}
            onChange={(event) => updateConfig({ name: event.target.value })}
          />
        </SettingsRow>
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
                credentialStatus === 'present'
                  ? _('Key saved. Leave blank to keep it.')
                  : credentialStatus === 'unavailable'
                    ? _('Authorization may be needed when connecting.')
                    : _('Enter your API key')
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
            {credentialStatus !== 'missing' && (
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
      </BoxedList>

      {profiles.length > 0 && (
        <div>
          <SectionTitle>{_('Saved models')}</SectionTitle>
          <BoxedList>
            {profiles.map((profile) => (
              <SettingsRow
                key={profile.model}
                label={
                  <button
                    type='button'
                    className='min-h-11 max-w-full break-all text-start'
                    aria-pressed={config.model === profile.model}
                    disabled={Boolean(busy)}
                    onClick={() => editProfile(profile.model)}
                  >
                    {profile.model}
                  </button>
                }
              >
                <div className='flex shrink-0 gap-1'>
                  <button
                    type='button'
                    className='glossa-button eink-bordered min-h-11'
                    aria-label={_('Favorite model') + ': ' + profile.model}
                    aria-pressed={profile.favorite}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      modelAction(() =>
                        setProviderModelFavorite(config, profile.model, !profile.favorite),
                      )
                    }
                  >
                    {profile.favorite ? '★' : '☆'}
                  </button>
                  <button
                    type='button'
                    className='glossa-button eink-bordered min-h-11'
                    aria-label={_('Remove model') + ': ' + profile.model}
                    disabled={Boolean(busy)}
                    onClick={() => modelAction(() => removeProviderModel(config, profile.model))}
                  >
                    {_('Remove')}
                  </button>
                </div>
              </SettingsRow>
            ))}
          </BoxedList>
        </div>
      )}

      <BoxedList>
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
              onChange={(event) => editProfile(event.target.value)}
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

      <details>
        <summary className='min-h-11 cursor-pointer py-3 text-sm'>
          {_('Model capabilities')}
        </summary>
        <BoxedList>
          <SettingsRow label={_('Output token parameter')}>
            <SettingsSelect
              ariaLabel={_('Output token parameter')}
              value={config.capabilityOverrides?.maxTokensParam ?? ''}
              disabled={Boolean(busy)}
              options={[
                { value: '', label: _('Automatic') },
                { value: 'max_tokens', label: 'max_tokens' },
                { value: 'max_completion_tokens', label: 'max_completion_tokens' },
              ]}
              onChange={(event) =>
                updateCapabilities({
                  maxTokensParam: (event.target.value || undefined) as
                    | 'max_tokens'
                    | 'max_completion_tokens'
                    | undefined,
                })
              }
            />
          </SettingsRow>
          {(['tools', 'json'] as const).map((capability) => (
            <SettingsRow
              key={capability}
              label={capability === 'tools' ? _('Reading tools') : _('JSON output')}
            >
              <SettingsSelect
                ariaLabel={capability === 'tools' ? _('Reading tools') : _('JSON output')}
                value={
                  config.capabilityOverrides?.[capability] === undefined
                    ? ''
                    : String(config.capabilityOverrides[capability])
                }
                disabled={Boolean(busy)}
                options={[
                  { value: '', label: _('Automatic') },
                  { value: 'true', label: _('Supported') },
                  { value: 'false', label: _('Unsupported') },
                ]}
                onChange={(event) =>
                  updateCapabilities({
                    [capability]:
                      event.target.value === '' ? undefined : event.target.value === 'true',
                  })
                }
              />
            </SettingsRow>
          ))}
          <SettingsRow label={_('Reasoning levels')} className='flex-col !items-stretch gap-1 py-3'>
            <SettingsSelect
              ariaLabel={_('Reasoning levels')}
              value={config.capabilityOverrides?.reasoningEfforts === undefined ? 'auto' : 'custom'}
              disabled={Boolean(busy)}
              options={[
                { value: 'auto', label: _('Automatic') },
                { value: 'custom', label: _('Custom') },
              ]}
              onChange={(event) =>
                updateCapabilities({
                  reasoningEfforts: event.target.value === 'auto' ? undefined : [],
                })
              }
            />
            {config.capabilityOverrides?.reasoningEfforts !== undefined && (
              <div className='flex flex-wrap gap-x-4'>
                {REASONING_EFFORTS.map((effort) => (
                  <label
                    key={effort}
                    className='flex min-h-11 cursor-pointer items-center gap-2 text-sm'
                  >
                    <input
                      type='checkbox'
                      className='checkbox checkbox-sm eink-bordered'
                      checked={config.capabilityOverrides!.reasoningEfforts!.includes(effort)}
                      disabled={Boolean(busy)}
                      onChange={(event) =>
                        updateCapabilities({
                          reasoningEfforts: event.target.checked
                            ? [...config.capabilityOverrides!.reasoningEfforts!, effort]
                            : config.capabilityOverrides!.reasoningEfforts!.filter(
                                (value) => value !== effort,
                              ),
                        })
                      }
                    />
                    {effortLabels[effort]}
                  </label>
                ))}
              </div>
            )}
          </SettingsRow>
        </BoxedList>
      </details>

      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='button'
          className='glossa-button glossa-button-primary btn-contrast'
          disabled={Boolean(busy)}
          onClick={() => void run('save')}
        >
          {busy === 'save' ? _('Saving...') : _('Save service')}
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
      <div className='flex flex-wrap items-center gap-2'>
        {(['conversation', 'mindmap'] as const).map((purpose) => {
          const active = getActiveProviderConfig(purpose);
          const current =
            active?.id === config.id &&
            active.model === config.model &&
            active.baseUrl === config.baseUrl;
          return (
            <button
              key={purpose}
              type='button'
              className='glossa-button eink-bordered'
              aria-label={
                purpose === 'conversation' ? _('Use for conversation') : _('Use for mind maps')
              }
              aria-pressed={current}
              disabled={
                Boolean(busy) || !config.model.trim() || (isSaved && !isProviderEnabled(config.id))
              }
              onClick={() => void run(purpose)}
            >
              {current ? '✓ ' : ''}
              {purpose === 'conversation' ? _('Use for conversation') : _('Use for mind maps')}
            </button>
          );
        })}
      </div>
      {isSaved && (
        <div className='flex flex-wrap items-center gap-2'>
          {confirmDelete ? (
            <>
              <span className='text-sm'>{_('Delete this service and its saved key?')}</span>
              <button
                type='button'
                className='glossa-button eink-bordered'
                disabled={Boolean(busy)}
                onClick={() => void run('delete')}
              >
                {_('Delete')}
              </button>
              <button
                type='button'
                className='glossa-button eink-bordered'
                disabled={Boolean(busy)}
                onClick={() => setConfirmDelete(false)}
              >
                {_('Cancel')}
              </button>
            </>
          ) : (
            <button
              type='button'
              className='glossa-button eink-bordered'
              disabled={Boolean(busy)}
              onClick={() => setConfirmDelete(true)}
            >
              {_('Delete service')}
            </button>
          )}
        </div>
      )}
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
    </div>
  );
};

export default ModelSettingsPanel;
