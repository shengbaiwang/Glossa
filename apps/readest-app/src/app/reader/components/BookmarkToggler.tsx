import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark } from '@/components/GlossaIcons';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { BookNote } from '@/types/book';
import Button from '@/components/Button';
import { eventDispatcher } from '@/utils/event';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { createBookmark, extractBookmarkExcerpt, findBookmarksAtLocation } from '../utils/bookmark';

interface BookmarkTogglerProps {
  bookKey: string;
}

/**
 * Add/remove the bookmark for the page the reader is on.
 *
 * Toggle decisions come from the stored bookmarks themselves (which starts fall
 * inside the current visible range), not from a cached "bookmarked" flag — so
 * add and remove are symmetric, and a page that reflowed since the bookmark was
 * saved still toggles off instead of gaining a duplicate.
 */
const BookmarkToggler: React.FC<BookmarkTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((s) => s.settings);
  const updateBooknotes = useBookDataStore((s) => s.updateBooknotes);
  const saveConfig = useBookDataStore((s) => s.saveConfig);
  const setBookmarkRibbonVisibility = useReaderStore((s) => s.setBookmarkRibbonVisibility);
  const isPrimary = useReaderStore((s) => !!s.viewStates[bookKey]?.isPrimary);
  const config = useBookDataStore((s) => s.booksData[bookKey.split('-')[0]!]?.config);
  const progress = useBookProgress(bookKey);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const iconSize18 = useResponsiveSize(18);

  const persistRef = useRef<(booknotes: BookNote[]) => void>(() => {});
  persistRef.current = (booknotes) => {
    const updatedConfig = updateBooknotes(bookKey, booknotes);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
  };

  const toggleBookmark = useCallback(() => {
    const { location: cfi, range, page } = progress ?? {};
    if (!cfi) return;

    const booknotes = config?.booknotes ?? [];
    const liveBookmarks = booknotes.filter((n) => n.type === 'bookmark' && !n.deletedAt);
    const matches = findBookmarksAtLocation(liveBookmarks, cfi);

    if (matches.length > 0) {
      // This page is bookmarked (possibly with duplicates left by an older
      // version): remove all of them.
      const ids = new Set(matches.map((m) => m.id));
      const now = Date.now();
      persistRef.current(
        booknotes.map((note) =>
          ids.has(note.id) && !note.deletedAt ? { ...note, deletedAt: now, updatedAt: now } : note,
        ),
      );
      return;
    }

    // The excerpt is the text the reader actually sees; when the page has no
    // extractable text (e.g. an image page), fall back to the page number.
    const text = extractBookmarkExcerpt(range) || `${page ?? 0}`;
    persistRef.current([...booknotes, createBookmark({ cfi, text, page, now: Date.now() })]);
  }, [progress, config]);

  // The dispatcher path (shortcut, pull-down gesture, empty state) fires from
  // outside React, so it must reach the latest toggle — a mount-time closure
  // would bookmark with a stale settings snapshot.
  const toggleRef = useRef(toggleBookmark);
  toggleRef.current = toggleBookmark;

  useEffect(() => {
    const handleBookmarkToggle = (e: CustomEvent) => {
      const { bookKey: eventBookKey } = e.detail ?? {};
      if (eventBookKey !== bookKey) return;
      toggleRef.current();
    };
    eventDispatcher.on('toggle-bookmark', handleBookmarkToggle);
    return () => {
      eventDispatcher.off('toggle-bookmark', handleBookmarkToggle);
    };
  }, [bookKey]);

  // Derived state: whether the current page is bookmarked, the pull-down
  // ribbon, and — on the primary view — refreshing the stored page number of
  // any bookmark in view. Page numbers are layout-dependent, so a bookmark
  // saved before a font-size or window change shows a stale page; correcting
  // it on encounter keeps the list honest. The write converges (one per
  // bookmark per layout) and is limited to the primary view so parallel
  // reading views can't fight over the value.
  useEffect(() => {
    const cfi = progress?.location;
    if (!cfi) return;

    const booknotes = config?.booknotes ?? [];
    const liveBookmarks = booknotes.filter((n) => n.type === 'bookmark' && !n.deletedAt);
    const matches = findBookmarksAtLocation(liveBookmarks, cfi);
    const bookmarked = matches.length > 0;
    setIsBookmarked(bookmarked);
    setBookmarkRibbonVisibility(bookKey, bookmarked);

    const page = progress?.page;
    if (
      isPrimary &&
      bookmarked &&
      typeof page === 'number' &&
      page > 0 &&
      matches.some((m) => m.page !== page)
    ) {
      const ids = new Set(matches.map((m) => m.id));
      const now = Date.now();
      persistRef.current(
        (booknotes as BookNote[]).map((note) =>
          ids.has(note.id) && note.page !== page ? { ...note, page, updatedAt: now } : note,
        ),
      );
    }
  }, [bookKey, config, progress?.location, progress?.page, isPrimary, setBookmarkRibbonVisibility]);

  return (
    <Button
      icon={
        <Bookmark
          size={iconSize18}
          fill={isBookmarked ? 'currentColor' : 'none'}
          aria-hidden='true'
        />
      }
      className='glossa-icon-button'
      aria-pressed={isBookmarked}
      onClick={toggleBookmark}
      label={isBookmarked ? _('Remove Bookmark') : _('Add Bookmark')}
    ></Button>
  );
};

export default BookmarkToggler;
