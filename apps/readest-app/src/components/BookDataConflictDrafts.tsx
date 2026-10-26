import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import type { AppService } from '@/types/system';
import {
  previewBookDataConflict,
  restoreBookDataConflict,
  type ConflictRecoveryPreview,
} from '@/services/bookDataConflictRecovery';
import {
  loadBookDataConflicts,
  discardBookDataConflict,
  type BookDataConflict,
} from '@/services/bookDataConflicts';
import DeleteConfirmAlert from './DeleteConfirmAlert';
import ModalPortal from './ModalPortal';

export default function BookDataConflictDrafts({
  appService,
  disabled = false,
}: {
  appService?: AppService | null;
  disabled?: boolean;
}) {
  const _ = useTranslation();
  const section = useRef<HTMLElement>(null);
  const [restored, setRestored] = useState(false);
  const library = useLibraryStore((state) => state.library);
  const [drafts, setDrafts] = useState<BookDataConflict[]>([]);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [discard, setDiscard] = useState<BookDataConflict | null>(null);
  const [preview, setPreview] = useState<ConflictRecoveryPreview | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  useEffect(() => {
    let active = true,
      request = 0;
    const refresh = () => {
      const current = ++request;
      void loadBookDataConflicts()
        .then((rows) => {
          if (active && current === request) {
            setDrafts(rows);
            setError(false);
          }
        })
        .catch(() => {
          if (active && current === request) setError(true);
        });
    };
    refresh();
    window.addEventListener('glossa-book-data-conflicts', refresh);
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('glossa-book-data-conflicts');
    if (channel) channel.onmessage = refresh;
    return () => {
      active = false;
      window.removeEventListener('glossa-book-data-conflicts', refresh);
      channel?.close();
    };
  }, [revision]);
  const title = (draft: BookDataConflict) =>
    library.find((book) => book.hash === draft.bookId)?.title ?? _('Deleted book');
  const exportDraft = (draft: BookDataConflict) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft.data, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `glossa-${draft.kind}-${draft.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!drafts.length && !error && !restored) return null;
  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label={_('Conflicting drafts')}
      className='glossa-deleted-recovery'
    >
      <details className='glossa-removal-details'>
        <summary>{_('Preserved drafts ({{count}})', { count: drafts.length })}</summary>
        <div className='flex flex-col gap-3 pb-4'>
          {restored && <p role='status'>{_('Draft restored as a separate copy.')}</p>}
          <p className='text-sm'>
            {_('Edits made after deletion are kept here. Compare and restore the ones you need.')}
          </p>
          {recoveryError && <p role='alert'>{_(recoveryError)}</p>}
          {error && (
            <div role='alert'>
              {_('Conflicting drafts could not be read.')}{' '}
              <button
                className='btn btn-sm min-h-[44px] eink-bordered'
                onClick={() => setRevision((value) => value + 1)}
              >
                {_('Retry')}
              </button>
            </div>
          )}
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className='eink-bordered flex flex-wrap items-center gap-3 rounded-lg border p-3'
            >
              <div className='min-w-0 w-full sm:w-auto sm:flex-1'>
                <p className='break-words'>{title(draft)}</p>
                <p className='text-sm'>
                  {_(
                    draft.kind === 'notes'
                      ? 'Notes'
                      : draft.kind === 'mindmaps'
                        ? 'Mind maps'
                        : 'Conversations',
                  )}{' '}
                  · {new Date(draft.editedAt).toLocaleString()}
                </p>
              </div>
              <button
                className='btn btn-sm min-h-[44px] eink-bordered'
                disabled={disabled || restoring || !appService}
                onClick={async () => {
                  if (!appService) return;
                  setRecoveryError('');
                  setRestoring(true);
                  try {
                    setPreview(await previewBookDataConflict(appService, draft));
                  } catch (cause) {
                    setRecoveryError(
                      cause instanceof z.ZodError
                        ? 'This draft is invalid. Export it for review.'
                        : cause instanceof Error
                          ? cause.message
                          : 'Could not restore book data.',
                    );
                  } finally {
                    setRestoring(false);
                  }
                }}
              >
                {_('Compare and restore')}
              </button>
              <button
                className='btn btn-sm min-h-[44px] eink-bordered'
                onClick={() => exportDraft(draft)}
              >
                {_('Export draft')}
              </button>
              <button
                className='btn btn-sm min-h-[44px] btn-ghost eink-bordered'
                disabled={restoring || disabled}
                onClick={() => setDiscard(draft)}
              >
                {_('Discard draft')}
              </button>
              {preview?.draft.id === draft.id && (
                <div className='flex w-full flex-col gap-3'>
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <div>
                      <p className='font-medium'>{_('Current data')}</p>
                      <p className='max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm'>
                        {preview.currentText || _('Empty')}
                      </p>
                    </div>
                    <div>
                      <p className='font-medium'>{_('Preserved draft')}</p>
                      <p className='max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm'>
                        {preview.draftText || _('Empty')}
                      </p>
                    </div>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <button
                      className='btn btn-sm min-h-[44px] btn-contrast'
                      disabled={restoring || disabled}
                      onClick={async () => {
                        if (!appService) return;
                        setRestoring(true);
                        setRecoveryError('');
                        try {
                          useLibraryStore
                            .getState()
                            .setLibrary(await restoreBookDataConflict(appService, preview));
                          setPreview(null);
                          setRevision((v) => v + 1);
                          setRestored(true);
                          section.current?.focus();
                        } catch (cause) {
                          setRecoveryError(
                            cause instanceof z.ZodError
                              ? 'This draft is invalid. Export it for review.'
                              : cause instanceof Error
                                ? cause.message
                                : 'Could not restore book data.',
                          );
                          setPreview(null);
                        } finally {
                          setRestoring(false);
                        }
                      }}
                    >
                      {_('Keep current and restore a copy')}
                    </button>
                    <button
                      className='btn btn-sm min-h-[44px] btn-ghost eink-bordered'
                      disabled={restoring}
                      onClick={() => setPreview(null)}
                    >
                      {_('Cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {discard && (
            <ModalPortal>
              <DeleteConfirmAlert
                title={_('Discard draft')}
                message={_(
                  'This deletes only the selected conflicting draft. It cannot be undone. Current book data and other drafts are kept.',
                )}
                books={[{ hash: discard.id, title: title(discard) }]}
                scope={_('This device only.')}
                confirmLabel={_('Discard draft')}
                destructive
                onCancel={() => setDiscard(null)}
                onConfirm={async () => {
                  await discardBookDataConflict(discard.id);
                  setDrafts((rows) => rows.filter((row) => row.id !== discard.id));
                  setDiscard(null);
                }}
              />
            </ModalPortal>
          )}
        </div>
      </details>
    </section>
  );
}
