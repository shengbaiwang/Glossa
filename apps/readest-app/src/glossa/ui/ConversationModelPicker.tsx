import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal, X } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getSavedProviderConfigs,
  listProviderModels,
  saveProviderConfig,
  ModelServiceError,
  type ProviderConfig,
} from '@/glossa/ai/provider';

interface Props {
  config: ProviderConfig | null;
  ready: boolean;
  openSettings: () => void;
}
export default function ConversationModelPicker({ config, ready, openSettings }: Props) {
  const _ = useTranslation();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(config);
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const configs = getSavedProviderConfigs();
  const available = configs.length ? configs : config ? [config] : [];
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (!open || !selected) return;
    const controller = new AbortController();
    setModels([]);
    setError('');
    setLoading(true);
    void listProviderModels(selected, controller.signal)
      .then((values) => {
        if (!controller.signal.aborted) setModels(values);
      })
      .catch(() => {
        // A manually entered model remains usable when /models is unsupported.
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, selected]);
  const choose = async (model: string) => {
    if (!selected || !model.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      await saveProviderConfig({ ...selected, model: model.trim() });
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
  const filtered = [...new Set([selected?.model ?? '', ...models])].filter(
    (model) => model && model.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className='glossa-chat-model-picker'
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
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
          if (!config) {
            openSettings();
            return;
          }
          setSelected(config);
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
              disabled={saving}
              onChange={(e) => {
                setSelected(available.find((c) => c.id === e.target.value) ?? null);
                setQuery('');
              }}
            >
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229
              ) {
                e.preventDefault();
                e.stopPropagation();
                if (query.trim()) void choose(query);
              }
            }}
          />
          <div className='glossa-chat-model-options' aria-busy={loading || saving}>
            {filtered.map((model) => (
              <button
                type='button'
                key={model}
                disabled={saving}
                onClick={() => void choose(model)}
              >
                <span>{model}</span>
                {model === config?.model && selected?.id === config.id && <Check size={15} />}
              </button>
            ))}
            {query.trim() && !filtered.includes(query.trim()) && (
              <button type='button' disabled={saving} onClick={() => void choose(query)}>
                <span>{query.trim()}</span>
                <Check size={15} />
              </button>
            )}
            {loading && (
              <span className='glossa-chat-pending' role='status'>
                {_('Loading…')}
              </span>
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
            onClick={() => {
              setOpen(false);
              openSettings();
            }}
          >
            <SlidersHorizontal size={15} />
            {_('Model settings')}
          </button>
        </div>
      )}
    </div>
  );
}
