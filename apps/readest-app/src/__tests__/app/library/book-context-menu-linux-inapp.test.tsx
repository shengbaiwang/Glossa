import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Book } from '@/types/book';

/**
 * Issue #5360 — on Linux/Wayland the native GTK context menu is popped up
 * asynchronously (JS → Tauri IPC → muda → GTK) long after the triggering
 * two-finger tap has released the button, and the mapped popup is dismissed
 * immediately (it flashes for one frame and disappears). The GTK3-on-Wayland
 * popup path is not fixable from the app side, so Linux desktop renders the
 * context menu in-app instead of popping the native menu.
 */

const popupSpy = vi.hoisted(() => vi.fn(async () => {}));
const closeSpy = vi.hoisted(() => vi.fn(async () => {}));
const menuNew = vi.hoisted(() => vi.fn(async () => ({ popup: popupSpy, close: closeSpy })));

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: menuNew },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    innerSize: async () => ({ width: 2048, height: 1536 }),
    scaleFactor: async () => 2,
  }),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn(),
}));

const appService = vi.hoisted(() => ({
  hasContextMenu: true,
  isLinuxApp: true,
  isAndroidApp: false,
  isMobileApp: false,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { localBooksDir: '/books' } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

vi.mock('@/app/library/hooks/useOpenBook', () => ({
  useOpenBook: () => ({ openBook: vi.fn() }),
}));

vi.mock('@/app/library/components/BookItem', () => ({
  default: () => null,
}));

vi.mock('@/app/library/components/GroupItem', () => ({
  default: () => null,
}));

const BookshelfItem = (await import('@/app/library/components/BookshelfItem')).default;

const book: Book = {
  hash: 'hash-1',
  format: 'EPUB',
  title: 'Test Book',
  author: 'Test Author',
  createdAt: 0,
  updatedAt: 0,
  downloadedAt: 1,
};

const renderItem = (overrides: Partial<React.ComponentProps<typeof BookshelfItem>> = {}) => {
  const props = {
    mode: 'grid' as const,
    item: book,
    coverFit: 'crop' as const,
    itemSelected: false,
    transferProgress: null,
    setLoading: vi.fn(),
    selectItem: vi.fn(),
    handleGroupBooks: vi.fn(),
    handleBookDownload: vi.fn(async () => true),
    handleBookUpload: vi.fn(async () => true),
    handleBookDelete: vi.fn(async () => true),
    handleShowDetailsBook: vi.fn(),
    handleLibraryNavigation: vi.fn(),
    handleUpdateReadingStatus: vi.fn(),
    showTimeRemaining: false,
    ...overrides,
  };
  return { ...render(<BookshelfItem {...props} />), props };
};

const openContextMenu = () =>
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Test Book' }), {
    clientX: 10,
    clientY: 20,
  });

describe('library context menu on Linux desktop (issue #5360)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appService.isLinuxApp = true;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the in-app menu instead of popping the native GTK menu', async () => {
    renderItem();

    openContextMenu();

    // The downloaded, never-uploaded, statusless test book resolves to this
    // ordered id list via getBookContextMenuItemIds.
    const labels = ['Move to…', 'Cut', 'New group with selection', 'Reveal in Folder', 'Delete'];
    const menuItems = await screen.findAllByRole('menuitem');
    expect(menuItems.map((el) => el.textContent)).toEqual(labels);

    expect(menuNew).not.toHaveBeenCalled();
    expect(popupSpy).not.toHaveBeenCalled();
  });

  it('selects a book by holding it on touch without entering a separate mode', async () => {
    vi.useFakeTimers();
    try {
      const { props } = renderItem();
      const card = screen.getByRole('button', { name: 'Test Book' });
      fireEvent.pointerDown(card, { pointerType: 'touch', pointerId: 1, clientX: 20, clientY: 20 });
      await act(async () => {
        vi.advanceTimersByTime(550);
      });
      expect(props.selectItem).toHaveBeenCalledExactlyOnceWith(book.hash, {
        toggle: true,
        preserve: true,
      });
      fireEvent.pointerUp(card, { pointerId: 1, clientX: 20, clientY: 20 });
      expect(props.selectItem).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps group rename and new-subgroup actions reachable by touch long press', async () => {
    vi.useFakeTimers();
    try {
      const rename = vi.fn(async () => true);
      const { props } = renderItem({
        item: { id: 'folder', name: 'Folder', displayName: 'Folder', books: [], updatedAt: 1 },
        handleRenameFolder: rename,
        handleCreateFolder: vi.fn(),
      });
      const card = screen.getByRole('button', { name: 'Folder' });
      fireEvent.pointerDown(card, { pointerType: 'touch', pointerId: 1, clientX: 20, clientY: 20 });
      await act(async () => {
        vi.advanceTimersByTime(550);
      });
      expect(props.selectItem).toHaveBeenCalledWith('folder', { toggle: true, preserve: true });
      expect(screen.getByRole('menuitem', { name: 'Rename group' })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: 'New subgroup' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves a book selection before invoking Move from the keyboard context menu', async () => {
    const { props } = renderItem();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Test Book' }), {
      key: 'F10',
      shiftKey: true,
    });
    await screen.findByRole('menuitem', { name: 'Move to…' });
    expect(props.selectItem).toHaveBeenCalledWith(book.hash, { preserve: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
    expect(props.selectItem).toHaveBeenCalledWith(book.hash, { preserve: true });
    expect(props.handleGroupBooks).toHaveBeenCalled();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('runs the action and closes the menu when an item is clicked', async () => {
    const { props } = renderItem();

    openContextMenu();

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to…' }));

    expect(props.handleGroupBooks).toHaveBeenCalled();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('dismisses the menu when clicking outside', async () => {
    renderItem();

    openContextMenu();
    await screen.findAllByRole('menuitem');

    const overlay = document.querySelector('.overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);

    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('does not prewarm the native menu on pointer enter on Linux', async () => {
    renderItem();

    fireEvent.pointerOver(screen.getByRole('button', { name: 'Test Book' }));

    // Menu construction crosses the Tauri IPC boundary for the native menu
    // only; the in-app menu needs no prewarm.
    expect(menuNew).not.toHaveBeenCalled();
  });

  it('keeps the native menu on non-Linux desktop platforms', async () => {
    appService.isLinuxApp = false;
    renderItem();

    openContextMenu();

    await vi.waitFor(() => expect(popupSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
