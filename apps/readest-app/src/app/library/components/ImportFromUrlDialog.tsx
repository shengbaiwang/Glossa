'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isClipCancelled } from '@/services/send/clipSignIn';
import type { ClipRecovery } from '@/services/send/clipSignIn';
import type { WebImportFeedback } from '@/glossa/plugins/webImport';
import type { ConvertedBook } from '@/services/send/conversion/types';
import { useTranslation } from '@/hooks/useTranslation';
import ImportDialog from './ImportDialog';
import ImportProgress from './ImportProgress';

interface ImportFromUrlDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    url: string,
    signal: AbortSignal,
    onStage: (stage: string) => void,
    feedback: WebImportFeedback,
  ) => Promise<void>;
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
  const [recovery, setRecovery] = useState<{
    reason: ClipRecovery;
    respond: (open: boolean) => void;
  } | null>(null);
  const [warnings, setWarnings] = useState<NonNullable<ConvertedBook['warnings']>>([]);
  const [completed, setCompleted] = useState(false);
  const [fullText, setFullText] = useState<{ respond: (pdf: boolean) => void } | null>(null);
  const retryToken = useRef<object>({});
  const pendingRecovery = useRef<((open: boolean) => void) | null>(null);
  const active = useRef<AbortController | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (isOpen) {
      setUrl('');
      setSubmitting(false);
      setStopping(false);
      setError(null);
      setRecovery(null);
      setWarnings([]);
      setCompleted(false);
      setFullText(null);
      retryToken.current = {};
    }
    return () => {
      active.current?.abort();
      active.current = null;
      pendingRecovery.current?.(false);
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
    setCompleted(false);
    setWarnings([]);
    setStage('Loading article…');
    try {
      let importedWarnings: NonNullable<ConvertedBook['warnings']> = [];
      await onSubmit(
        target,
        controller.signal,
        (value) => {
          if (active.current === controller && !controller.signal.aborted) setStage(value);
        },
        {
          retryToken: retryToken.current,
          onFullText: (_pdfUrl, taskSignal) =>
            new Promise<boolean>((resolve) => {
              const respond = (pdf: boolean) => {
                taskSignal.removeEventListener('abort', abort);
                controller.signal.removeEventListener('abort', abort);
                if (pendingRecovery.current === respond) {
                  pendingRecovery.current = null;
                  setFullText(null);
                }
                resolve(pdf);
              };
              const abort = () => respond(false);
              if (taskSignal.aborted || controller.signal.aborted) return respond(false);
              pendingRecovery.current = respond;
              taskSignal.addEventListener('abort', abort, { once: true });
              controller.signal.addEventListener('abort', abort, { once: true });
              setFullText({ respond });
            }),
          onRecovery: (reason, taskSignal = controller.signal) =>
            new Promise<boolean>((resolve) => {
              const respond = (open: boolean) => {
                taskSignal.removeEventListener('abort', abort);
                controller.signal.removeEventListener('abort', abort);
                if (pendingRecovery.current === respond) {
                  pendingRecovery.current = null;
                  setRecovery(null);
                }
                resolve(open);
              };
              const abort = () => respond(false);
              if (taskSignal.aborted || controller.signal.aborted || active.current !== controller)
                return respond(false);
              pendingRecovery.current = respond;
              taskSignal.addEventListener('abort', abort, { once: true });
              controller.signal.addEventListener('abort', abort, { once: true });
              setRecovery({ reason, respond });
            }),
          onWarnings: (value) => {
            if (active.current === controller && !controller.signal.aborted) {
              importedWarnings = value;
              setWarnings(value);
            }
          },
        },
      );
      if (active.current === controller) {
        if (importedWarnings.length && !controller.signal.aborted) setCompleted(true);
        else closeRef.current();
      }
    } catch (e) {
      if (active.current !== controller) return;
      if (controller.signal.aborted && e instanceof Error && e.name === 'AbortError')
        closeRef.current();
      else if (!isClipCancelled(e))
        setError(
          e instanceof Error
            ? _(e.message)
            : typeof e === 'string'
              ? _(e)
              : _('Could not fetch this page'),
        );
    } finally {
      if (active.current === controller) {
        pendingRecovery.current?.(false);
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
        {fullText ? (
          <p role='status' className='text-base-content/80 text-sm leading-relaxed'>
            {_('This page contains an abstract and links to a full-text PDF.')}
          </p>
        ) : recovery ? (
          <p role='status' className='text-base-content/80 text-sm leading-relaxed'>
            {_(
              recovery.reason.code === 'login_wall'
                ? 'This page requires sign-in or verification. Open it, then capture the article.'
                : 'The article could not be extracted automatically. Open the page, then capture it or select its text.',
            )}
          </p>
        ) : submitting ? (
          <ImportProgress label={_(stopping ? 'Stopping…' : stage)} detail={url} />
        ) : !completed ? (
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
        ) : null}
        {completed && warnings.length > 0 && (
          <div role='status' className='text-base-content/80 text-sm leading-relaxed'>
            {warnings.some((warning) => warning.code === 'partial_content') && (
              <p>{_('Imported an excerpt or abstract; the full article was not available.')}</p>
            )}
            {warnings.some((warning) => warning.code === 'missing_assets') && (
              <p>
                {_('Imported. Some images could not be saved.')}
                <span>
                  {' '}
                  (
                  {warnings
                    .filter((warning) => warning.code === 'missing_assets')
                    .reduce((sum, warning) => sum + (warning.count || 0), 0)}
                  )
                </span>
              </p>
            )}
          </div>
        )}
        {error && (
          <p role='alert' className='text-error text-sm leading-relaxed'>
            {error}
          </p>
        )}
        <div className='glossa-import-actions flex-wrap'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={close}
            disabled={stopping}
          >
            {_(completed ? 'Done' : 'Cancel')}
          </button>
          {recovery && !stopping && (
            <button
              type='button'
              className='btn btn-contrast btn-sm'
              onClick={() => recovery.respond(true)}
            >
              {_('Open page and continue')}
            </button>
          )}
          {fullText && !stopping && (
            <>
              <button
                type='button'
                className='btn btn-ghost btn-sm'
                onClick={() => fullText.respond(false)}
              >
                {_('Import abstract')}
              </button>
              <button
                type='button'
                className='btn btn-contrast btn-sm'
                onClick={() => fullText.respond(true)}
              >
                {_('Import full-text PDF')}
              </button>
            </>
          )}
          {completed && warnings.some((warning) => warning.code === 'missing_assets') && (
            <button
              type='button'
              className='btn btn-contrast btn-sm'
              onClick={() => {
                void submit();
              }}
            >
              {_('Retry missing images')}
            </button>
          )}
          {!submitting && !completed && (
            <button type='submit' className='btn btn-contrast btn-sm' disabled={!url.trim()}>
              {_('Import')}
            </button>
          )}
        </div>
      </form>
    </ImportDialog>
  );
}
