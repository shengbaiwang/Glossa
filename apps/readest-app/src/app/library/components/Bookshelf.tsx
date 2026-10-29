import { getLibraryCoverWidth } from '@/utils/libraryDisplaySettings';
import { resolveLibraryDisplay } from '../utils/libraryUtils';
import clsx from 'clsx';
import { Plus, SearchCheck, SearchX } from '@/components/GlossaIcons';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';
import {
  Virtuoso,
  VirtuosoGrid,
  type Components,
  type GridComponents,
  type GridListProps,
  type ListProps,
} from 'react-virtuoso';
import { Book, BooksGroup, type LibrarySearchConfig, ReadingStatus } from '@/types/book';
import {
  LibraryCoverFitType,
  LibraryGroupByType,
  LibrarySortByType,
  LibraryViewModeType,
} from '@/types/settings';
import { useEnv } from '@/context/EnvContext';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { useSettingsStore } from '@/store/settingsStore';
import { removalScope } from '@/services/appBookRemoval';
import { useLibraryStore } from '@/store/libraryStore';
import { useLibraryFolders } from '../hooks/useLibraryFolders';
import { useLibraryClipboard } from '../hooks/useLibraryClipboard';
import { useLibraryItemDrop } from '../hooks/useLibraryItemDrop';
import {
  captureCurrentLibraryTransfer,
  cutLibraryItems,
  useLibraryTransfer,
  type LibraryTransfer,
} from '../utils/libraryTransfer';
import { useLibraryBookEdits } from '../hooks/useLibraryBookEdits';
import { useLibraryMarquee } from '../hooks/useLibraryMarquee';
import FolderToolbar from './FolderToolbar';
import FolderDeleteDialog from './FolderDeleteDialog';
import BookContextMenuPopup from './BookContextMenuPopup';
import { md5Fingerprint } from '@/utils/md5';
import { useTranslation } from '@/hooks/useTranslation';
import { navigateToLibrary, navigateToReader } from '@/utils/nav';
import {
  createBookFilter,
  createBookGroups,
  createBookSorter,
  createGroupSorter,
  createWithinGroupSorter,
  expandBookshelfSelection,
  getBookSortValue,
  getGroupSortValue,
  getLibraryCategoryLabel,
  compareSortValues,
  resolveCurrentShelfBooks,
  selectDownloadableBooks,
  selectRecentShelfBooks,
  withTimeRemainingLast,
} from '../utils/libraryUtils';
import { eventDispatcher } from '@/utils/event';

import { resolveLibrarySelection, type LibrarySelectionOptions } from '../utils/librarySelection';
import { useSpatialNavigation } from '../hooks/useSpatialNavigation';
import type { RemovalResult } from '@/services/bookRemovalService';
import DeleteConfirmAlert from '@/components/DeleteConfirmAlert';
import Spinner from '@/components/Spinner';
import ModalPortal from '@/components/ModalPortal';
import BookshelfItem, { generateBookshelfItems } from './BookshelfItem';
import GroupingModal from './GroupingModal';
import RecentShelf, { RECENT_SHELF_BOOK_COUNT } from './RecentShelf';
import { useOpenBook } from '../hooks/useOpenBook';
import LibrarySearchResults from './LibrarySearchResults';

export interface ContentSearchRequest {
  query: string;
  config: LibrarySearchConfig;
}

interface BookshelfProps {
  libraryBooks: Book[];
  onScrollerRef: (el: HTMLDivElement | null) => void;
  handleImportBooks: (anchor: HTMLElement) => void;
  renderGroupNavigation?: (openMenu: (anchor: HTMLElement) => void) => React.ReactNode;
  handleBookDownload: (
    book: Book,
    options?: { redownload?: boolean; queued?: boolean; silent?: boolean },
  ) => Promise<boolean>;
  handleBookUpload: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  onRemoveBooks?: (
    books: Book[],
    options?: { signal?: AbortSignal; onProgress?: (result: RemovalResult) => void },
  ) => Promise<RemovalResult>;
  handleBookDelete: (book: Book, signal?: AbortSignal) => Promise<boolean>;
  handleBookPurge?: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleShowDetailsBook: (book: Book) => void;
  handleLibraryNavigation: (targetGroup: string) => void;
  handlePushLibrary: () => Promise<void>;
  booksTransferProgress: { [key: string]: number | null };
  contentSearch: ContentSearchRequest | null;
  onSearchContents: () => void;
  onSearchProgress?: (value: number | null) => void;
}

/**
 * Context passed to the custom Virtuoso `List` components so they can render
 * grid styles that depend on runtime settings without being re-created on
 * every Bookshelf render (which would break Virtuoso's component identity).
 */
type BookshelfListContext = {
  coverWidth: number;
  listScale: number;
  /**
   * The recently-read shelf, rendered in the Virtuoso header so it scrolls with
   * the shelf content (not sticky). `null` when hidden. Passed through context
   * (rather than recreating the Header component) so Virtuoso keeps the Header
   * identity stable and does not reset its scroller on every Bookshelf render.
   */
  recentShelfHeader: React.ReactNode;
  collectionTitle: string | null;
  collectionCount: string;
  libraryTitle: string | null;
  onGroupMenu?: (element: HTMLElement) => void;
  /**
   * Trailing breathing room below the last book.
   */
  footerHeight: number;
};

const DEFAULT_FOOTER_HEIGHT = 34;

const BookshelfFooter = ({ context }: { context?: BookshelfListContext }) => (
  <div style={{ height: context?.footerHeight ?? DEFAULT_FOOTER_HEIGHT }} />
);

const BOOKSHELF_GRID_CLASSES = 'bookshelf-items glossa-collection-grid transform-wrapper grid';

