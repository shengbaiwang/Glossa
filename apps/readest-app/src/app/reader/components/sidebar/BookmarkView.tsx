import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';
import * as CFI from 'foliate-js/epubcfi.js';
import { Bookmark, Plus } from '@/components/GlossaIcons';

import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { findTocItemBS } from '@/services/nav';
import { findNearestCfi } from '@/utils/cfi';
import { TOCItem } from '@/libs/document';
import { BookNote, BooknoteGroup } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { isCanonicalCfi } from '../../utils/bookmark';
import BookmarkItem from './BookmarkItem';
import EmptyState from '../EmptyState';

type FlatBookmarkRow =
  | { kind: 'group-header'; key: string; group: BooknoteGroup }
  | { kind: 'bookmark'; key: string; item: BookNote };

// Sort by canonical CFI; a malformed cfi (synced garbage) must not crash the
// whole list, so it sorts as equal and stays visible.
const compareCfi = (a: string, b: string): number => {
  try {
    return CFI.compare(a, b);
  } catch {
    return 0;
  }
};

const BookmarkView: React.FC<{
  bookKey: string;
  toc: TOCItem[];
}> = ({ bookKey, toc }) => {
  const _ = useTranslation();
  const config = useBookDataStore((s) => s.booksData[bookKey.split('-')[0]!]?.config);
  const progress = useBookProgress(bookKey);
  const setActiveBooknoteType = useSidebarStore((s) => s.setActiveBooknoteType);
  const setBooknoteResults = useSidebarStore((s) => s.setBooknoteResults);

  const bookmarks = useMemo(
    () => (config?.booknotes ?? []).filter((note) => note.type === 'bookmark' && !note.deletedAt),
    [config?.booknotes],
  );

  // Group by chapter and keep reading order inside each chapter.
  const sortedGroups = useMemo<BooknoteGroup[]>(() => {
    const groups: { [href: string]: BooknoteGroup } = {};
    for (const bookmark of bookmarks) {
      const tocItem = findTocItemBS(toc ?? [], bookmark.cfi);
      const href = tocItem?.href || '';
      const label = tocItem?.label || '';
      const id = tocItem?.id || 0;
      if (!groups[href]) {
        groups[href] = { id, href, label, booknotes: [] };
      }
      groups[href].booknotes.push(bookmark);
    }
    Object.values(groups).forEach((g) => {
      g.booknotes.sort((a, b) => compareCfi(a.cfi, b.cfi));
    });
    return Object.values(groups).sort((a, b) => a.id - b.id);
  }, [bookmarks, toc]);

  const flatItems = useMemo<FlatBookmarkRow[]>(() => {
    const rows: FlatBookmarkRow[] = [];
    for (const group of sortedGroups) {
      rows.push({ kind: 'group-header', key: `h-${group.href}`, group });
      group.booknotes.forEach((item) => {
        rows.push({ kind: 'bookmark', key: `b-${group.href}-${item.id}`, item });
      });
    }
    return rows;
  }, [sortedGroups]);

  // Nearest cfi for the "current" highlight; recomputed when bookmarks change
  // so deleted/edited rows don't leave a stale target behind.
  const nearestCfi = useMemo(() => {
    const allSorted = sortedGroups
      .flatMap((g) => g.booknotes)
      .map((b) => b.cfi)
      .filter(isCanonicalCfi)
      .sort(compareCfi);
    return findNearestCfi(allSorted, progress?.location);
  }, [sortedGroups, progress?.location]);

  const nearestIndex = useMemo(
    () =>
      nearestCfi
        ? flatItems.findIndex((row) => row.kind === 'bookmark' && row.item.cfi === nearestCfi)
        : -1,
    [nearestCfi, flatItems],
  );

  // Feed the bottom prev/next bookmark navigation after a row is clicked.
  const handleBrowseBookmarks = useCallback(() => {
    if (bookmarks.length === 0) return;
    const sorted = [...bookmarks].sort((a, b) => compareCfi(a.cfi, b.cfi));
    setActiveBooknoteType(bookKey, 'bookmark');
    setBooknoteResults(bookKey, sorted);
  }, [bookmarks, bookKey, setActiveBooknoteType, setBooknoteResults]);

  // ---- Virtualization wiring (mirrors TOCView) ----
  const listHostRef = useRef<HTMLDivElement | null>(null);
  const osRootRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(400);
  const lastScrolledCfiRef = useRef<string | null>(null);

  // Mirror the nearest index so the OverlayScrollbars `initialized` callback —
  // created at mount but fired after a deferred, timing-dependent init — reads
  // the current target instead of its stale mount-time closure.
  const nearestIndexRef = useRef(nearestIndex);
  nearestIndexRef.current = nearestIndex;

  // Center index of the currently visible window, kept fresh by Virtuoso's
  // rangeChanged. Lets the scroll effect jump instantly for far moves and
  // animate only short ones.
  const visibleCenterRef = useRef(0);

  // When the reading position is already known at open time (the common case
  // of switching to the tab while reading), mount Virtuoso *natively* centered
  // on the nearest bookmark via initialTopMostItemIndex. A scrollToIndex
  // against a freshly mounted, unmeasured list no-ops or wedges it, so the
  // scroll effect skips that first jump; the OverlayScrollbars `initialized`
  // re-apply restores it after the deferred init resets scrollTop.
  const [initialTopIndex] = useState(() => nearestIndex);
  const initialScrollHandledRef = useRef(initialTopIndex > 0);

  const [initialize, osInstance] = useOverlayScrollbars({
    defer: true,
    options: { scrollbars: { autoHide: 'scroll' } },
    events: {
      initialized(instance) {
        const { viewport } = instance.elements();
        viewport.style.overflowX = 'var(--os-viewport-overflow-x)';
        viewport.style.overflowY = 'var(--os-viewport-overflow-y)';
        const reapply = () => {
          const index = nearestIndexRef.current;
          if (index < 0) return;
          virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
        };
        requestAnimationFrame(() => {
          reapply();
          requestAnimationFrame(reapply);
        });
      },
    },
  });

  useEffect(() => {
    const root = osRootRef.current;
    if (scroller && root) {
      initialize({ target: root, elements: { viewport: scroller } });
    }
    return () => osInstance()?.destroy();
  }, [scroller, initialize, osInstance]);

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    setScroller(el instanceof HTMLElement ? el : null);
  }, []);

  // Track the parent scroll container's available height so Virtuoso has a
  // bounded viewport.
  useEffect(() => {
    const updateHeight = () => {
      if (!listHostRef.current) return;
      const rect = listHostRef.current.getBoundingClientRect();
      const parentContainer = listHostRef.current.closest('.scroll-container');
      if (parentContainer) {
        const parentRect = parentContainer.getBoundingClientRect();
        const availableHeight = parentRect.height - (rect.top - parentRect.top);
        setContainerHeight(Math.max(400, availableHeight));
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    let resizeObserver: ResizeObserver | null = null;
    if (listHostRef.current) {
      const parentContainer = listHostRef.current.closest('.scroll-container');
      if (parentContainer) {
        resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(parentContainer);
      }
    }
    return () => {
      window.removeEventListener('resize', updateHeight);
      resizeObserver?.disconnect();
    };
  }, []);

  // Keep the active bookmark in view as the reading position changes. A far
  // instant jump can land short until the target rows are measured, so
  // re-assert once on the next frame; e-ink skips animation entirely.
  useEffect(() => {
    if (nearestIndex < 0) return;
    if (nearestCfi === lastScrolledCfiRef.current) return;
    lastScrolledCfiRef.current = nearestCfi;
    if (initialScrollHandledRef.current) {
      initialScrollHandledRef.current = false;
      return;
    }
    const isEink = document.documentElement.getAttribute('data-eink') === 'true';
    const distance = Math.abs(nearestIndex - visibleCenterRef.current);
    const behavior = isEink || distance > 16 ? 'auto' : 'smooth';
    virtuosoRef.current?.scrollToIndex({ index: nearestIndex, align: 'center', behavior });
    if (behavior === 'auto') {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: nearestIndex,
          align: 'center',
          behavior: 'auto',
        });
      });
    }
  }, [nearestCfi, nearestIndex]);

  const renderItem = useCallback(
    (index: number) => {
      const row = flatItems[index];
      if (!row) return null;
      if (row.kind === 'group-header') {
        return (
          <div className='px-2 pt-2'>
            <h3 className='content font-size-base line-clamp-1 px-2 font-normal'>
              {row.group.label}
            </h3>
          </div>
        );
      }
      return (
        <ul className='px-2'>
          <BookmarkItem
            bookKey={bookKey}
            item={row.item}
            isNearest={row.item.cfi === nearestCfi}
            onClick={handleBrowseBookmarks}
          />
        </ul>
      );
    },
    [flatItems, bookKey, nearestCfi, handleBrowseBookmarks],
  );

  // Always mount the listHostRef host so the height-measurement effect (and
  // its ResizeObserver) can attach on first mount, even when starting from
  // the empty state.
  const isEmpty = sortedGroups.length === 0;

  return (
    <div className='booknote-list rounded' role='tree'>
      <div ref={listHostRef}>
        {isEmpty ? (
          <div className='glossa-reader-empty-region'>
            <EmptyState
              Icon={Bookmark}
              label={_('No Bookmarks')}
              action={
                <button
                  type='button'
                  className='glossa-button glossa-reader-empty-action max-w-full flex-nowrap'
                  onClick={() => eventDispatcher.dispatch('toggle-bookmark', { bookKey })}
                >
                  <Plus size={16} className='shrink-0' aria-hidden='true' />
                  <span className='min-w-0 truncate'>{_('Bookmark This Page')}</span>
                </button>
              }
            />
          </div>
        ) : (
          <div
            ref={osRootRef}
            data-overlayscrollbars-initialize=''
            style={{ height: containerHeight }}
          >
            <Virtuoso
              ref={virtuosoRef}
              scrollerRef={handleScrollerRef}
              initialTopMostItemIndex={
                initialTopIndex > 0 ? { index: initialTopIndex, align: 'center' } : 0
              }
              rangeChanged={({ startIndex, endIndex }) => {
                visibleCenterRef.current = Math.floor((startIndex + endIndex) / 2);
              }}
              style={{ height: containerHeight }}
              totalCount={flatItems.length}
              computeItemKey={(index) => flatItems[index]?.key ?? index}
              itemContent={renderItem}
              overscan={500}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default BookmarkView;
