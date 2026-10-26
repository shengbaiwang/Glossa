import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLongPress } from '@/hooks/useLongPress';
import { Menu } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { eventDispatcher } from '@/utils/event';
import { getOSPlatform } from '@/utils/misc';
import { throttle } from '@/utils/throttle';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { BOOK_UNGROUPED_ID, BOOK_UNGROUPED_NAME } from '@/services/constants';
import { FILE_REVEAL_LABELS, FILE_REVEAL_PLATFORMS } from '@/utils/os';
import { Book, BooksGroup, ReadingStatus } from '@/types/book';
import {
  getBookContextMenuItemIds,
  MISSING_AUTHOR_GROUP_ID,
  type BookContextMenuItemId,
} from '@/app/library/utils/libraryUtils';
import { md5Fingerprint } from '@/utils/md5';
import { useLibraryStore } from '@/store/libraryStore';
import { LIBRARY_ITEMS_MIME } from '../utils/libraryDragDrop';
import BookItem from './BookItem';
import GroupItem from './GroupItem';
import BookContextMenuPopup, { type BookContextMenuItem } from './BookContextMenuPopup';
import { useOpenBook } from '../hooks/useOpenBook';
import { resolveFolderPath } from '../hooks/useLibraryFolders';

export const generateBookshelfItems = (
  books: Book[],
  parentGroupName: string,
  folderPaths: string[] = [],
): (Book | BooksGroup)[] => {
  const groupsMap = new Map<string, BooksGroup>();

  for (const path of folderPaths) {
    if (parentGroupName && !path.startsWith(`${parentGroupName}/`)) continue;
    const relative = parentGroupName ? path.slice(parentGroupName.length + 1) : path;
    const displayName = relative.split('/')[0]!;
    if (!displayName) continue;
    const name = parentGroupName ? `${parentGroupName}/${displayName}` : displayName;
    groupsMap.set(name, { id: md5Fingerprint(name), name, displayName, books: [], updatedAt: 0 });
  }

  for (const book of books) {
    if (book.deletedAt) continue;

    const groupName = book.groupName || BOOK_UNGROUPED_NAME;
    if (
      parentGroupName &&
      groupName !== parentGroupName &&
      !groupName.startsWith(parentGroupName + '/')
    ) {
      continue;
    }

    const relativePath = parentGroupName ? groupName.slice(parentGroupName.length + 1) : groupName;
    // Get the immediate child group name (or empty if book is directly in parent)
    const slashIndex = relativePath.indexOf('/');
    const immediateChild = slashIndex > 0 ? relativePath.slice(0, slashIndex) : relativePath;
    // Determine if this book belongs directly to the parent group
    const isDirectChild =
      groupName === parentGroupName || (groupName === BOOK_UNGROUPED_NAME && !parentGroupName);
    // Build the full group name for this level
    const fullGroupName = isDirectChild
      ? BOOK_UNGROUPED_NAME
      : parentGroupName
        ? `${parentGroupName}/${immediateChild}`
        : immediateChild;

    const mapKey = fullGroupName;
    const existingGroup = groupsMap.get(mapKey);
    if (existingGroup) {
      existingGroup.books.push(book);
      existingGroup.updatedAt = Math.max(existingGroup.updatedAt, book.updatedAt);
    } else {
      groupsMap.set(mapKey, {
        id: isDirectChild ? BOOK_UNGROUPED_ID : md5Fingerprint(fullGroupName),
        name: fullGroupName,
        displayName: isDirectChild ? BOOK_UNGROUPED_NAME : immediateChild,
        books: [book],
        updatedAt: book.updatedAt,
      });
    }
  }

  for (const group of groupsMap.values()) {
    group.books.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const ungroupedGroup = groupsMap.get(BOOK_UNGROUPED_NAME);
  const ungroupedBooks = ungroupedGroup?.books || [];
  const groupedBooks = Array.from(groupsMap.values()).filter(
    (group) => group.name !== BOOK_UNGROUPED_NAME,
  );

  return [...ungroupedBooks, ...groupedBooks].sort((a, b) => b.updatedAt - a.updatedAt);
};

// A native popup blocks Tauri's main thread until the menu is dismissed and
// holds the webview's resources table lock for that whole time, while
// menu.close() destroys the resource through a *synchronous* command, which
// runs on that same main thread. Releasing a menu while a popup is on screen
// therefore deadlocks the app: the main thread blocks on a lock that only the
// dismissal releases, and a blocked main thread can no longer dismiss the
// menu. The library's startup churn (books streaming in, covers, sync) used
// to re-render right into that window and freeze the app for good.
// Native popups are modal and app-wide, so the gate is module scoped: a
// release queued by any bookshelf item would freeze another item's popup.
let openPopup: Promise<unknown> | null = null;

const trackPopup = async (popup: Promise<void>) => {
  const settled = popup.catch(() => {});
  openPopup = settled;
  await settled;
  if (openPopup === settled) openPopup = null;
};

const releaseMenu = (menu: Promise<Menu>) => {
  const close = () => {
    if (openPopup) {
      void openPopup.then(close);
      return;
    }
    void menu.then((m) => m.close()).catch(() => {});
  };
  close();
};

interface BookshelfItemProps {
  mode: LibraryViewModeType;
  item: Book | BooksGroup;
  coverFit: LibraryCoverFitType;
  isSelectMode: boolean;
  itemSelected: boolean;
  transferProgress: number | null;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSelection: (hash: string, range?: boolean) => void;
  handleGroupBooks: () => void;
  handleRenameFolder?: (path: string, name: string) => Promise<boolean>;
  handleRemoveFolder?: (path: string) => Promise<boolean>;
  handleCreateFolder?: (parent: string) => void;
  handleUndoFolder?: () => void;
  canUndoFolder?: boolean;
  handleBookDownload: (
    book: Book,
    options?: { redownload?: boolean; queued?: boolean },
  ) => Promise<boolean>;
  handleBookUpload: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleBookDelete: (book: Book, signal?: AbortSignal) => Promise<boolean>;
  handleSetSelectMode: (selectMode: boolean) => void;
  handleShowDetailsBook: (book: Book) => void;
  handleLibraryNavigation: (targetGroup: string) => void;
  handleUpdateReadingStatus: (book: Book, status: ReadingStatus | undefined) => void;
  showTimeRemaining: boolean;
  onOpenBook?: (book: Book) => void;
  resume?: boolean;
  handleRenameBook?: (book: Book, title: string) => Promise<boolean>;
}

const BookshelfItem: React.FC<BookshelfItemProps> = ({
  mode,
  item,
  coverFit,
  isSelectMode,
  itemSelected,
  transferProgress,
  setLoading,
  toggleSelection,
  handleGroupBooks,
  handleRenameFolder,
  handleRemoveFolder,
  handleCreateFolder,
  handleUndoFolder,
  canUndoFolder,
  handleBookUpload,
  handleBookDownload,
  handleSetSelectMode,
  handleShowDetailsBook,
  handleLibraryNavigation,
  handleUpdateReadingStatus,
  showTimeRemaining,
  handleRenameBook,
  onOpenBook,
  resume,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { selectedBooks } = useLibraryStore();
  const [renaming, setRenaming] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { openBook } = useOpenBook({ setLoading, handleBookDownload });

  const showBookDetailsModal = useCallback(async (book: Book) => {
    handleShowDetailsBook(book);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBookClick = useCallback(
    async (book: Book) => {
      if (isSelectMode) {
        toggleSelection(book.hash);
        return;
      }
      if (onOpenBook) onOpenBook(book);
      else await openBook(book);
    },
    [isSelectMode, openBook, onOpenBook, toggleSelection],
  );

  const handleGroupClick = useCallback(
    (group: BooksGroup) => {
      if (isSelectMode) {
        toggleSelection(group.id);
      } else {
        handleLibraryNavigation(group.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSelectMode, handleLibraryNavigation],
  );

  const buildBookMenuItems = (book: Book): BookContextMenuItem[] => {
    const osPlatform = getOSPlatform();
    const fileRevealLabel =
      FILE_REVEAL_LABELS[osPlatform as FILE_REVEAL_PLATFORMS] || FILE_REVEAL_LABELS.default;
    // Build every item up front, then create the menu from the ordered subset
    // in a single Menu.new({ items }) call. Appending items one-by-one with
    // un-awaited Menu.append() promises races on the Tauri IPC boundary and
    // shuffles the order on every open (issue #4389).
    const itemOptions: Record<BookContextMenuItemId, BookContextMenuItem> = {
      group: {
        text: _('Move to…'),
        action: async () => {
          if (!isSelectMode) handleSetSelectMode(true);
          if (!itemSelected) useLibraryStore.getState().setSelectedBooks([book.hash]);
          handleGroupBooks();
        },
      },
      showInFinder: {
        text: _(fileRevealLabel),
        action: async () => {
          const folder = book.filePath || `${settings.localBooksDir}/${book.hash}`;
          revealItemInDir(folder);
        },
      },
      delete: {
        text: _('Delete'),
        action: async () => {
          eventDispatcher.dispatch('delete-books', {
            ids: itemSelected ? useLibraryStore.getState().getSelectedBooks() : [book.hash],
          });
        },
      },
    };
    return getBookContextMenuItemIds(book)
      .filter(
        (id) => id !== 'showInFinder' || (!!appService?.hasContextMenu && !appService.isMobileApp),
      )
      .map((id) => itemOptions[id]);
  };

  const buildGroupMenuItems = (group: BooksGroup): BookContextMenuItem[] => {
    // Single Menu.new({ items }) call keeps the order deterministic — see the
    // note in bookContextMenuHandler about the Menu.append() IPC race (#4389).
    return [
      ...(handleRenameFolder ? [{ text: _('Rename group'), action: () => setRenaming(true) }] : []),
      ...(handleCreateFolder && group.name.split('/').length < 4
        ? [
            {
              text: _('New subgroup'),
              disabled: group.name.split('/').length >= 4,
              action: () => handleCreateFolder(group.name),
            },
          ]
        : []),
      {
        text: handleRenameFolder ? _('Move to…') : _('Group Books'),
        action: async () => {
          if (!isSelectMode) handleSetSelectMode(true);
          if (!itemSelected) useLibraryStore.getState().setSelectedBooks([group.id]);
          handleGroupBooks();
        },
      },
      ...(handleRemoveFolder
        ? [{ text: _('Delete group'), action: () => handleRemoveFolder(group.name) }]
        : []),
      ...(handleUndoFolder && canUndoFolder
        ? [{ text: _('Undo'), disabled: !canUndoFolder, action: handleUndoFolder }]
        : []),
    ];
  };

  const buildMenuItems = () =>
    'format' in item ? buildBookMenuItems(item as Book) : buildGroupMenuItems(item as BooksGroup);

  // In-app fallback for the native context menu: GTK3 menus popped over
  // Wayland after the trigger button was already released (a touchpad
  // two-finger tap) are dismissed as soon as they map, flashing for a single
  // frame (issue #5360). The popup path (JS → Tauri IPC → muda → GTK) cannot
  // beat a tap's instant release, so Linux renders the menu in-app instead.
  const [inAppMenuPosition, setInAppMenuPosition] = useState<{ x: number; y: number } | null>(null);

  // Building the menu crosses the Tauri IPC boundary and takes long enough
  // that the popup visibly lags the right-click (issue #5181). Cache the
  // built menu so popup() fires immediately; hovering the item prewarms the
  // cache so even the first opening is instant.
  const cachedMenuRef = useRef<Promise<Menu> | null>(null);

  const ensureMenu = () => {
    if (!cachedMenuRef.current) {
      const building = Menu.new({ items: buildMenuItems() });
      building.catch(() => {
        // A failed build must not poison the cache with a rejected promise.
        if (cachedMenuRef.current === building) cachedMenuRef.current = null;
      });
      cachedMenuRef.current = building;
    }
    return cachedMenuRef.current;
  };

  // Drop the cache whenever state baked into the items changes (selection
  // label, book status, reveal path, language); the cleanup also runs on
  // unmount so the native menu resource is released — but never while a popup
  // is still on screen, see releaseMenu.
  useEffect(() => {
    return () => {
      const cached = cachedMenuRef.current;
      cachedMenuRef.current = null;
      if (cached) releaseMenu(cached);
    };
  }, [item, itemSelected, isSelectMode, settings.localBooksDir, _, selectedBooks]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSelectItem = useCallback(
    throttle(() => {
      if (!isSelectMode) {
        handleSetSelectMode(true);
      }
      if ('format' in item) {
        toggleSelection((item as Book).hash);
      } else {
        toggleSelection((item as BooksGroup).id);
      }
    }, 100),
    [isSelectMode],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleOpenItem = useCallback(
    throttle(() => {
      if (isSelectMode) {
        handleSelectItem();
        return;
      }
      if ('format' in item) {
        handleBookClick(item as Book);
      } else {
        handleGroupClick(item as BooksGroup);
      }
    }, 100),
    [handleSelectItem, handleBookClick, handleGroupClick],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleContextMenu = useCallback(
    throttle(async (position: { x: number; y: number }) => {
      if (
        ('books' in item && handleRenameFolder) ||
        appService?.isLinuxApp ||
        !appService?.hasContextMenu
      ) {
        setInAppMenuPosition(position);
        return;
      }
      if (!appService?.hasContextMenu) return;
      const menu = await ensureMenu();
      // Pop up at an explicit position so keyboard invocation (ContextMenu /
      // Shift+F10) anchors the menu to the item instead of wherever the mouse
      // happens to sit. On macOS and Windows — the only platforms still on the
      // native menu — CSS px are window-logical px, so the client coordinates
      // pass through unchanged.
      await trackPopup(menu.popup(new LogicalPosition(position.x, position.y)));
    }, 100),
    [item, itemSelected, isSelectMode, settings.localBooksDir, selectedBooks],
  );

  const { pressing, handlers } = useLongPress(
    {
      onLongPress: () => {
        if ('books' in item && handleRenameFolder) {
          const rect = cardRef.current?.getBoundingClientRect();
          if (rect) handleContextMenu({ x: rect.left, y: rect.bottom });
        } else handleSelectItem();
      },
      onTap: () => {
        handleOpenItem();
      },
      onContextMenu: (e) => {
        handleContextMenu({ x: e.clientX, y: e.clientY });
      },
    },
    [isSelectMode, handleSelectItem, handleOpenItem, handleContextMenu],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'F2' && 'format' in item && handleRenameBook && !isSelectMode) {
      e.preventDefault();
      cardRef.current
        ?.querySelector('[data-inline-edit]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return;
    }
    if (e.key === 'F2' && 'books' in item && handleRenameFolder) {
      e.preventDefault();
      setRenaming(true);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpenItem();
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      handleContextMenu({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
  };

  // Tag the rendered DOM with the book/group identity so feature code
  // (e.g. the Send action's macOS share-popover anchor) can locate the
  // exact bookshelf cell the user is acting on without threading refs
  // through every parent. Books carry their content-hash; groups carry
  // their full group name.
  const itemDataAttrs =
    'format' in item ? { 'data-book-hash': item.hash } : { 'data-group-name': item.name };

  return (
    <div className={clsx(mode === 'grid' ? 'h-full' : 'glossa-library-list-row')}>
      <div
        ref={cardRef}
        className={clsx(
          'glossa-book-card group',
          resume && 'glossa-resume-card',
          mode === 'grid' && 'glossa-book-card-grid flex h-full flex-col',
          mode === 'list' && 'glossa-book-card-list flex flex-col',
          appService?.isMobileApp && 'no-context-menu',
          pressing && 'glossa-book-card-pressing',
          itemSelected && 'glossa-book-card-selected',
        )}
        role='button'
        tabIndex={0}
        aria-label={
          'format' in item
            ? item.title
            : item.id === MISSING_AUTHOR_GROUP_ID
              ? _('Author not set')
              : item.name
        }
        aria-pressed={isSelectMode ? itemSelected : undefined}
        onKeyDown={handleKeyDown}
        onPointerEnter={() => {
          if ('format' in item && appService?.hasContextMenu && !appService.isLinuxApp)
            void ensureMenu();
        }}
        {...itemDataAttrs}
        {...handlers}
        onPointerDown={(event) => {
          if (
            event.pointerType === 'mouse' &&
            event.button === 0 &&
            (event.metaKey || event.ctrlKey || event.shiftKey) &&
            !(event.target as HTMLElement).closest('button, input, form')
          ) {
            event.preventDefault();
            if (!isSelectMode) handleSetSelectMode(true);
            toggleSelection('format' in item ? item.hash : item.id, event.shiftKey);
            return;
          }
          handlers.onPointerDown(event);
        }}
        onClickCapture={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        draggable={!renaming && !appService?.isMobile && ('format' in item || !!handleRenameFolder)}
        onDragStart={(event) => {
          if ((event.target as HTMLElement).closest('input, button, form')) {
            event.preventDefault();
            return;
          }
          const id = 'format' in item ? item.hash : item.id;
          const ids = itemSelected ? useLibraryStore.getState().getSelectedBooks() : [id];
          event.dataTransfer.setData(LIBRARY_ITEMS_MIME, JSON.stringify(ids));
          event.dataTransfer.effectAllowed = 'move';
        }}
      >
        <div className='flex h-full flex-col justify-start'>
          {'format' in item ? (
            <BookItem
              mode={mode}
              book={item}
              coverFit={coverFit}
              isSelectMode={isSelectMode}
              bookSelected={itemSelected}
              transferProgress={transferProgress}
              handleBookUpload={handleBookUpload}
              handleBookDownload={handleBookDownload}
              showBookDetailsModal={showBookDetailsModal}
              showTimeRemaining={showTimeRemaining}
              onRename={handleRenameBook}
              onUpdateStatus={handleUpdateReadingStatus}
            />
          ) : (
            <GroupItem
              mode={mode}
              group={item}
              isSelectMode={isSelectMode}
              groupSelected={itemSelected}
              renaming={renaming}
              onStartRename={handleRenameFolder ? () => setRenaming(true) : undefined}
              onCancelRename={(restoreFocus = true) => {
                setRenaming(false);
                if (restoreFocus)
                  requestAnimationFrame(() => {
                    const path = resolveFolderPath(item.name);
                    [...document.querySelectorAll<HTMLElement>('[data-group-name]')]
                      .find((el) => el.dataset['groupName'] === path)
                      ?.focus();
                  });
              }}
              onRename={
                handleRenameFolder ? (name) => handleRenameFolder(item.name, name) : undefined
              }
            />
          )}
        </div>
      </div>
      {inAppMenuPosition && (
        <BookContextMenuPopup
          position={inAppMenuPosition}
          items={buildMenuItems()}
          onClose={() => setInAppMenuPosition(null)}
        />
      )}
    </div>
  );
};

export default BookshelfItem;
