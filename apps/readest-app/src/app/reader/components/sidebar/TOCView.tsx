import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

import type { BookDoc, TOCItem } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useReaderProgressStore } from '@/store/readerProgressStore';
import {
  getChapterIndex,
  getStandaloneChapterIndex,
  type ChapterIndex,
} from 'foliate-js/chapter-index.js';
import { eventDispatcher } from '@/utils/event';

import { FlatTOCItem, StaticListRow } from './TOCItem';
import { computeExpandedSet, getItemIdentifier } from './tocTree';

const flattenTOC = (
  items: TOCItem[],
  expandedItems: Set<string>,
  keyOf: (item: TOCItem) => string,
  depth = 0,
): FlatTOCItem[] => {
  const result: FlatTOCItem[] = [];
  items.forEach((item, index) => {
    const id = keyOf(item);
    const isExpanded = expandedItems.has(id);
    result.push({ item, depth, index, isExpanded, id });
    if (item.subitems && isExpanded) {
      result.push(...flattenTOC(item.subitems, expandedItems, keyOf, depth + 1));
    }
  });
  return result;
};

const setsHaveSameContents = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
};

const getInitialScrollTarget = (
  toc: TOCItem[],
  href: string | undefined,
  keyOf: (item: TOCItem) => string,
  index: ChapterIndex<TOCItem>,
  chapterId?: string,
): { index: number; expanded: Set<string> } => {
  const expanded = computeExpandedSet(toc, href, chapterId, keyOf, index);
  if (!href) return { index: 0, expanded };
  const flat = flattenTOC(toc, expanded, keyOf);
  const target = chapterId ? index.node(chapterId)?.item : null;
  const idx = flat.findIndex((f) => (target ? f.item === target : f.item.href === href));
  return { index: idx > 0 ? idx : 0, expanded };
};

