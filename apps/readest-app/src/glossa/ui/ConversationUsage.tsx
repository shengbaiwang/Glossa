import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import type { AnswerVersion } from '@/glossa/conversation/schema';
import { sumReplyCosts, sumReplyTokens } from '@/glossa/conversation/usage';
import type { TokenUsage } from '@/glossa/ai/usage';

/** Optional usage stays out of the reading flow until hovered, focused or tapped. */
export default function ConversationUsage({ answer }: { answer: AnswerVersion }) {
  const _ = useTranslation();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const clear = () => {
    clearTimeout(timer.current);
  };
  const close = () => {
    clear();
    setOpen(false);
    setExpanded(false);
  };
  const leave = () => {
    clear();
    timer.current = setTimeout(close, 180);
  };
  const show = () => {
    clear();
    setOpen(true);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (popup.current?.contains(document.activeElement)) trigger.current?.focus();
        close();
      }
    };
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        (popup.current?.contains(event.target) || trigger.current?.contains(event.target))
      )
        return;
      close();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const target = trigger.current.getBoundingClientRect();
    const bounds = popup.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        12,
        Math.min(target.right - bounds.width, window.innerWidth - bounds.width - 12),
      ),
      top: Math.max(
        12,
        target.top >= bounds.height + 20
          ? target.top - bounds.height - 8
          : Math.min(target.bottom + 8, window.innerHeight - bounds.height - 12),
      ),
    });
  }, [open, expanded, answer.id]);

  const usage = answer.usage;
  const costs = usage && sumReplyCosts(usage);
  const total = usage && sumReplyTokens(usage, 'totalTokens');
  const output = usage && sumReplyTokens(usage, 'outputTokens');
  const speed =
    usage && usage.elapsedMs > 0 && output && !output.partial
      ? output.value / (usage.elapsedMs / 1000)
      : undefined;
  const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const duration = (value: number) => {
    if (value < 1000) return `${Math.round(value)} ${_('ms')}`;
    const seconds = Math.round(value / 100) / 10;
    const minutes = Math.floor(seconds / 60);
    return `${minutes ? `${number(minutes)} ${_('min')} ` : ''}${number(seconds % 60)} ${_('s')}`;
  };
  const amount = (value: number) =>
    value > 0 && value < 0.00000001
      ? value.toExponential(3)
      : value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
  const tokens = (key: keyof TokenUsage) => {
    const sum = usage && sumReplyTokens(usage, key);
    return sum ? `${sum.partial ? '≥ ' : ''}${number(sum.value)}` : undefined;
  };
  const summary = total
    ? `${total.partial ? '≥ ' : ''}${number(total.value)} Tokens${speed !== undefined ? ` · ${number(speed)} ${_('Token/s')}` : ''}`
    : usage
      ? `${duration(usage.elapsedMs)} · ${_('Usage')}`
      : _('Usage');
  const requests = usage?.requests ?? [];
  const createdAt = new Date(answer.createdAt);
  if (!usage) return null;
  const primary = [
    { label: _('Input'), value: tokens('inputTokens'), unit: 'Tokens' },
    { label: _('Output'), value: tokens('outputTokens'), unit: 'Tokens' },
    {
      label: _('End-to-end throughput'),
      value: speed === undefined ? undefined : number(speed),
      unit: _('Token/s'),
    },
  ].filter((item) => item.value !== undefined);
  const details = [
    { label: _('Reasoning tokens'), value: tokens('reasoningTokens'), unit: 'Tokens' },
    { label: _('Cache read tokens'), value: tokens('cachedTokens'), unit: 'Tokens' },
    {
      label: _('Time to first text'),
      value: usage.firstTextMs === undefined ? undefined : duration(usage.firstTextMs),
    },
    { label: _('Total time'), value: duration(usage.elapsedMs) },
  ].filter((item) => item.value !== undefined);
  return (
    <>
      <button
        ref={trigger}
        type='button'
        dir='auto'
        className='glossa-chat-usage-trigger'
        aria-label={_('Reply usage')}
        aria-haspopup='dialog'
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onMouseEnter={() => {
          clear();
          timer.current = setTimeout(show, 180);
        }}
        onMouseLeave={leave}
        onFocus={show}
        onBlur={leave}
        onClick={show}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'Enter', ' '].includes(event.key)) return;
          event.preventDefault();
          show();
          requestAnimationFrame(() => popup.current?.querySelector('button')?.focus());
        }}
      >
        {summary}
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role='dialog'
            aria-label={_('Reply usage')}
            className='glossa-chat-usage-popup eink-bordered'
            style={position}
            onMouseEnter={clear}
            onMouseLeave={() => {
              if (!popup.current?.contains(document.activeElement)) leave();
            }}
            onFocusCapture={clear}
            onBlurCapture={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                event.relatedTarget !== trigger.current
              )
                leave();
            }}
          >
            <header>
              <div>
                <strong dir='auto'>{answer.provider.model}</strong>
                <span dir='auto'>{answer.provider.name}</span>
              </div>
              {Number.isFinite(createdAt.getTime()) && (
                <time dir='auto' dateTime={createdAt.toISOString()}>
                  {createdAt.toLocaleDateString()}
                  <br />
                  {createdAt.toLocaleTimeString()}
                </time>
              )}
            </header>
            {primary.length > 0 && (
              <dl className='glossa-chat-usage-tokens' data-columns={primary.length}>
                {primary.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd dir='auto'>
                      {item.value} <small>{item.unit}</small>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {costs && (
              <dl className='glossa-chat-usage-cost'>
                <dt>{_('Cost')}</dt>
                <dd>
                  <span>{_('Provider charge')}</span>
                  {costs.totals.map((cost) => (
                    <span key={cost.currency ?? 'unknown'} dir='auto'>
                      {costs.partial ? '≥ ' : ''}
                      {cost.currency === 'USD' ? 'US$' : ''}
                      {amount(cost.amount)}
                      {!cost.currency && ` · ${_('Currency not provided')}`}
                    </span>
                  ))}
                  {costs.partial && (
                    <span>
                      {_('Cost reported')} {costs.reported}/{requests.length}
                    </span>
                  )}
                </dd>
              </dl>
            )}
            <dl className='glossa-chat-usage-details'>
              {details.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd dir='auto'>
                    {item.value}
                    {item.unit ? ` ${item.unit}` : ''}
                  </dd>
                </div>
              ))}
            </dl>
            {requests.length > 0 && (
              <div className='glossa-chat-usage-more'>
                <button
                  type='button'
                  aria-expanded={expanded}
                  aria-controls={`${id}-more`}
                  onClick={() => setExpanded(!expanded)}
                >
                  {_('More information')}
                  <ChevronDown size={16} aria-hidden='true' />
                </button>
                {expanded && (
                  <dl id={`${id}-more`}>
                    <div>
                      <dt>{_(requests.length > 1 ? 'Combined output limit' : 'Output limit')}</dt>
                      <dd dir='auto'>
                        {number(requests.reduce((sum, item) => sum + item.outputBudget, 0))} Tokens
                      </dd>
                    </div>
                    <div>
                      <dt>{_('Model requests')}</dt>
                      <dd dir='auto'>{number(requests.length)}</dd>
                    </div>
                    {total?.partial && (
                      <div>
                        <dt>{_('Usage reported')}</dt>
                        <dd dir='auto'>
                          {requests.filter((item) => item.usage?.totalTokens !== undefined).length}/
                          {requests.length}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