const BOOKSHELF_LIST_CLASSES =
  'bookshelf-items glossa-collection-list transform-wrapper flex flex-col';

const BookshelfGridList: GridComponents<BookshelfListContext>['List'] = React.forwardRef<
  HTMLDivElement,
  GridListProps & { context?: BookshelfListContext }
>(({ children, className, style, context, 'data-testid': testId }, ref) => (
  <div
    ref={ref}
    data-testid={testId}
    data-spatial-navigation='collection'
    className={clsx(BOOKSHELF_GRID_CLASSES, className)}
    style={{
      ...style,
      gridTemplateColumns: `repeat(auto-fill, minmax(0, min(${context?.coverWidth ?? 156}px, 100%)))`,
    }}
  >
    {children}
  </div>
));
BookshelfGridList.displayName = 'BookshelfGridList';

const BookshelfLinearList: Components<unknown, BookshelfListContext>['List'] = React.forwardRef<
  HTMLDivElement,
  ListProps & { context?: BookshelfListContext }
>(({ children, style, context, 'data-testid': testId }, ref) => (
  <div
    ref={ref}
    data-testid={testId}
    data-spatial-navigation='collection'
    className={BOOKSHELF_LIST_CLASSES}
    style={
      { ...style, '--glossa-list-scale': (context?.listScale ?? 100) / 100 } as React.CSSProperties
    }
  >
    {children}
  </div>
));
BookshelfLinearList.displayName = 'BookshelfLinearList';

const BookshelfHeader = ({ context }: { context?: BookshelfListContext }) => (
  <div className='glossa-shelf-header transform-wrapper'>
    {context?.libraryTitle && (
      <div className='glossa-library-heading'>
        <h1>{context.libraryTitle}</h1>
      </div>
    )}
    {context?.recentShelfHeader ?? null}
    {context?.collectionTitle && (
      <div className='glossa-collection-heading'>
        <h2>
          {context?.onGroupMenu ? (
            <button
              type='button'
              aria-haspopup='menu'
              className='glossa-folder-heading-action'
              onClick={(event) => context.onGroupMenu?.(event.currentTarget)}
            >
              {context.collectionTitle}
            </button>
          ) : (
            context?.collectionTitle
          )}
        </h2>
        <span>{context?.collectionCount}</span>
      </div>
    )}
  </div>
);

const GRID_VIRTUOSO_COMPONENTS: GridComponents<BookshelfListContext> = {
  List: BookshelfGridList,
  Header: BookshelfHeader,
  Footer: BookshelfFooter,
};
const LIST_VIRTUOSO_COMPONENTS: Components<unknown, BookshelfListContext> = {
  List: BookshelfLinearList,
  Header: BookshelfHeader,
  Footer: BookshelfFooter,
};

