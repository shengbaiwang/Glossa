import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import {
  activateProviderConfig,
  getCachedProviderModels,
  getProviderModelConfig,
  getProviderModels,
  getSavedProviderConfigs,
  isProviderEnabled,
  listProviderModels,
  setProviderModelFavorite,
  ModelServiceError,
  type ProviderConfig,
  type ProviderPurpose,
} from '@/glossa/ai/provider';

interface Props {
  config: ProviderConfig | null;
  ready: boolean;
  openSettings: () => void;
  purpose?: ProviderPurpose;
}
export default function ConversationModelPicker({
  config,
  ready,
  openSettings,
  purpose = 'conversation',
}: Props) {
  const _ = useTranslation();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(config);
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [, setRevision] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const discovery = useRef<AbortController | null>(null);
  const configs = getSavedProviderConfigs().filter((item) => isProviderEnabled(item.id));
  const available = configs.length ? configs : config ? [config] : [];
  const profiles = selected ? getProviderModels(selected) : [];

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      discovery.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!open) {
      discovery.current?.abort();
      return;
    }
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    discovery.current?.abort();
    setLoading(false);
    setError('');
    // Opening or changing the service reads only local model metadata.
    setModels(selected ? (getCachedProviderModels(selected)?.models ?? []) : []);
  }, [selected?.id, selected?.baseUrl]);

  const refresh = async () => {
    if (!selected || loading) return;
    discovery.current?.abort();
    const controller = new AbortController();
    discovery.current = controller;
    setLoading(true);
    setError('');
    try {
      const values = await listProviderModels(selected, controller.signal);
      if (mounted.current && !controller.signal.aborted) setModels(values);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted)
        setError(
          cause instanceof ModelServiceError ? cause.message : 'Unable to fetch models. Try again.',
        );
    } finally {
      if (mounted.current && discovery.current === controller) setLoading(false);
    }
  };
  const choose = async (model: string) => {
    if (!selected || !model.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await activateProviderConfig(getProviderModelConfig(selected, model.trim()), purpose);
      if (mounted.current) {
        setOpen(false);
        trigger.current?.focus();
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof ModelServiceError
            ? cause.message
            : 'Unable to save model settings on this device.',
        );
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  const favorite = (model: string) => {
    if (!selected) return;
    try {
      setProviderModelFavorite(
        selected,
        model,
        !profiles.find((profile) => profile.model === model)?.favorite,
      );
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof ModelServiceError
          ? cause.message
          : 'Unable to save model settings on this device.',
      );
    }
  };
  const filtered = [
    ...new Set([...profiles.map((profile) => profile.model), selected?.model ?? '', ...models]),
  ]
    .filter((model) => model && model.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      const first = profiles.find((profile) => profile.model === a);
      const second = profiles.find((profile) => profile.model === b);
      return (
        Number(Boolean(second?.favorite)) - Number(Boolean(first?.favorite)) ||
        (second?.lastUsedAt ?? 0) - (first?.lastUsedAt ?? 0) ||
        a.localeCompare(b)
      );
    });

  return (
    <div
      className='glossa-chat-model-picker'
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type='button'
        className='glossa-chat-model'
        aria-label={_('Choose model')}
        aria-expanded={open}
        onClick={() => {
          const next = config ?? available[0];
          if (!next) {
            openSettings();
            return;
          }
          setSelected(next);
          setQuery('');
          setOpen(!open);
        }}
      >
        <span>{config?.model || _('Set up a model')}</span>
        {!ready && config && (
          <span className='glossa-chat-setup-dot' aria-label={_('Setup needed')} />
        )}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className='glossa-chat-model-menu eink-bordered'
          role='dialog'
          aria-label={_('Choose model')}
        >
          <div className='glossa-chat-menu-heading'>
            <select
              aria-label={_('Model service')}
              value={selected?.id ?? ''}
              disabled={saving || loading}
              onChange={(event) => {
                setSelected(available.find((item) => item.id === event.target.value) ?? null);
                setQuery('');
              }}
            >
              {available.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              type='button'
              className='glossa-chat-text-button'
              aria-label={_('Close')}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </div>
          <input
            ref={search}
            className='eink-bordered'
            aria-label={_('Search or enter model')}
            placeholder={_('Search or enter model')}
            value={query}
            maxLength={240}
            disabled={saving}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault();
                event.stopPropagation();
                if (query.trim()) void choose(query);
              }
            }}
          />
          <div className='glossa-chat-model-options' aria-busy={loading || saving}>
            {filtered.map((model) => (
              <div key={model} className='flex min-w-0 items-center'>
                <button
                  type='button'
                  className='min-w-0 flex-1'
                  disabled={saving}
                  onClick={() => void choose(model)}
                >
                  <span className='min-w-0 break-all'>{model}</span>
                  {model === config?.model && selected?.id === config.id && <Check size={14} />}
                </button>
                <button
                  type='button'
                  className='!w-11 shrink-0 !justify-center'
                  aria-label={_('Favorite model') + ': ' + model}
                  aria-pressed={Boolean(
                    profiles.find((profile) => profile.model === model)?.favorite,
                  )}
                  disabled={saving}
                  onClick={() => favorite(model)}
                >
                  {profiles.find((profile) => profile.model === model)?.favorite ? '★' : '☆'}
                </button>
              </div>
            ))}
            {query.trim() && !filtered.includes(query.trim()) && (
              <button type='button' disabled={saving} onClick={() => void choose(query)}>
                <span>{query.trim()}</span>
                <Check size={14} />
              </button>
            )}
          </div>
          {error && (
            <p className='glossa-chat-message' role='alert'>
              {_(error)}
            </p>
          )}
          <button
            type='button'
            className='glossa-chat-manage-models'
            disabled={loading || saving}
            onClick={() => void refresh()}
          >
            {loading ? _('Fetching models...') : _('Refresh models')}
          </button>
          <button
            type='button'
            className='glossa-chat-manage-models'
            onClick={() => {
              setOpen(false);
              openSettings();
            }}
          >
            <SlidersHorizontal size={16} />
            {_('Model settings')}
          </button>
        </div>
      )}
    </div>
  );
}
