import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const clear = () => {
    clearTimeout(timer.current);
  };
  const close = () => {
    clear();
    setOpen(false);
  };
  const leave = () => {
    clear();
    timer.current = setTimeout(() => setOpen(false), 180);
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
  }, [open]);

  const usage = answer.usage;
  const costs = usage && sumReplyCosts(usage);
  const total = usage && sumReplyTokens(usage, 'totalTokens');
  const output = usage && sumReplyTokens(usage, 'outputTokens');
  const speed =
    usage && usage.elapsedMs > 0 && output && !output.partial
      ? output.value / (usage.elapsedMs / 1000)
      : undefined;
  const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const duration = (value: number) => `${number(value / 1000)} ${_('s')}`;
  const amount = (value: number) =>
    value > 0 && value < 0.00000001
      ? value.toExponential(3)
      : value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
  const tokens = (key: keyof TokenUsage) => {
    const sum = usage && sumReplyTokens(usage, key);
    return sum ? `${sum.partial ? '≥ ' : ''}${number(sum.value)}` : _('Not provided');
  };
  const summary = total
    ? `${total.partial ? '≥ ' : ''}${number(total.value)} Tokens${speed !== undefined ? ` · ${number(speed)} ${_('Token/s')}` : ''}`
    : usage
      ? `${duration(usage.elapsedMs)} · ${_('Usage')}`
      : _('Usage');
  const requests = usage?.requests ?? [];
  const createdAt = new Date(answer.createdAt);
  return (
    <>
      <button
        ref={trigger}
        type='button'
        dir='auto'
        className='glossa-chat-usage-trigger'
        aria-label={_('Reply usage')}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => {
          clear();
          timer.current = setTimeout(show, 180);
        }}
        onMouseLeave={leave}
        onFocus={show}
        onBlur={leave}
        onClick={show}
      >
        {summary}
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role='tooltip'
            className='glossa-chat-usage-popup eink-bordered'
            style={position}
            onMouseEnter={clear}
            onMouseLeave={leave}
          >
            <header>
              <strong dir='auto'>{answer.provider.model}</strong>
              <span dir='auto'>{answer.provider.name}</span>
              {Number.isFinite(createdAt.getTime()) && (
                <time dir='auto' dateTime={createdAt.toISOString()}>
                  {createdAt.toLocaleString()}
                </time>
              )}
            </header>
            {usage ? (
              <>
                <dl className='glossa-chat-usage-tokens'>
                  <div>
                    <dt>{_('Input tokens')}</dt>
                    <dd dir='auto'>{tokens('inputTokens')}</dd>
                  </div>
                  <div>
                    <dt>{_('Output tokens')}</dt>
                    <dd dir='auto'>{tokens('outputTokens')}</dd>
                  </div>
                </dl>
                <dl className='glossa-chat-usage-cost'>
                  <dt>{_('Cost')}</dt>
                  <dd>
                    {costs ? (
                      <>
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
                      </>
                    ) : (
                      _('Not provided')
                    )}
                  </dd>
                </dl>
                <dl className='glossa-chat-usage-details'>
                  <div>
                    <dt>{_(requests.length > 1 ? 'Combined output limit' : 'Output limit')}</dt>
                    <dd dir='auto'>
                      {requests.length
                        ? `${number(requests.reduce((sum, item) => sum + item.outputBudget, 0))} Tokens`
                        : _('Not provided')}
                    </dd>
                  </div>
                  <div>
                    <dt>{_('Model requests')}</dt>
                    <dd dir='auto'>{number(requests.length)}</dd>
                  </div>
                  <div>
                    <dt>{_('Reasoning tokens')}</dt>
                    <dd dir='auto'>{tokens('reasoningTokens')}</dd>
                  </div>
                  <div>
                    <dt>{_('Cache read tokens')}</dt>
                    <dd dir='auto'>{tokens('cachedTokens')}</dd>
                  </div>
                  <div>
                    <dt>{_('Time to first text')}</dt>
                    <dd dir='auto'>
                      {usage.firstTextMs === undefined
                        ? _('Not provided')
                        : duration(usage.firstTextMs)}
                    </dd>
                  </div>
                  <div>
                    <dt>{_('Total time')}</dt>
                    <dd dir='auto'>{duration(usage.elapsedMs)}</dd>
                  </div>
                  <div>
                    <dt>{_('End-to-end throughput')}</dt>
                    <dd dir='auto'>
                      {speed === undefined ? _('Not provided') : `${number(speed)} ${_('Token/s')}`}
                    </dd>
                  </div>
                  {requests.some((item) => item.usage?.totalTokens === undefined) && (
                    <div>
                      <dt>{_('Usage reported')}</dt>
                      <dd dir='auto'>
                        {requests.filter((item) => item.usage?.totalTokens !== undefined).length}/
                        {requests.length}
                      </dd>
                    </div>
                  )}
                </dl>
              </>
            ) : (
              <p>{_('Usage was not recorded for this reply.')}</p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