const Bookshelf: React.FC<BookshelfProps> = ({
  libraryBooks,
  onScrollerRef,
  handleImportBooks,
  renderGroupNavigation,
  handleBookUpload,
  handleBookDownload,
  handleBookDelete,
  onRemoveBooks,
  handleShowDetailsBook,
  handleLibraryNavigation,
  handlePushLibrary,
  booksTransferProgress,
  contentSearch,
  onSearchContents,
  onSearchProgress,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();

  const groupId = searchParams?.get('group') || '';
  const queryTerm = searchParams?.get('q')?.trim() || null;
  const { viewMode, sortBy, groupBy, thenSortBy, isAscending, isThenAscending, coverFit } =
    resolveLibraryDisplay(settings, searchParams);
  const sortOrder = isAscending ? 'asc' : 'desc';
  const thenSortOrder = isThenAscending ? 'asc' : 'desc';
  const showTimeRemaining =
    sortBy === LibrarySortByType.TimeRemaining || thenSortBy === LibrarySortByType.TimeRemaining;

  const [loading, setLoading] = useState(false);
  const [bookIdsToDelete, setBookIdsToDelete] = useState<string[]>([]);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [showGroupingModal, setShowGroupingModal] = useState(false);
  const [importBookUrl] = useState(searchParams?.get('url') || '');

  const deletionController = useRef<AbortController | null>(null);
  const [groupPathsToDelete, setGroupPathsToDelete] = useState<string[]>([]);
  const [deletionProgress, setDeletionProgress] = useState<RemovalResult | null>(null);
  useEffect(() => () => deletionController.current?.abort(), []);
  const isImportingBook = useRef(false);
  const autofocusRef = useAutoFocus<HTMLDivElement>();

  const { setCurrentBookshelf, setLibrary } = useLibraryStore();
  const { setSelectedBooks, getSelectedBooks } = useLibraryStore();
  // The raw Set from the store: its identity only changes when the selection
  // does, so memos keyed on it stay stable across unrelated re-renders
  // (getSelectedBooks() allocates a fresh array per call).
  const { selectedBooks: selectedBookSet } = useLibraryStore();
  const { getGroupName } = useLibraryStore();
  const folders = useLibraryFolders();
  const clipboard = useLibraryClipboard(folders);
  const bookEdits = useLibraryBookEdits();
  useEffect(() => {
    bookEdits.clearUndo();
  }, [folders.revision, bookEdits.clearUndo]);
  const [creatingFolder, setCreatingFolder] = useState<string | null>(null);
  const [creatingWithItems, setCreatingWithItems] = useState<LibraryTransfer | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number } | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null);
  const removeFolder = async (path: string) => {
    if (
      folders.paths.some((p) => p.startsWith(`${path}/`)) ||
      useLibraryStore.getState().library.some((book) => !book.deletedAt && book.groupName === path)
    ) {
      setDeletingFolder(path);
      return false;
    }
    return folders.remove(path);
  };
  const createFolder = async (parent: string, name: string) => {
    const path = creatingWithItems
      ? await folders.createWithItems(parent, name, creatingWithItems)
      : await folders.create(parent, name);
    if (path && creatingWithItems && groupBy !== LibraryGroupByType.Group) {
      const params = new URLSearchParams(window.location.search);
      params.set('groupBy', LibraryGroupByType.Group);
      params.set('group', parent ? md5Fingerprint(parent) : '');
      params.delete('q');
      navigateToLibrary(router, params.toString());
    }
    return path;
  };
  const renameFolder = async (path: string, name: string) => {
    return folders.rename(path, name);
  };

  const uiLanguage = localStorage?.getItem('i18nextLng') || '';

  const updateUrlParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(window.location.search);

      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      const newParamString = params.toString();
      const currentParamString = window.location.search.slice(1);

      if (newParamString !== currentParamString) {
        navigateToLibrary(router, newParamString);
      }
    },
    [router, searchParams, settings.libraryGroupBy],
  );

  const filteredBooks = useMemo(() => {
    const bookFilter = createBookFilter(queryTerm);
    return queryTerm ? libraryBooks.filter((book) => bookFilter(book)) : libraryBooks;
  }, [libraryBooks, queryTerm]);

  const remappedGroup =
    groupBy === LibraryGroupByType.Group && !getGroupName(groupId)
      ? folders.remappedGroup(groupId)
      : undefined;
  const manualGroupName =
    groupBy === LibraryGroupByType.Group ? (getGroupName(groupId) ?? remappedGroup) : undefined;
  const beginCreateWithItems = () => {
    if (folders.busy) return;
    const snapshot = captureCurrentLibraryTransfer(getSelectedBooks());
    if (!snapshot) return;
    folders.clearError();
    setCreatingWithItems(snapshot);
    setCreatingFolder(manualGroupName ?? '');
  };
  const currentShelfBooks = useMemo(
    () => resolveCurrentShelfBooks(libraryBooks, groupBy, groupId, manualGroupName),
    [libraryBooks, groupBy, groupId, manualGroupName],
  );
  const filteredShelfBooks = useMemo(() => {
    const bookFilter = createBookFilter(queryTerm);
    return queryTerm ? currentShelfBooks.filter(bookFilter) : currentShelfBooks;
  }, [currentShelfBooks, queryTerm]);

  const currentBookshelfItems = useMemo(() => {
    if (groupBy === LibraryGroupByType.Group) {
      // Use existing generateBookshelfItems for group mode
      const groupName = manualGroupName || '';
      if (groupId && !manualGroupName) {
        return [];
      }
      return generateBookshelfItems(filteredShelfBooks, groupName, queryTerm ? [] : folders.paths);
    } else {
      if (groupId) return filteredShelfBooks;
      return createBookGroups(filteredShelfBooks, groupBy);
    }
  }, [filteredShelfBooks, groupBy, groupId, manualGroupName, queryTerm, folders.paths]);

  useEffect(() => {
    if (remappedGroup !== undefined) {
      updateUrlParams({ group: remappedGroup ? md5Fingerprint(remappedGroup) : null });
    } else if (
      groupId &&
      currentShelfBooks.length === 0 &&
      !(groupBy === LibraryGroupByType.Group && manualGroupName)
    ) {
      updateUrlParams({ group: null });
    } else {
      updateUrlParams({});
    }
  }, [
    searchParams,
    groupId,
    groupBy,
    manualGroupName,
    remappedGroup,
    currentShelfBooks.length,
    updateUrlParams,
  ]);

  const sortedBookshelfItems = useMemo(() => {
    const sortOrderMultiplier = sortOrder === 'asc' ? 1 : -1;

    // Separate into ungrouped books and groups
    const ungroupedBooks = currentBookshelfItems.filter((item): item is Book => 'format' in item);
    const groups = currentBookshelfItems.filter((item): item is BooksGroup => 'books' in item);

    // Sort books within each group
    // For series groups, series index is always ascending; sort direction applies to fallback only
    const sortAscending = sortOrder === 'asc';
    const thenSortAscending = thenSortOrder === 'asc';
    const withinGroupSorter = withTimeRemainingLast<Book>(
      sortBy,
      createWithinGroupSorter(
        groupBy,
        sortBy,
        uiLanguage,
        sortAscending,
        thenSortBy,
        thenSortAscending,
      ),
    );
    groups.forEach((group) => {
      group.books.sort(withinGroupSorter);
    });

    // Sort ungrouped books - use within-group sorter if we're inside a group
    // (for series, this ensures books are sorted by series index)
    // `bookSorter` already carries both sort directions, so it is never multiplied
    // by `sortOrderMultiplier` — that would flip the secondary key too (#5119).
    const bookSorter = createBookSorter(
      sortBy,
      uiLanguage,
      thenSortBy,
      sortAscending,
      thenSortAscending,
    );
    if (groupId && groupBy !== LibraryGroupByType.Group && groupBy !== LibraryGroupByType.None) {
      ungroupedBooks.sort(withinGroupSorter);
      // When inside a group, books are already sorted correctly — return directly
      // to avoid the merge sort below overriding the within-group sort order
      return ungroupedBooks;
    } else {
      ungroupedBooks.sort(withTimeRemainingLast<Book>(sortBy, bookSorter));
    }

    if (groupBy === LibraryGroupByType.Group) {
      const order = new Map(folders.paths.map((path, i) => [path, i]));
      groups.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
      return [...groups, ...ungroupedBooks];
    }
    // Merge groups and ungrouped books, then sort them together
    const allItems: (Book | BooksGroup)[] = [...groups, ...ungroupedBooks];
    const groupSorter = createGroupSorter(sortBy, uiLanguage, groupBy);

    allItems.sort(
      withTimeRemainingLast<Book | BooksGroup>(sortBy, (a, b) => {
        const isAGroup = 'books' in a;
        const isBGroup = 'books' in b;

        // If both are groups, use group sorter
        if (isAGroup && isBGroup) {
          return groupSorter(a, b) * sortOrderMultiplier;
        }

        // If both are books, use book sorter
        if (!isAGroup && !isBGroup) {
          return bookSorter(a, b);
        }

        // For series/author groups: compare sort values to interleave properly
        if (isAGroup && !isBGroup) {
          const groupValue = getGroupSortValue(a, sortBy, groupBy);
          const bookValue = getBookSortValue(b, sortBy);
          return compareSortValues(groupValue, bookValue, uiLanguage) * sortOrderMultiplier;
        } else if (!isAGroup && isBGroup) {
          const bookValue = getBookSortValue(a, sortBy);
          const groupValue = getGroupSortValue(b, sortBy, groupBy);
          return compareSortValues(bookValue, groupValue, uiLanguage) * sortOrderMultiplier;
        }
        return 0;
      }),
    );

    return allItems;
  }, [
    sortOrder,
    thenSortOrder,
    sortBy,
    thenSortBy,
    groupBy,
    groupId,
    uiLanguage,
    currentBookshelfItems,
    folders.paths,
  ]);

  useEffect(() => {
    if (isImportingBook.current) return;
    isImportingBook.current = true;

    if (importBookUrl && appService) {
      const importBook = async () => {
        console.log('Importing book from URL:', importBookUrl);
        const book = await appService.importBook(importBookUrl, libraryBooks);
        if (book) {
          setLibrary(libraryBooks);
          appService.saveLibraryBooks(libraryBooks);
          navigateToReader(router, [book.hash]);
        }
      };
      importBook();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importBookUrl, appService]);

  useEffect(() => {
    setCurrentBookshelf(currentShelfBooks);
  }, [currentShelfBooks, setCurrentBookshelf]);

  const selectionAnchor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedBookSet.size) selectionAnchor.current = null;
  }, [selectedBookSet]);
  const selectItem = useCallback(
    (id: string, options: LibrarySelectionOptions = {}) => {
      const order =
        options.order ?? sortedBookshelfItems.map((item) => ('hash' in item ? item.hash : item.id));
      const next = resolveLibrarySelection(
        getSelectedBooks(),
        selectionAnchor.current,
        id,
        order,
        options,
      );
      selectionAnchor.current = next.anchor;
      setSelectedBooks(next.selected);
    },
    [sortedBookshelfItems, setSelectedBooks, getSelectedBooks],
  );
  const clearSelection = useCallback(() => {
    selectionAnchor.current = null;
    setSelectedBooks([]);
  }, [setSelectedBooks]);
  useSpatialNavigation(autofocusRef, selectItem);

  // Navigation starts a fresh selection; progress refreshes preserve it.
  useEffect(() => {
    clearSelection();
  }, [groupId, groupBy, queryTerm, clearSelection]);

  // Only explicitly selected book identities are removed; groups never expand here.
  const getBooksToDelete = () => {
    const wanted = new Set(bookIdsToDelete);
    return libraryBooks.filter((book) => wanted.has(book.hash) && !book.deletedAt);
  };

  const confirmDelete = async () => {
    if (deletionController.current) return;
    const controller = new AbortController();
    deletionController.current = controller;
    try {
      if (groupPathsToDelete.length) {
        if (!(await folders.removeMany(groupPathsToDelete)))
          throw new Error('Group removal failed');
        setGroupPathsToDelete([]);
      }
      const wanted = new Set(bookIdsToDelete);
      const books = useLibraryStore
        .getState()
        .library.filter((book) => wanted.has(book.hash) && !book.deletedAt);
      if (books.length) {
        if (onRemoveBooks) {
          const result = await onRemoveBooks(books, {
            signal: controller.signal,
            onProgress: setDeletionProgress,
          });
          setSelectedBooks([...result.failed, ...result.pending]);
        } else {
          const remaining: string[] = [];
          for (const book of books) {
            if (controller.signal.aborted || !(await handleBookDelete(book, controller.signal)))
              remaining.push(book.hash);
          }
          setSelectedBooks(remaining);
          await handlePushLibrary();
        }
      } else setSelectedBooks([]);
      setShowDeleteAlert(false);
    } finally {
      deletionController.current = null;
    }
  };

  const beginDeletion = (ids: string[]) => {
    const wanted = new Set(ids);
    const groups =
      groupBy === LibraryGroupByType.Group
        ? sortedBookshelfItems.flatMap((item) =>
            'books' in item && wanted.has(item.id) ? [item.name] : [],
          )
        : [];
    // A selected container is dissolved. It never expands implicitly into book deletion.
    const books = libraryBooks.filter((book) => wanted.has(book.hash) && !book.deletedAt);
    if (!groups.length && !books.length) return;
    setGroupPathsToDelete(groups);
    setBookIdsToDelete(books.map((book) => book.hash));
    setDeletionProgress(null);
    setShowDeleteAlert(true);
  };
  const deleteSelectedBooks = async () => beginDeletion(getSelectedBooks());

  const groupSelectedBooks = () => {
    setShowGroupingModal(true);
  };

  const handleRenameBook = useCallback(
    (book: Book, title: string) => bookEdits.apply([book], 'title', title),
    [bookEdits.apply],
  );
  const handleUpdateReadingStatus = useCallback(
    async (book: Book, status: ReadingStatus | undefined) => {
      const selection = getSelectedBooks();
      const ids = selection.includes(book.hash)
        ? expandBookshelfSelection(selection, sortedBookshelfItems)
        : [book.hash];
      await bookEdits.apply(
        useLibraryStore.getState().library.filter((b) => ids.includes(b.hash)),
        'readingStatus',
        status,
      );
    },
    [bookEdits.apply, getSelectedBooks, sortedBookshelfItems],
  );

  const handleDeleteBooksIntent = (event: CustomEvent) => {
    const { ids } = event.detail;
    beginDeletion(ids);
  };

  useEffect(() => {
    eventDispatcher.on('delete-books', handleDeleteBooksIntent);
    return () => {
      eventDispatcher.off('delete-books', handleDeleteBooksIntent);
    };
  }, [sortedBookshelfItems]);

  useEffect(() => {
    const move = () => {
      if (getSelectedBooks().length) groupSelectedBooks();
    };
    const remove = () => {
      if (getSelectedBooks().length) void deleteSelectedBooks();
    };
    eventDispatcher.on('library-move-selection', move);
    eventDispatcher.on('library-delete-selection', remove);
    eventDispatcher.on('library-create-from-selection', beginCreateWithItems);
    return () => {
      eventDispatcher.off('library-move-selection', move);
      eventDispatcher.off('library-delete-selection', remove);
      eventDispatcher.off('library-create-from-selection', beginCreateWithItems);
    };
  });

  // OverlayScrollbars + Virtuoso integration: Virtuoso manages its own
  // scroller; OverlayScrollbars wraps it for overlay scrollbar rendering.
  const osRootRef = useRef<HTMLDivElement>(null);
  const selectionRootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useLibraryItemDrop({
    root: autofocusRef,
    scroller: scrollRef,
    name: 'shelf',
    disabled:
      folders.busy || loading || creatingFolder !== null || showDeleteAlert || showGroupingModal,
    move: folders.moveItems,
    hover: (path) => {
      if (path === (manualGroupName ?? '')) return;
      const origin = groupId;
      const top = scrollRef.current?.scrollTop ?? 0;
      const selection = getSelectedBooks();
      handleLibraryNavigation(path ? md5Fingerprint(path) : '');
      return () => {
        handleLibraryNavigation(origin);
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = top;
          setSelectedBooks(captureCurrentLibraryTransfer(selection) ? selection : []);
          autofocusRef.current?.focus();
        });
      };
    },
  });
  const [initialize, osInstance] = useOverlayScrollbars({
    defer: true,
    options: { scrollbars: { autoHide: 'scroll' } },
    events: {
      initialized(instance) {
        const { viewport } = instance.elements();
        viewport.style.overflowX = 'var(--os-viewport-overflow-x)';
        viewport.style.overflowY = 'var(--os-viewport-overflow-y)';
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

  // Expose the Virtuoso scroller to the parent for pull-to-refresh & scroll save.
  const handleScrollerRef = useCallback(
    (el: HTMLElement | Window | null) => {
      const div = el instanceof HTMLElement ? el : null;
      if (div) div.setAttribute('data-library-scroll', '');
      scrollRef.current = div;
      setScroller(div);
      onScrollerRef(div as HTMLDivElement | null);
    },
    [onScrollerRef],
  );

  const selectedBooks = getSelectedBooks();

  // Selected groups stand in for their books when downloading from a cloud badge.
  const downloadableBooks =
    selectedBooks.length > 0
      ? selectDownloadableBooks(selectedBooks, sortedBookshelfItems, filteredBooks)
      : [];

  const downloadSelectedBooks = async () => {
    const books = downloadableBooks;
    if (books.length === 0) return;
    clearSelection();
    // One summary up front rather than a toast per book: the Readest Cloud
    // path returns as soon as each book is queued, but a file backend
    // actually fetches them, and either way the user needs immediate feedback
    // that the batch started.
    eventDispatcher.dispatch('toast', {
      type: 'info',
      timeout: 2000,
      message: _('Downloading {{count}} book(s)', { count: books.length }),
    });
    // Batched like the bulk delete path so a file backend isn't hit with
    // hundreds of simultaneous fetches.
    const concurrency = 20;
    let failed = 0;
    for (let i = 0; i < books.length; i += concurrency) {
      const batch = books.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((book) => handleBookDownload(book, { queued: true, silent: true })),
      );
      failed += results.filter((ok) => !ok).length;
    }
    if (failed > 0) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to download {{count}} book(s)', { count: failed }),
      });
    }
  };

  const downloadFromCard = async (
    book: Book,
    options?: { redownload?: boolean; queued?: boolean },
  ) => {
    if (getSelectedBooks().includes(book.hash) && getSelectedBooks().length > 1) {
      await downloadSelectedBooks();
      return true;
    }
    return handleBookDownload(book, options);
  };

  const isGridMode = viewMode === 'grid';
  const hasItems = sortedBookshelfItems.length > 0;
  // In grid mode the Import-Books "+" tile is rendered as an extra grid cell
  // after all books. We represent it to Virtuoso as an extra index past the
  // last book; list mode doesn't have an import tile.

  // Recently-read shelf: shares the availability-aware open path with per-item
  // taps so cloud-only synced books download before opening. `openBook` is
  // memoized inside the hook, keeping `openRecentBook` -> `recentShelfHeader`
  // -> `listContext` identities stable (no full-grid re-render churn).
  const { openBook } = useOpenBook({ setLoading, handleBookDownload });
  const openRecentBook = useCallback((book: Book) => openBook(book), [openBook]);
  const openSearchResult = useCallback(
    (book: Book, cfi: string) => openBook(book, cfi, { highlightSearchResult: true }),
    [openBook],
  );

  // Flat recency slice of the whole library, independent of the main shelf's
  // sort/grouping. Built from `libraryBooks` (not the sorted/filtered items).
  const recentBooks = useMemo(
    () => selectRecentShelfBooks(libraryBooks, RECENT_SHELF_BOOK_COUNT),
    [libraryBooks],
  );

  // A top-level quick-resume strip: hidden while searching, inside a group, or
  // when nothing has been read yet. Selection is shared with the main collection.
  const showRecentShelf =
    settings.libraryRecentShelfEnabled && !queryTerm && !groupId && recentBooks.length > 0;

  const recentShelfHeader = useMemo(
    () =>
      showRecentShelf ? (
        <RecentShelf
          books={recentBooks}
          coverFit={coverFit as LibraryCoverFitType}
          selectedBooks={selectedBookSet}
          onOpenBook={openRecentBook}
          selectItem={selectItem}
          handleBookUpload={handleBookUpload}
          handleBookDownload={downloadFromCard}
          showBookDetailsModal={handleShowDetailsBook}
          showTimeRemaining={showTimeRemaining}
          handleRenameBook={handleRenameBook}
          handleUpdateReadingStatus={handleUpdateReadingStatus}
          handleGroupBooks={groupSelectedBooks}
        />
      ) : null,
    [
      showRecentShelf,
      recentBooks,
      coverFit,
      selectedBookSet,
      openRecentBook,
      selectItem,
      handleBookUpload,
      handleBookDownload,
      handleShowDetailsBook,
      handleRenameBook,
      handleUpdateReadingStatus,
      showTimeRemaining,
    ],
  );

  const footerHeight = DEFAULT_FOOTER_HEIGHT;

  const listContext = useMemo<BookshelfListContext>(
    () => ({
      coverWidth: getLibraryCoverWidth(settings),
      listScale: settings.libraryListScale ?? 100,
      recentShelfHeader,
      collectionTitle: queryTerm
        ? _('Search Results')
        : groupId
          ? null
          : groupBy === LibraryGroupByType.None || groupBy === LibraryGroupByType.Group
            ? _('All books')
            : _(getLibraryCategoryLabel(groupBy)),
      collectionCount:
        !groupId && groupBy !== LibraryGroupByType.None && groupBy !== LibraryGroupByType.Group
          ? _('{{count}} groups', {
              count: currentBookshelfItems.filter((item) => 'books' in item).length,
            })
          : _('{{count}} books', { count: filteredShelfBooks.length }),
      libraryTitle:
        !groupId && !queryTerm
          ? groupBy === LibraryGroupByType.None
            ? _('Your Library')
            : null
          : null,
      footerHeight,
      onGroupMenu:
        groupBy === LibraryGroupByType.Group && !queryTerm
          ? (element) => {
              const rect = element.getBoundingClientRect();
              setFolderMenu({ x: rect.left, y: rect.bottom });
            }
          : undefined,
    }),
    [
      settings.libraryCoverWidth,
      settings.libraryListScale,
      recentShelfHeader,
      queryTerm,
      groupId,
      groupBy,
      filteredShelfBooks.length,
      currentBookshelfItems,
      _,
      footerHeight,
    ],
  );

  const renderBookshelfItem = useCallback(
    (index: number) => {
      const item = sortedBookshelfItems[index];
      if (!item) return null;
      const itemSelected =
        'hash' in item ? selectedBooks.includes(item.hash) : selectedBooks.includes(item.id);
      return (
        <BookshelfItem
          item={item}
          mode={viewMode as LibraryViewModeType}
          coverFit={coverFit as LibraryCoverFitType}
          itemSelected={itemSelected}
          setLoading={setLoading}
          selectItem={selectItem}
          handleGroupBooks={groupSelectedBooks}
          handleRenameFolder={groupBy === LibraryGroupByType.Group ? renameFolder : undefined}
          handleRemoveFolder={groupBy === LibraryGroupByType.Group ? removeFolder : undefined}
          handleCreateFolder={groupBy === LibraryGroupByType.Group ? setCreatingFolder : undefined}
          handleUndoFolder={
            groupBy === LibraryGroupByType.Group ? () => void folders.undo() : undefined
          }
          canUndoFolder={folders.canUndo}
          handleRedoFolder={
            groupBy === LibraryGroupByType.Group ? () => void folders.redo() : undefined
          }
          canRedoFolder={folders.canRedo}
          handlePasteFolder={
            groupBy === LibraryGroupByType.Group ? (path) => void clipboard.paste(path) : undefined
          }
          canPasteFolder={clipboard.canPaste}
          handleBookUpload={handleBookUpload}
          handleBookDownload={downloadFromCard}
          handleBookDelete={handleBookDelete}
          handleShowDetailsBook={handleShowDetailsBook}
          handleLibraryNavigation={handleLibraryNavigation}
          handleUpdateReadingStatus={handleUpdateReadingStatus}
          handleRenameBook={handleRenameBook}
          transferProgress={
            'hash' in item ? booksTransferProgress[(item as Book).hash] || null : null
          }
          showTimeRemaining={showTimeRemaining}
        />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sortedBookshelfItems,
      selectedBooks,
      viewMode,
      coverFit,
      booksTransferProgress,
      selectItem,
      handleBookUpload,
      handleBookDownload,
      handleBookDelete,
      handleShowDetailsBook,
      handleLibraryNavigation,
      handleUpdateReadingStatus,
      handleRenameBook,
      showTimeRemaining,
      groupBy,
      renameFolder,
      folders.canUndo,
      folders.canRedo,
      clipboard,
      folders.revision,
      folders.remove,
    ],
  );

  const computeItemKey = useCallback(
    (index: number) => {
      const item = sortedBookshelfItems[index];
      if (!item) return `library-item-${index}`;
      return `library-item-${'hash' in item ? item.hash : item.id}`;
    },
    [sortedBookshelfItems],
  );

  const marquee = useLibraryMarquee({
    root: selectionRootRef,
    scroller: scrollRef,
    selected: selectedBooks,
    enabled: !appService?.isMobile && !contentSearch?.query.trim() && !loading,
    onSelect: setSelectedBooks,
  });

  return (
    <div
      ref={autofocusRef}
      tabIndex={-1}
      role='main'
      aria-label={_('Bookshelf')}
      className='bookshelf glossa-bookshelf flex min-h-0 flex-grow flex-col focus:outline-none'
      data-library-folder-path={
        (groupBy === LibraryGroupByType.Group || groupBy === LibraryGroupByType.None) &&
        !queryTerm &&
        !contentSearch
          ? (manualGroupName ?? '')
          : undefined
      }
      onClick={(event) => {
        if (
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !(event.target as HTMLElement).closest(
            '[data-book-hash], [data-group-name], button, input, form, [role="menu"], [role="dialog"]',
          )
        ) {
          clearSelection();
        }
      }}
      onContextMenu={(event) => {
        if (
          (event.target as HTMLElement).closest(
            '[data-group-name], [data-book-hash], button, input, form',
          )
        )
          return;
        event.preventDefault();
        setFolderMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]'))
          return;
        const command = event.metaKey || event.ctrlKey;
        const key = event.key.toLowerCase();
        if (command && key === 'x' && getSelectedBooks().length) {
          event.preventDefault();
          cutLibraryItems(getSelectedBooks());
          return;
        }
        if (
          command &&
          key === 'v' &&
          clipboard.clipboard &&
          (groupBy === LibraryGroupByType.Group || groupBy === LibraryGroupByType.None)
        ) {
          event.preventDefault();
          void clipboard.paste(manualGroupName ?? '');
          return;
        }
        if (command && event.altKey && key === 'n' && getSelectedBooks().length) {
          event.preventDefault();
          beginCreateWithItems();
          return;
        }
        if (
          command &&
          ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey)) &&
          folders.canRedo &&
          !folders.busy
        ) {
          event.preventDefault();
          void folders.redo();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault();
          setSelectedBooks(
            sortedBookshelfItems.map((item) => ('hash' in item ? item.hash : item.id)),
          );
          return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && getSelectedBooks().length) {
          event.preventDefault();
          void deleteSelectedBooks();
          return;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === 'm' &&
          getSelectedBooks().length
        ) {
          event.preventDefault();
          groupSelectedBooks();
          return;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 'z' &&
          !event.shiftKey &&
          bookEdits.canUndo()
        ) {
          event.preventDefault();
          void bookEdits.undo();
          return;
        }
        if (event.key === 'Escape' && (getSelectedBooks().length || clipboard.clipboard)) {
          event.preventDefault();
          event.stopPropagation();
          clearSelection();
          useLibraryTransfer.setState({ clipboard: undefined });
          return;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === 'n' &&
          groupBy === LibraryGroupByType.Group &&
          !folders.busy
        ) {
          event.preventDefault();
          folders.clearError();
          setCreatingWithItems(null);
          setCreatingFolder(manualGroupName ?? '');
          return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'z' &&
          !event.shiftKey &&
          folders.canUndo
        ) {
          event.preventDefault();
          void folders.undo();
        } else if (
          event.target === event.currentTarget &&
          (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
        ) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          setFolderMenu({ x: rect.left + 24, y: rect.top + 24 });
        }
      }}
    >
      {renderGroupNavigation?.((element) => {
        const rect = element.getBoundingClientRect();
        setFolderMenu({ x: rect.left, y: rect.bottom });
      })}
      {(creatingFolder !== null ||
        folders.error ||
        (groupBy === LibraryGroupByType.Group && !queryTerm)) && (
        <FolderToolbar
          parent={creatingFolder ?? manualGroupName ?? ''}
          {...folders}
          create={createFolder}
          active={creatingFolder !== null}
          onClose={(restoreFocus) => {
            setCreatingFolder(null);
            setCreatingWithItems(null);
            if (restoreFocus)
              requestAnimationFrame(() =>
                autofocusRef.current
                  ?.querySelector<HTMLButtonElement>('.glossa-folder-heading-action')
                  ?.focus(),
              );
          }}
        />
      )}
      {folderMenu && (
        <BookContextMenuPopup
          position={folderMenu}
          onClose={() => setFolderMenu(null)}
          items={[
            {
              text: _(manualGroupName ? 'New subgroup' : 'New group'),
              disabled: folders.busy || (manualGroupName?.split('/').length ?? 0) >= 4,
              action: () => {
                folders.clearError();
                setCreatingWithItems(null);
                setCreatingFolder(manualGroupName || '');
              },
            },
            ...(selectedBooks.length
              ? [
                  {
                    text: _('New group with selection'),
                    disabled: folders.busy || (manualGroupName?.split('/').length ?? 0) >= 4,
                    action: beginCreateWithItems,
                  },
                  {
                    text: _('Cut'),
                    action: () => cutLibraryItems(getSelectedBooks()),
                  },
                ]
              : []),
            ...(clipboard.clipboard &&
            (groupBy === LibraryGroupByType.Group || groupBy === LibraryGroupByType.None)
              ? [
                  {
                    text: _('Paste into group'),
                    disabled: !clipboard.canPaste(manualGroupName ?? ''),
                    action: () => void clipboard.paste(manualGroupName ?? ''),
                  },
                ]
              : []),
            {
              text: _('Undo'),
              disabled: folders.busy || !folders.canUndo,
              action: () => void folders.undo(),
            },
            ...(folders.canRedo
              ? [
                  {
                    text: _('Redo'),
                    disabled: folders.busy,
                    action: () => void folders.redo(),
                  },
                ]
              : []),
          ]}
        />
      )}
      {deletingFolder !== null && (
        <FolderDeleteDialog
          path={deletingFolder}
          onConfirm={() => folders.remove(deletingFolder)}
          onClose={() => setDeletingFolder(null)}
        />
      )}
      {!contentSearch?.query.trim() && queryTerm && (
        <div className='flex shrink-0 justify-center px-4 pb-2'>
          <button
            type='button'
            onClick={onSearchContents}
            className={clsx(
              'eink-bordered border-base-200 bg-base-100 hover:border-base-300 hover:bg-base-300/40',
              'text-base-content/80 hover:text-base-content not-eink:transition-colors',
              'flex h-9 items-center gap-2 rounded-lg border px-4 text-sm font-medium duration-150',
              'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
            )}
          >
            <SearchCheck aria-hidden='true' className='h-5 w-5' />
            {_('Search in book contents')}
          </button>
        </div>
      )}
      {contentSearch?.query.trim() && appService ? (
        <LibrarySearchResults
          appService={appService}
          books={currentShelfBooks}
          query={contentSearch.query.trim()}
          config={contentSearch.config}
          onSelectResult={openSearchResult}
          onProgress={onSearchProgress}
        />
      ) : (
        // The OverlayScrollbars root and the search results are siblings on
        // purpose: OS decorates this subtree with its own DOM, and letting
        // React swap children inside it caused NotFoundError crashes on
        // WebKit when a search was cleared.
        <div
          ref={selectionRootRef}
          {...marquee.handlers}
          className={clsx('min-h-0 flex-1', hasItems && isGridMode && 'glossa-library-grid-frame')}
        >
          <div ref={osRootRef} data-overlayscrollbars-initialize='' className='h-full'>
            {!hasItems && (
              <>
                <BookshelfHeader context={listContext} />
                <div className='glossa-library-no-results' role='status'>
                  <SearchX size={28} aria-hidden='true' />
                  <h2>
                    {_(
                      groupBy === LibraryGroupByType.Group && !queryTerm
                        ? 'This folder is empty'
                        : 'No books found',
                    )}
                  </h2>
                  {groupBy === LibraryGroupByType.Group && !queryTerm && (
                    <button
                      type='button'
                      className='glossa-folder-action'
                      onClick={(event) => handleImportBooks(event.currentTarget)}
                    >
                      <Plus size={18} />
                      {_('Import Books')}
                    </button>
                  )}
                </div>
              </>
            )}
            {!contentSearch?.query.trim() && hasItems && isGridMode && (
              <VirtuosoGrid<unknown, BookshelfListContext>
                className='glossa-library-grid-scroller'
                // Keep a fixed render buffer while resizing changes the column count.
                // Directional overscan can alternate bounds during Virtuoso's size update.
                increaseViewportBy={200}
                totalCount={sortedBookshelfItems.length}
                components={GRID_VIRTUOSO_COMPONENTS}
                context={listContext}
                computeItemKey={computeItemKey}
                itemContent={renderBookshelfItem}
                scrollerRef={handleScrollerRef}
              />
            )}
            {!contentSearch?.query.trim() && hasItems && !isGridMode && (
              <Virtuoso<unknown, BookshelfListContext>
                overscan={200}
                totalCount={sortedBookshelfItems.length}
                components={LIST_VIRTUOSO_COMPONENTS}
                context={listContext}
                computeItemKey={computeItemKey}
                itemContent={renderBookshelfItem}
                scrollerRef={handleScrollerRef}
              />
            )}
          </div>
        </div>
      )}
      {marquee.rect && (
        <div className='glossa-library-marquee' aria-hidden='true' style={marquee.rect} />
      )}
      {loading && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )}
      {showGroupingModal && selectedBooks.length > 0 && (
        <ModalPortal>
          <GroupingModal
            libraryBooks={libraryBooks}
            selectedBooks={
              groupBy === LibraryGroupByType.Group
                ? selectedBooks
                : expandBookshelfSelection(selectedBooks, sortedBookshelfItems)
            }
            parentGroupName={getGroupName(groupId) || ''}
            onCancel={() => {
              setShowGroupingModal(false);
            }}
            onConfirm={() => {
              setShowGroupingModal(false);
              clearSelection();
            }}
          />
        </ModalPortal>
      )}
      {showDeleteAlert && (
        <ModalPortal>
          <DeleteConfirmAlert
            destructive
            title={_(groupPathsToDelete.length ? 'Delete selection?' : 'Delete books?')}
            message={
              groupPathsToDelete.length
                ? _(
                    'Dissolve {{groups}} group(s) and delete {{books}} selected book(s). Other books stay in the library.',
                    { groups: groupPathsToDelete.length, books: getBooksToDelete().length },
                  )
                : _(
                    'You can restore these {{count}} book(s) and their reading data from Recently Deleted.',
                    { count: getBooksToDelete().length },
                  )
            }
            books={[
              ...groupPathsToDelete.map((path) => ({ hash: `group:${path}`, title: path })),
              ...getBooksToDelete(),
            ]}
            scope={
              deletionProgress
                ? _('Completed {{done}} · Failed {{failed}} · Not started {{pending}}', {
                    done: deletionProgress.completed.length,
                    failed: deletionProgress.failed.length,
                    pending: deletionProgress.pending.length,
                  })
                : removalScope(settings, _)
            }
            onCancel={() => setShowDeleteAlert(false)}
            onStop={() => deletionController.current?.abort()}
            onConfirm={confirmDelete}
          />
        </ModalPortal>
      )}
    </div>
  );
};

export default Bookshelf;
