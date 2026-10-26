import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { libraryIdentityIO } from '@/services/bookIdentity';
import type { Book } from '@/types/book';
import { safeLoadJSON } from '@/services/persistence';
import { getLibraryFilename } from '@/utils/book';
import {
  applyDuplicateChoice,
  previewDuplicateBooks,
  undoDuplicateChoice,
  type DuplicateGroup,
} from '@/services/duplicateBooks';

export default function DuplicateBooksPanel({ onBack }: { onBack: () => void }) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const scan = async () => {
    if (!appService || busy) return;
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setMessage(_('Checking local files…'));
    try {
      const io = libraryIdentityIO(appService);
      const books = await safeLoadJSON<Book[]>(io, getLibraryFilename(), 'Books', []);
      const result = await previewDuplicateBooks(io, books, {
        signal: task.signal,
        onProgress: (current, total) => setMessage(`${current} / ${total}`),
      });
      task.signal.throwIfAborted();
      setGroups(result.groups);
      setChoices({});
      setMessage(
        _('{{groups}} duplicate sets · {{unavailable}} unavailable files', {
          groups: result.groups.length,
          unavailable: result.unavailable,
        }),
      );
    } catch {
      setMessage(
        task.signal.aborted ? _('Cancelled') : _('Could not check duplicates. Try again.'),
      );
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };
  const change = async (group?: DuplicateGroup) => {
    if (!appService || busy) return;
    setBusy(true);
    try {
      const io = libraryIdentityIO(appService);
      const books = group
        ? await applyDuplicateChoice(io, group, choices[group.fingerprint]!)
        : await undoDuplicateChoice(io);
      const store = useLibraryStore.getState();
      const covers = new Map(store.library.map((book) => [book.hash, book.coverImageUrl]));
      store.setLibrary(books.map((book) => ({ ...book, coverImageUrl: covers.get(book.hash) })));
      setGroups([]);
      setChoices({});
      setMessage(
        group ? _('Duplicates archived. You can undo this choice.') : _('Duplicate choice undone.'),
      );
    } catch {
      setMessage(_('Library changed or could not be saved. Check again before retrying.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className='my-4 space-y-4' aria-label={_('Review Duplicates')}>
      <button className='btn btn-ghost' onClick={onBack} disabled={busy}>
        {_('Back')}
      </button>
      <p className='glossa-supporting-text'>
        {_(
          'Choose the record to keep on the shelf. Other records, notes and contents remain archived; nothing is merged or deleted.',
        )}
      </p>
      <div className='flex flex-wrap gap-2'>
        <button className='btn' onClick={() => void scan()} disabled={busy}>
          {_('Check Local Files')}
        </button>
        <button className='btn btn-ghost' onClick={() => void change()} disabled={busy}>
          {_('Undo Last Choice')}
        </button>
        {busy && controller.current && (
          <button className='btn btn-ghost' onClick={() => controller.current?.abort()}>
            {_('Cancel')}
          </button>
        )}
      </div>
      <p role='status' className='glossa-supporting-text'>
        {message}
      </p>
      {groups.map((group, index) => (
        <fieldset
          key={group.fingerprint}
          className='border-base-content/15 space-y-3 rounded-lg border p-4'
          disabled={busy}
        >
          <legend>{_('Duplicate set {{count}}', { count: index + 1 })}</legend>
          {group.candidates.map(({ book, notes, notePreviews, hasContents }) => (
            <label key={book.hash} className='flex min-h-11 cursor-pointer items-start gap-3 py-2'>
              <input
                type='radio'
                name={`duplicate-${index}`}
                value={book.hash}
                checked={choices[group.fingerprint] === book.hash}
                onChange={() => setChoices({ ...choices, [group.fingerprint]: book.hash })}
              />
              <span className='min-w-0 break-words'>
                <span className='block'>
                  {book.title} · {book.author}
                </span>
                <span className='glossa-supporting-text block'>
                  {book.groupName || _('All Books')} · {book.progress?.join(' / ') || '—'} ·{' '}
                  {_('{{count}} notes', { count: notes })}
                  {hasContents ? ` · ${_('Contents')}` : ''}
                </span>
                {notePreviews.map((text, index) => (
                  <span key={index} className='glossa-supporting-text block'>
                    {text}
                  </span>
                ))}
                <span className='glossa-supporting-text block'>
                  {book.originalFilename || book.sourceTitle} · {book.hash.slice(0, 8)}
                  {book.duplicateOf ? ` · ${_('Archived')}` : ''}
                </span>
              </span>
            </label>
          ))}
          <button
            className='btn'
            disabled={!choices[group.fingerprint]}
            onClick={() => void change(group)}
          >
            {_('Keep Selected Record')}
          </button>
        </fieldset>
      ))}
    </section>
  );
}
