import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSidebarStore } from '@/store/sidebarStore';
import ViewMenu from '@/app/reader/components/ViewMenu';

const mocks = vi.hoisted(() => ({
  envConfig: {},
  viewSettings: {
    scrolled: false,
    scrolledDirection: 'vertical',
    webtoonMode: false,
    zoomLevel: 100,
    contrast: 100,
    zoomMode: 'fit-page',
    spreadMode: 'auto',
    keepCoverSpread: false,
    invertImgColorInDark: false,
    applyThemeToPDF: false,
    enableAnnotationQuickActions: true,
    annotationQuickAction: null as string | null,
  },
  saveViewSettings: vi.fn(),
  setSettingsDialogOpen: vi.fn(),
  setSettingsDialogBookKey: vi.fn(),
  dispatch: vi.fn(),
  saveSysSettings: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? name)),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: mocks.envConfig, appService: { hasWindow: true } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ booknotes: [{ type: 'annotation' }] }),
    getBookData: () => ({ isFixedLayout: false, book: { format: 'EPUB' }, bookDoc: {} }),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    bookKeys: ['book-1', 'book-2'],
    recreateViewer: vi.fn(),
    getViewSettings: () => mocks.viewSettings,
    getViewState: () => ({}),
    getView: vi.fn(),
    setViewSettings: vi.fn(),
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: {} },
    setSettingsDialogOpen: mocks.setSettingsDialogOpen,
    setSettingsDialogBookKey: mocks.setSettingsDialogBookKey,
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeMode: 'light', isDarkMode: false, setThemeMode: vi.fn() }),
}));
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: mocks.saveViewSettings,
  saveSysSettings: mocks.saveSysSettings,
}));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: mocks.dispatch } }));
vi.mock('@/utils/style', () => ({ getStyles: vi.fn() }));
vi.mock('@/utils/window', () => ({ tauriHandleToggleFullScreen: vi.fn() }));
vi.mock('@/utils/nav', () => ({ navigateToLogin: vi.fn() }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ applyPageTurnAttributes: vi.fn() }));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ getVisibleLibrary: () => [] }),
}));
vi.mock('@/app/reader/hooks/useBooksManager', () => ({
  default: () => ({ openParallelView: vi.fn() }),
}));
vi.mock('@/components/AboutWindow', () => ({ setAboutDialogVisible: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useSidebarStore.setState({
    sideBarBookKey: 'book-1',
    isSideBarVisible: false,
    isSideBarPinned: false,
  });
  mocks.saveViewSettings.mockResolvedValue(undefined);
  mocks.viewSettings.annotationQuickAction = null;
  mocks.viewSettings.enableAnnotationQuickActions = true;
});

afterEach(cleanup);

describe('reader ViewMenu', () => {
  it('includes book actions in the reading menu and targets its book with the sidebar closed', () => {
    const closeMenu = vi.fn();
    render(<ViewMenu bookKey='book-2' setIsDropdownOpen={closeMenu} />);
    for (const [label, event] of [
      ['Export Annotations', 'export-annotations'],
      ['Import Annotations', 'import-annotations'],
      ['Clear Annotations', 'clear-annotations'],
    ]) {
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
      expect(mocks.dispatch).toHaveBeenCalledWith(event, { bookKey: 'book-2' });
    }
    expect(closeMenu).toHaveBeenCalledWith(false);
    expect(screen.getByRole('menuitem', { name: 'Pin Sidebar' })).toBeTruthy();
  });

  it('pins the navigation sidebar for this book and persists the preference', () => {
    render(<ViewMenu bookKey='book-2' />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Sidebar' }));
    expect(useSidebarStore.getState()).toMatchObject({
      sideBarBookKey: 'book-2',
      isSideBarVisible: true,
      isSideBarPinned: true,
    });
    expect(mocks.saveSysSettings).toHaveBeenCalledWith(mocks.envConfig, 'globalReadSettings', {
      isSideBarPinned: true,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin Sidebar' }));
    expect(useSidebarStore.getState()).toMatchObject({
      isSideBarVisible: false,
      isSideBarPinned: false,
    });
  });

  it('sorts the current book even when another book owns the sidebar', () => {
    render(<ViewMenu bookKey='book-2' />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort TOC by Page' }));
    expect(mocks.saveViewSettings).toHaveBeenCalledWith(
      mocks.envConfig,
      'book-2',
      'sortedTOC',
      true,
      true,
      false,
    );
  });

  it('can enable a selection action from More while no quick action is active', () => {
    const closeMenu = vi.fn();
    render(<ViewMenu bookKey='book-1' setIsDropdownOpen={closeMenu} />);

    fireEvent.click(screen.getByRole('button', { name: 'Selection Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Instant Highlight' }));

    expect(mocks.saveViewSettings).toHaveBeenCalledWith(
      mocks.envConfig,
      'book-1',
      'annotationQuickAction',
      'highlight',
      false,
      true,
    );
    expect(closeMenu).toHaveBeenCalledWith(false);
  });

  it('turns the active selection action off when selected again', () => {
    mocks.viewSettings.annotationQuickAction = 'highlight';
    render(<ViewMenu bookKey='book-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Selection Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Instant Highlight' }));

    expect(mocks.saveViewSettings).toHaveBeenCalledWith(
      mocks.envConfig,
      'book-1',
      'annotationQuickAction',
      null,
      false,
      true,
    );
  });

  it('keeps removed legacy actions inactive and lets the user choose a retained action', () => {
    mocks.viewSettings.annotationQuickAction = 'translate';
    render(<ViewMenu bookKey='book-1' />);

    fireEvent.click(screen.getByRole('button', { name: 'Selection Actions' }));
    expect(screen.queryByRole('menuitem', { name: /Translate/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Instant Copy' }));

    expect(mocks.saveViewSettings).toHaveBeenCalledWith(
      mocks.envConfig,
      'book-1',
      'annotationQuickAction',
      'copy',
      false,
      true,
    );
  });

  it('respects the explicit preference to disable selection quick actions', () => {
    mocks.viewSettings.enableAnnotationQuickActions = false;
    render(<ViewMenu bookKey='book-1' />);
    expect(screen.queryByRole('button', { name: 'Selection Actions' })).toBeNull();
  });

  it('closes a single book through More and dismisses the menu first', () => {
    const closeMenu = vi.fn();
    const closeBook = vi.fn();
    render(<ViewMenu bookKey='book-1' setIsDropdownOpen={closeMenu} onCloseBook={closeBook} />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Close Book' }));

    expect(closeBook).toHaveBeenCalledOnce();
    expect(closeMenu).toHaveBeenCalledWith(false);
    expect(closeMenu.mock.invocationCallOrder[0]).toBeLessThan(
      closeBook.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps layout settings available when the compact header hides their shortcut', () => {
    const closeMenu = vi.fn();
    render(<ViewMenu bookKey='book-1' setIsDropdownOpen={closeMenu} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /Font & Layout/ }));

    expect(mocks.setSettingsDialogBookKey).toHaveBeenCalledWith('book-1');
    expect(mocks.setSettingsDialogOpen).toHaveBeenCalledWith(true);
    expect(closeMenu).toHaveBeenCalledWith(false);
  });
});
