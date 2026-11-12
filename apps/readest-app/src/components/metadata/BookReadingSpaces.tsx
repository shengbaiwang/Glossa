import { useState } from 'react';
import type { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryBookEdits } from '@/app/library/hooks/useLibraryBookEdits';
import { readingSpaces, READING_SPACES, SPACE_LABELS } from '@/utils/readingSpaces';
export default function BookReadingSpaces({ book }: { book: Book }) {
  const _ = useTranslation();
  const edits = useLibraryBookEdits();
  const [busy, setBusy] = useState(false);
  const spaces = readingSpaces(book);
  return (
    <div
      role='group'
      aria-label={_('Reading space')}
      className='flex flex-wrap items-center gap-2 py-2'
    >
      <span className='text-sm'>{_('Reading space')}</span>
      {READING_SPACES.map((space) => (
        <button
          key={space}
          type='button'
          className='glossa-button eink-bordered'
          aria-pressed={spaces.includes(space)}
          disabled={busy || (spaces.length === 1 && spaces.includes(space))}
          onClick={async () => {
            setBusy(true);
            try {
              await edits.apply(
                [book],
                'readingSpaces',
                spaces.includes(space) ? spaces.filter((s) => s !== space) : [...spaces, space],
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {_(SPACE_LABELS[space])}
        </button>
      ))}
    </div>
  );
}
