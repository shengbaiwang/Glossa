import clsx from 'clsx';
import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

const DeleteConfirmAlert: React.FC<{
  title: string;
  message: string;
  books?: { hash: string; title: string }[];
  scope?: string;
  details?: string;
  selectionLabel?: string;
  confirmLabel?: string;
  destructive?: boolean;
  showPurgeToggle?: boolean;
  onCancel: () => void;
  onStop?: () => void;
  onConfirm: (purgeData: boolean) => void | Promise<void>;
}> = ({
  title,
  message,
  books,
  scope,
  details,
  selectionLabel,
  confirmLabel,
  destructive = false,
  showPurgeToggle = false,
  onCancel,
  onStop,
  onConfirm,
}) => {
  const _ = useTranslation();
  const titleId = useId(),
    messageId = useId();
  const [purgeData, setPurgeData] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(false);
  const [stopping, setStopping] = useState(false);
  const busy = useRef(false),
    root = useRef<HTMLDivElement>(null),
    cancel = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => {
      mounted.current = false;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const confirm = async () => {
    if (busy.current) return;
    busy.current = true;
    setProcessing(true);
    setError(false);
    setStopping(false);
    try {
      await onConfirm(purgeData);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      busy.current = false;
      if (mounted.current) setProcessing(false);
    }
  };
  const cancelOrStop = () => {
    if (!busy.current) onCancel();
    else if (onStop && !stopping) {
      setStopping(true);
      onStop();
    }
  };
  return (
    <div
      ref={root}
      role='alertdialog'
      aria-modal='true'
      aria-labelledby={titleId}
      aria-describedby={messageId}
      aria-busy={processing}
      tabIndex={-1}
      className='glossa-dialog-card glossa-removal-dialog eink-bordered mx-4 flex w-full flex-col'
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelOrStop();
        }
        if (event.key !== 'Tab') return;
        const items = [
          ...(root.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), summary',
          ) ?? []),
        ];
        const first = items[0],
          last = items.at(-1);
        if (!first) {
          event.preventDefault();
          root.current?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <h3 id={titleId} className='glossa-dialog-title'>
        {title}
      </h3>
      {!!books?.length && (
        <div className='glossa-removal-targets'>
          {(selectionLabel || books.length > 1) && (
            <p className='glossa-removal-caption'>
              {selectionLabel ?? _('Selected {{count}}', { count: books.length })}
            </p>
          )}
          <ul className='max-h-32 overflow-auto'>
            {books.map((b) => (
              <li key={b.hash} className='break-words'>
                {b.title}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className='glossa-removal-description'>
        <p id={messageId}>{message}</p>
        {scope && <p className='glossa-removal-caption'>{scope}</p>}
      </div>
      {details && (
        <details className='glossa-removal-details'>
          <summary>{_('Deletion details')}</summary>
          <p>{details}</p>
        </details>
      )}
      {showPurgeToggle && (
        <label className='eink-bordered flex items-center gap-3 rounded-lg border p-3'>
          <span className='flex-1 text-sm'>
            {_('Purge all reading data')}
            <span className='block text-xs'>
              {_(
                'This permanently erases reading progress, notes, and bookmarks. This cannot be undone.',
              )}
            </span>
          </span>
          <input
            type='checkbox'
            className='toggle toggle-sm'
            checked={purgeData}
            disabled={processing}
            aria-label={_('Purge all reading data')}
            onChange={(e) => setPurgeData(e.target.checked)}
          />
        </label>
      )}
      {error && <p role='alert'>{_('Could not finish. Please try again.')}</p>}
      <div className='glossa-dialog-actions flex flex-wrap justify-end gap-2'>
        <button
          ref={cancel}
          type='button'
          className='btn btn-sm min-h-[44px] btn-ghost eink-bordered'
          disabled={processing && (!onStop || stopping)}
          onClick={cancelOrStop}
        >
          {_(processing && onStop ? (stopping ? 'Stopping…' : 'Stop') : 'Cancel')}
        </button>
        <button
          type='button'
          disabled={processing}
          className={clsx(
            'btn btn-sm min-h-[44px]',
            purgeData || destructive ? 'btn-error' : 'btn-contrast',
          )}
          onClick={() => void confirm()}
        >
          {processing
            ? _('Processing…')
            : purgeData
              ? _('Purge & Delete')
              : (confirmLabel ?? _('Delete'))}
        </button>
      </div>
    </div>
  );
};
export default DeleteConfirmAlert;
