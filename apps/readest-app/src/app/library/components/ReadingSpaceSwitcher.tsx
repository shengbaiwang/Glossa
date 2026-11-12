import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useReadingSpaceStore } from '@/store/readingSpaceStore';
import { SPACE_LABELS, readingSpaceView, type ReadingSpaceScope } from '@/utils/readingSpaces';
import { navigateToLibrary } from '@/utils/nav';
import { useLibraryTransfer } from '../utils/libraryTransfer';
export default function ReadingSpaceSwitcher({ onZotero }: { onZotero?: () => void }) {
  const _ = useTranslation();
  const { space, setSpace } = useReadingSpaceStore();
  const params = useSearchParams();
  const router = useRouter();
  const change = (next: ReadingSpaceScope) => {
    let query = '';
    try {
      localStorage.setItem(
        `glossa:space-view:${space}`,
        readingSpaceView(params?.toString() ?? ''),
      );
      query = readingSpaceView(localStorage.getItem(`glossa:space-view:${next}`) ?? '');
    } catch {
      /* Navigation is still available without persisted preferences. */
    }
    useLibraryStore.getState().setSelectedBooks([]);
    useLibraryTransfer.setState({ clipboard: undefined, pendingDeleteIds: undefined });
    setSpace(next);
    navigateToLibrary(router, query);
  };
  return (
    <div className='flex flex-wrap items-center gap-2 px-3 py-2'>
      <select
        className='select select-sm eink-bordered min-w-0 flex-1 bg-transparent'
        aria-label={_('Reading space')}
        value={space}
        onChange={(e) => change(e.target.value as ReadingSpaceScope)}
      >
        {(['leisure', 'academic', 'all'] as const).map((s) => (
          <option key={s} value={s}>
            {_(SPACE_LABELS[s])}
          </option>
        ))}
      </select>
      {space !== 'leisure' && onZotero && (
        <button type='button' className='glossa-button eink-bordered' onClick={onZotero}>
          Zotero
        </button>
      )}
    </div>
  );
}
