import { useEffect, useRef, useState } from 'react';
import { isRecoverableRemoval } from '@/services/bookRemovalState';
import type { Book } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  bookRemovalIO,
  cleanRemovedBook,
  removeAppBooks,
  removalScope,
  removalFeedback,
} from '@/services/appBookRemoval';
import { runFileLibrarySyncPass } from '@/services/sync/file/runLibrarySync';
import { restoreRemovedBooks, runRemoval, type RemovalResult } from '@/services/bookRemovalService';
import { getEnabledFileSyncBackends } from '@/services/sync/cloudSyncProvider';
import DeleteConfirmAlert from '@/components/DeleteConfirmAlert';
import ModalPortal from '@/components/ModalPortal';
import BookDataConflictDrafts from '@/components/BookDataConflictDrafts';
import { Trash2, Undo2 } from '@/components/GlossaIcons';

export default function RecentlyDeleted() {
  const _ = useTranslation(),
    { appService, envConfig } = useEnv();
  const library = useLibraryStore((s) => s.library);
  const [selection, setSelection] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{
    books: Book[];
    cloudTargets: string[];
    scope: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const [restored, setRestored] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const [result, setResult] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const pendingCloud = library.filter(
    (b) => b.removal?.cloud === 'pending' || b.removal?.cloud === 'failed',
  );
  const deleted = library.filter(
    (b) =>
      b.deletedAt &&
      (b.removal?.mode !== 'purge' ||
        b.removal.conflict ||
        b.removal.local !== 'complete' ||
        b.removal.cloud === 'pending' ||
        b.removal.cloud === 'failed'),
  );
  const tasks = [
    ...new Map(
      library
        .flatMap((book) => [book.removal, book.localRemoval])
        .filter(
          (intent) =>
            intent && intent.mode !== 'restore' && intent.local !== 'complete' && !intent.conflict,
        )
        .map((intent) => [intent!.id, intent!]),
    ).values(),
  ];
  const apply = (progress: RemovalResult) => {
    useLibraryStore.getState().setLibrary(progress.books);
    setRestored(0);
    const mode = tasks.find((task) => task.id === progress.id)?.mode;
    setResult(removalFeedback(progress, mode && mode !== 'restore' ? mode : 'purge', _));
  };
  const work = async (task: () => Promise<void>) => {
    if (controller.current) return;
    controller.current = new AbortController();
    setBusy(true);
    setError(false);
    try {
      await task();
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      controller.current = null;
      setBusy(false);
    }
  };
  const restore = (hashes: string[]) =>
    work(async () => {
      if (!appService) throw new Error('Unavailable');
      useLibraryStore
        .getState()
        .setLibrary(await restoreRemovedBooks(bookRemovalIO(appService), hashes));
      setSelection([]);
      setResult('');
      setRestored(hashes.length);
      heading.current?.focus();
    });
  const retry = (id: string) =>
    work(async () => {
      if (!appService) throw new Error('Unavailable');
      apply(
        await runRemoval(bookRemovalIO(appService), id, {
          signal: controller.current!.signal,
          clean: cleanRemovedBook(appService),
          onProgress: apply,
        }),
      );
    });
  const purge = async () => {
    const targets = confirm?.books;
    if (!targets || !appService) throw new Error('Unavailable');
    const done = await work(async () => {
      const progress = await removeAppBooks(appService, targets, 'purge', {
        cloudTargets: confirm!.cloudTargets,
        signal: controller.current!.signal,
        onProgress: apply,
        allowConflict: true,
      });
      apply(progress);
      setSelection([...progress.failed, ...progress.pending]);
      setConfirm(null);
      heading.current?.focus();
    });
    if (!done) throw new Error('Removal failed');
  };
  const recoverable = deleted.filter(isRecoverableRemoval);
  const selected = recoverable.filter((book) => selection.includes(book.hash));
  const requestPurge = (books: Book[]) => {
    if (!books.length) return;
    const settings = useSettingsStore.getState().settings;
    setConfirm({
      books,
      cloudTargets: getEnabledFileSyncBackends(settings),
      scope: removalScope(settings, _),
    });
  };
  return (
    <section aria-label={_('Recently Deleted')} className='glossa-deleted'>
      <div className='glossa-deleted-content'>
        <header className='glossa-deleted-heading'>
          <div>
            <h2 ref={heading} tabIndex={-1}>
              {_('Recently Deleted')}
              {deleted.length > 0 && <span className='glossa-deleted-count'>{deleted.length}</span>}
            </h2>
          </div>
          {busy && (
            <button
              className='btn btn-sm min-h-[44px] btn-ghost eink-bordered'
              onClick={() => controller.current?.abort()}
            >
              {_('Stop')}
            </button>
          )}
        </header>
        {error && (
          <p className='glossa-deleted-notice' role='alert'>
            {_('Could not finish. Please try again.')}
          </p>
        )}
        {result && (
          <p className='glossa-deleted-notice' role='status'>
            {result}
          </p>
        )}
        {restored > 0 && (
          <p className='glossa-deleted-notice' role='status'>
            {_('Restored {{count}} book(s)', { count: restored })}
          </p>
        )}
        {selected.length > 0 && (
          <div className='glossa-deleted-selection'>
            <span className='me-auto'>{_('Selected {{count}}', { count: selected.length })}</span>
            <button
              className='btn btn-sm min-h-[44px] btn-ghost'
              disabled={busy}
              onClick={() => setSelection(recoverable.map((book) => book.hash))}
            >
              {_('Select All')}
            </button>
            <button
              className='btn btn-sm min-h-[44px] btn-ghost'
              disabled={busy}
              onClick={() => setSelection([])}
            >
              {_('Cancel')}
            </button>
            <button
              className='btn btn-sm min-h-[44px] btn-contrast'
              disabled={busy}
              onClick={() => void restore(selected.map((book) => book.hash))}
            >
              {_('Restore')}
            </button>
            <button
              className='btn btn-sm min-h-[44px] btn-ghost eink-bordered'
              disabled={busy}
              onClick={() => requestPurge(selected)}
            >
              {_('Delete permanently')}
            </button>
          </div>
        )}
        {!deleted.length && (
          <div className='glossa-deleted-empty'>
            <Trash2 size={28} />
            <p>{_('No recently deleted books')}</p>
          </div>
        )}
        <ul>
          {deleted.map((book) => (
            <li
              key={book.hash}
              className='glossa-deleted-row'
              data-selected={selected.some((item) => item.hash === book.hash)}
            >
              <label className='glossa-deleted-check'>
                <input
                  type='checkbox'
                  className='checkbox checkbox-sm'
                  disabled={busy || !isRecoverableRemoval(book)}
                  aria-label={book.title}
                  checked={selected.some((item) => item.hash === book.hash)}
                  onChange={(event) =>
                    setSelection((previous) =>
                      event.target.checked
                        ? [...previous, book.hash]
                        : previous.filter((id) => id !== book.hash),
                    )
                  }
                />
              </label>
              <div className='glossa-deleted-book'>
                <h3>{book.title}</h3>
                <p>{[book.author, book.format].filter(Boolean).join(' · ')}</p>
                {book.removal?.conflict && <p>{_('Newer edits are preserved.')}</p>}
                {book.removal?.cloud === 'failed' && <p>{_('Cloud sync failed')}</p>}
                {book.removal?.cloud === 'pending' && <p>{_('Waiting for cloud sync')}</p>}
                {!book.removal && <p>{_('The original file may need to be imported again.')}</p>}
              </div>
              {isRecoverableRemoval(book) && (
                <div className='glossa-deleted-actions'>
                  <button
                    className='btn btn-sm btn-ghost'
                    disabled={busy}
                    onClick={() => void restore([book.hash])}
                  >
                    <Undo2 size={16} />
                    {_('Restore')}
                  </button>
                  <button
                    className='btn btn-sm btn-ghost'
                    disabled={busy}
                    title={_('Delete permanently')}
                    aria-label={_('Delete “{{title}}” permanently', { title: book.title })}
                    onClick={() => requestPurge([book])}
                  >
                    <Trash2 size={16} />
                    {_('Delete permanently')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {pendingCloud.length > 0 && (
          <div className='glossa-deleted-notice'>
            <span>
              {_('Waiting for cloud sync')} · {pendingCloud.length}
            </span>
            <button
              className='btn btn-sm min-h-[44px] btn-ghost eink-bordered'
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  const synced = await runFileLibrarySyncPass(envConfig, _);
                  if (
                    !synced ||
                    synced.failures ||
                    useLibraryStore
                      .getState()
                      .library.some((book) => book.removal?.cloud === 'failed')
                  )
                    throw new Error('Sync unfinished');
                })
              }
            >
              {_('Retry sync')}
            </button>
          </div>
        )}
        {tasks.length > 0 && (
          <details className='glossa-removal-details glossa-deleted-recovery'>
            <summary>{_('Unfinished actions ({{count}})', { count: tasks.length })}</summary>
            {tasks.map((task) => (
              <div key={task.id} className='glossa-deleted-notice'>
                <div>
                  <p>
                    {_(
                      task.mode === 'local' ? 'Unfinished download cleanup' : 'Unfinished removal',
                    )}
                  </p>
                  {library.flatMap((book) => {
                    const intent = [book.removal, book.localRemoval].find(
                      (value) => value?.id === task.id && value.local !== 'complete',
                    );
                    if (!intent) return [];
                    return [
                      <div key={book.hash} className='mt-2 text-sm'>
                        <p>
                          {book.title} · {_(intent.local === 'failed' ? 'Failed' : 'Not started')}
                        </p>
                        {intent.failure && (
                          <p className='glossa-removal-caption'>
                            {_(
                              intent.failure === 'unavailable-copy'
                                ? 'No matching recovery copy could be verified. Sync the book before retrying.'
                                : intent.failure === 'changed-file'
                                  ? 'The local file changed. Review the book before retrying.'
                                  : 'Could not finish file cleanup. Check storage access and retry.',
                            )}
                          </p>
                        )}
                      </div>,
                    ];
                  })}
                </div>
                <button
                  className='btn btn-sm min-h-[44px] btn-ghost eink-bordered'
                  disabled={busy}
                  onClick={() => void retry(task.id)}
                >
                  {_('Continue / Retry')}
                </button>
              </div>
            ))}
          </details>
        )}
        <BookDataConflictDrafts appService={appService} disabled={busy} />
      </div>
      {confirm && (
        <ModalPortal>
          <DeleteConfirmAlert
            title={_('Delete permanently?')}
            books={confirm.books}
            destructive
            confirmLabel={_('Delete permanently')}
            message={_('The app copy and personal data will be erased. This cannot be undone.')}
            details={_(
              'This includes reading progress, notes, conversations, mind maps and book-owned caches. External originals are kept. Legacy shared data can be reviewed in Settings.',
            )}
            scope={
              confirm.books.some((book) => book.removal?.conflict)
                ? `${_('Newer edits will also be deleted.')} ${confirm.scope}`
                : confirm.scope
            }
            onCancel={() => setConfirm(null)}
            onStop={() => controller.current?.abort()}
            onConfirm={purge}
          />
        </ModalPortal>
      )}
    </section>
  );
}