const TOCView: React.FC<{
  bookKey: string;
  toc: TOCItem[];
  book?: BookDoc;
}> = ({ bookKey, toc, book }) => {
  const getView = useReaderStore((state) => state.getView);
  const getProgress = useReaderStore((state) => state.getProgress);
  const isEink = useReaderStore((state) => !!state.getViewSettings(bookKey)?.isEink);
  const { sideBarBookKey, isSideBarVisible } = useSidebarStore();
  const activeHref = useReaderProgressStore(
    (s) => (s.progresses[bookKey] ?? getProgress(bookKey))?.sectionHref ?? null,
  );
  const chapterId = useReaderProgressStore(
    (s) => (s.progresses[bookKey] ?? getProgress(bookKey))?.chapterId,
  );
  const chapterIndex = useMemo(
    () => (book ? getChapterIndex(book, toc) : getStandaloneChapterIndex(toc)),
    [book, toc],
  );
  const keyOf = useCallback(
    (item: TOCItem) => chapterIndex.byItem(item)?.id ?? getItemIdentifier(item),
    [chapterIndex],
  );
  const activeItem =
    (chapterId ? chapterIndex.node(chapterId) : null)?.item ??
    chapterIndex.byHref(activeHref ?? '')?.item;
  const [initialScrollTarget] = useState(() =>
    getInitialScrollTarget(toc, activeHref ?? undefined, keyOf, chapterIndex, chapterId),
  );
  const [expandedItems, setExpandedItems] = useState<Set<string>>(initialScrollTarget.expanded);
  const [containerHeight, setContainerHeight] = useState(400);
  const [followEpoch, setFollowEpoch] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const userScrolledRef = useRef(false);
  const pendingScrollRef = useRef(false);
  const visibleCenterRef = useRef(0);
  const initialScrollHandledRef = useRef(initialScrollTarget.index > 0);
  // Don't honor userScrolledRef before the first post-mount progress arrives.
  // With a pinned sidebar, TOCView mounts before FoliateViewer emits its
  // first relocate; if any programmatic scroll (e.g. OverlayScrollbars'
  // viewport-wrap scrollTop reset) flips userScrolledRef in that window it
  // would otherwise suppress the auto-scroll once progress finally arrives.
  const initialAutoScrollProcessedRef = useRef(false);
  // Mirror the latest active item + flat list so the OverlayScrollbars
  // `initialized` callback (created at mount but fired after a deferred,
  // timing-dependent delay) can re-center on the *current* reading position.
  const activeItemRef = useRef<TOCItem | undefined>(undefined);
  const flatItemsRef = useRef<FlatTOCItem[]>([]);
  // True once the reader has genuinely driven the list (wheel/touch/pointer/
  // key). Auto-expanding the current volume on open grows the list and fires a
  // synthetic scroll event; without a real gesture behind it, that scroll must
  // not be mistaken for the user taking over and cancel the queued auto-scroll.
  const userInputRef = useRef(false);

  // OverlayScrollbars + Virtuoso integration (same pattern as Bookshelf)
  const osRootRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [initialize, osInstance] = useOverlayScrollbars({
    defer: true,
    options: { scrollbars: { autoHide: 'scroll' } },
    events: {
      initialized(instance) {
        const { viewport } = instance.elements();
        viewport.style.overflowX = 'var(--os-viewport-overflow-x)';
        viewport.style.overflowY = 'var(--os-viewport-overflow-y)';
        // OverlayScrollbars resets the wrapped viewport's scrollTop to 0 as it
        // initializes. On a fresh refresh the auto-scroll to the reading
        // position may already have run by now, so re-apply it here — using the
        // *current* active item, since initialScrollTarget was captured at mount
        // when progress was usually not yet available (index 0). Without this
        // the TOC rewinds to the very top on ~1 in 10 refreshes, depending on
        // whether this deferred init lands before or after the auto-scroll.
        const activeIdx = activeItemRef.current
          ? flatItemsRef.current.findIndex((f) => f.item === activeItemRef.current)
          : -1;
        const target = activeIdx > 0 ? activeIdx : initialScrollTarget.index;
        if (target > 0 && !userScrolledRef.current) {
          requestAnimationFrame(() => {
            if (userScrolledRef.current) return;
            virtuosoRef.current?.scrollToIndex({
              index: target,
              align: 'center',
              behavior: 'auto',
            });
          });
        }
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

  // Flag real user gestures so onScroll can tell them apart from the synthetic
  // scroll emitted when the current volume auto-expands on open.
  useEffect(() => {
    if (!scroller) return;
    const markUserInput = () => {
      userInputRef.current = true;
    };
    const passiveCapture = { capture: true, passive: true } as const;
    const capture = { capture: true } as const;
    scroller.addEventListener('wheel', markUserInput, passiveCapture);
    scroller.addEventListener('touchstart', markUserInput, passiveCapture);
    scroller.addEventListener('pointerdown', markUserInput, passiveCapture);
    scroller.addEventListener('keydown', markUserInput, capture);
    return () => {
      scroller.removeEventListener('wheel', markUserInput, passiveCapture);
      scroller.removeEventListener('touchstart', markUserInput, passiveCapture);
      scroller.removeEventListener('pointerdown', markUserInput, passiveCapture);
      scroller.removeEventListener('keydown', markUserInput, capture);
    };
  }, [scroller]);

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    setScroller(el instanceof HTMLElement ? el : null);
  }, []);

  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const parentContainer = containerRef.current.closest('.scroll-container');
        if (parentContainer) {
          const parentRect = parentContainer.getBoundingClientRect();
          const availableHeight = parentRect.height - (rect.top - parentRect.top);
          setContainerHeight(Math.max(400, availableHeight));
        }
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      const parentContainer = containerRef.current.closest('.scroll-container');
      if (parentContainer) {
        resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(parentContainer);
      }
    }
    return () => {
      window.removeEventListener('resize', updateHeight);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, []);

  const flatItems = useMemo(
    () => flattenTOC(toc, expandedItems, keyOf),
    [toc, expandedItems, keyOf],
  );
  // Keep the refs read by the OverlayScrollbars `initialized` callback current.
  activeItemRef.current = activeItem;
  flatItemsRef.current = flatItems;

  const handleToggleExpand = useCallback(
    (item: TOCItem) => {
      userScrolledRef.current = true;
      pendingScrollRef.current = false;
      const itemId = keyOf(item);
      setExpandedItems((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(itemId)) {
          newSet.delete(itemId);
        } else {
          newSet.add(itemId);
        }
        return newSet;
      });
    },
    [keyOf],
  );

  const handleItemClick = useCallback(
    (item: TOCItem) => {
      if (!item.href) return;
      eventDispatcher.dispatch('navigate', { bookKey, href: item.href });
      userScrolledRef.current = false;
      userInputRef.current = false;
      setFollowEpoch((epoch) => epoch + 1);
      const view = getView(bookKey);
      if (view?.navigate) {
        void view.navigate(item.href, { nodeId: chapterIndex.byItem(item)?.id });
      } else view?.goTo(item.href);
    },
    [bookKey, chapterIndex, getView],
  );

  useEffect(() => {
    if (!isSideBarVisible || sideBarBookKey !== bookKey) {
      userScrolledRef.current = false;
      userInputRef.current = false;
      pendingScrollRef.current = false;
      initialAutoScrollProcessedRef.current = false;
      return;
    }
    if (userScrolledRef.current && initialAutoScrollProcessedRef.current) return;
    setExpandedItems((prev) => {
      const next = computeExpandedSet(toc, activeHref ?? undefined, chapterId, keyOf, chapterIndex);
      return setsHaveSameContents(prev, next) ? prev : next;
    });
    if (activeItem) {
      if (initialScrollHandledRef.current) {
        initialScrollHandledRef.current = false;
      } else {
        pendingScrollRef.current = true;
      }
      initialAutoScrollProcessedRef.current = true;
    }
  }, [
    isSideBarVisible,
    sideBarBookKey,
    bookKey,
    toc,
    activeHref,
    chapterId,
    chapterIndex,
    activeItem,
    followEpoch,
    keyOf,
  ]);

  useEffect(() => {
    if (!pendingScrollRef.current || !activeItem || !isSideBarVisible) return;
    const idx = flatItems.findIndex((f) => f.item === activeItem);
    if (idx === -1) {
      // The active section's parents were just queued to expand by the
      // post-mount progress effect above — flatItems still reflects the
      // pre-update expandedItems. Leave pendingScrollRef set so this
      // effect retries on the next render once flatItems contains the
      // active section. Clearing it here would strand the scroll.
      return;
    }
    // Eink displays ghost previous frames during smooth JS scroll
    // animations; force an instant jump to avoid the artifact. A CSS-only
    // fix is impossible because scrollTo({ behavior: 'smooth' }) overrides
    // CSS scroll-behavior and is not a CSS transition.
    const distance = Math.abs(idx - visibleCenterRef.current);
    const behavior = isEink || distance > 16 ? 'auto' : 'smooth';
    virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior });
    // When the current volume auto-expands on open, the list grows by dozens of
    // rows in this same commit. Virtuoso scrolls before measuring the new rows,
    // so a single scrollToIndex lands short. Re-assert on the next frame (once
    // they're measured) for the instant-jump case so the chapter ends centered.
    if (behavior === 'auto') {
      requestAnimationFrame(() => {
        if (!userScrolledRef.current && activeItemRef.current === activeItem)
          virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'auto' });
      });
    }
    pendingScrollRef.current = false;
  }, [flatItems, activeItem, isSideBarVisible, isEink, followEpoch]);

  return (
    <div ref={containerRef} className='toc-list rounded' role='tree'>
      <div ref={osRootRef} data-overlayscrollbars-initialize='' style={{ height: containerHeight }}>
        <Virtuoso
          ref={virtuosoRef}
          scrollerRef={handleScrollerRef}
          initialTopMostItemIndex={
            initialScrollTarget.index > 0
              ? { index: initialScrollTarget.index, align: 'center' }
              : 0
          }
          rangeChanged={({ startIndex, endIndex }) => {
            visibleCenterRef.current = Math.floor((startIndex + endIndex) / 2);
          }}
          onScroll={() => {
            // A scroll arriving while a pending auto-scroll is still queued
            // (idx === -1, waiting on flatItems to expand) normally means the
            // user is now driving — drop the queued auto-scroll so the next
            // render doesn't yank them away. But auto-expanding the current
            // volume on open grows the list and emits a synthetic scroll with
            // no gesture behind it; ignore that so the initial auto-scroll
            // survives. A real user scroll still cancels it via userInputRef.
            if (!userInputRef.current) return;
            pendingScrollRef.current = false;
            userScrolledRef.current = true;
          }}
          style={{ height: containerHeight }}
          totalCount={flatItems.length}
          computeItemKey={(index) => flatItems[index]?.id ?? index}
          itemContent={(index) => {
            const flatItem = flatItems[index]!;
            return (
              <StaticListRow
                bookKey={bookKey}
                flatItem={flatItem}
                activeHref={activeHref}
                active={flatItem.item === activeItem}
                onToggleExpand={handleToggleExpand}
                onItemClick={handleItemClick}
              />
            );
          }}
          overscan={500}
        />
      </div>
    </div>
  );
};
export default TOCView;
