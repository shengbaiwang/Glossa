'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isClipCancelled } from '@/services/send/clipSignIn';
import { useTranslation } from '@/hooks/useTranslation';
import ImportDialog from './ImportDialog';
import ImportProgress from './ImportProgress';

interface ImportFromUrlDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (url: string, signal: AbortSignal, onStage: (stage: string) => void) => Promise<void>;
}
export default function ImportFromUrlDialog({
  isOpen,
  onClose,
  onSubmit,
}: ImportFromUrlDialogProps) {
  const _ = useTranslation();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stage, setStage] = useState('Loading article…');
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setSubmitting(false);
      setStopping(false);
      setError(null);
    }
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [isOpen]);
  const close = useCallback(() => {
    if (active.current) {
      active.current.abort();
      setStopping(true);
    } else closeRef.current();
  }, []);
  const submit = async () => {
    if (active.current) return;
    const target = url.trim();
    try {
      const parsed = new URL(target);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      setError(_('Enter a URL starting with http:// or https://'));
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setSubmitting(true);
    setStopping(false);
    setError(null);
    setStage('Loading article…');
    try {
      await onSubmit(target, controller.signal, (value) => {
        if (active.current === controller && !controller.signal.aborted) setStage(value);
      });
      if (active.current === controller) closeRef.current();
    } catch (e) {
      if (active.current !== controller) return;
      if (controller.signal.aborted && e instanceof Error && e.name === 'AbortError')
        closeRef.current();
      else if (!isClipCancelled(e))
        setError(
          e instanceof Error
            ? e.message
            : typeof e === 'string'
              ? e
              : _('Could not fetch this page'),
        );
    } finally {
      if (active.current === controller) {
        active.current = null;
        setSubmitting(false);
        setStopping(false);
      }
    }
  };
  if (!isOpen) return null;
  return (
    <ImportDialog title={_('Import webpage')} onClose={close}>
      <form
        className='flex flex-col gap-4 py-2'
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {submitting ? (
          <ImportProgress label={_(stopping ? 'Stopping…' : stage)} detail={url} />
        ) : (
          <input
            type='url'
            autoFocus
            aria-label={_('Web address')}
            className='input input-bordered eink-bordered placeholder:text-base-content/35 w-full'
            placeholder='https://example.com/article'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />
        )}
        {error && (
          <p role='alert' className='text-error text-sm leading-relaxed'>
            {error}
          </p>
        )}
        <div className='glossa-import-actions'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={close}
            disabled={stopping}
          >
            {_('Cancel')}
          </button>
          {!submitting && (
            <button type='submit' className='btn btn-contrast btn-sm' disabled={!url.trim()}>
              {_('Import')}
            </button>
          )}
        </div>
      </form>
    </ImportDialog>
  );
}
