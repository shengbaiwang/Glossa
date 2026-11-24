import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSidebarStore } from '@/store/sidebarStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { DropdownProvider } from '@/context/DropdownContext';
import { loadShortcuts, saveShortcuts } from '@/helpers/shortcuts';
import { runReaderCommand, type ReaderCommandId } from '@/services/readerCommands';
import { searchCommands, type CommandItem } from '@/services/commandRegistry';
import type { EnvConfigType } from '@/services/environment';
import ViewMenu from '@/app/reader/components/ViewMenu';
import ReaderPanelMenu from '@/app/reader/components/ReaderPanelMenu';
import { useReaderPaletteCommands } from '@/app/reader/hooks/useReaderPaletteCommands';
import ReadingDisplayControls from '@/components/settings/ReadingDisplayControls';

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
  openSettingsDialog: vi.fn(),
  setSettingsDialogOpen: vi.fn(),
  setSettingsDialogBookKey: vi.fn(),
  dispatch: vi.fn(),
  dispatchSync: vi.fn(),
  progress: undefined as [number, number] | undefined,
  saveSysSettings: vi.fn(),
  recreateViewer: vi.fn(),
  bookKeys: ['book-1', 'book-2'],
  setReaderCommands: vi.fn<(items: CommandItem[]) => void>(),
}));

vi.mock('@/components/command-palette', () => ({
  useCommandPalette: () => ({ setReaderCommands: mocks.setReaderCommands }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? name)),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/hooks/useResetSettings', () => ({ useResetViewSettings: () => vi.fn() }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: mocks.envConfig, appService: { hasWindow: true } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (() => {
    const getState = () => ({
      getConfig: (key: string) => ({
        booknotes: [{ type: 'annotation' }],
        progress: key === 'book-2' ? mocks.progress : [1, 5],
      }),
      getBookData: (key: string) => ({
        isFixedLayout: false,
        book: { hash: key, format: 'EPUB', progress: [10, 200] },
        bookDoc: {},
      }),
    });
    return Object.assign(getState, { getState });
  })(),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (() => {
    const getState = () => ({
      bookKeys: mocks.bookKeys,
      recreateViewer: mocks.recreateViewer,
      getViewSettings: () => mocks.viewSettings,
      getViewState: () => ({}),
      getView: vi.fn(),
      setViewSettings: vi.fn(),
    });
    return Object.assign(getState, { getState });
  })(),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (() => {
    const getState = () => ({
      settings: { globalReadSettings: {} },
      openSettingsDialog: mocks.openSettingsDialog,
      setSettingsDialogOpen: mocks.setSettingsDialogOpen,
      setSettingsDialogBookKey: mocks.setSettingsDialogBookKey,
    });
    return Object.assign(getState, { getState });
  })(),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeMode: 'light', isDarkMode: false, setThemeMode: vi.fn() }),
}));
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: mocks.saveViewSettings,
  saveSysSettings: mocks.saveSysSettings,
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: mocks.dispatch, dispatchSync: mocks.dispatchSync },
}));
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
  mocks.progress = undefined;
  mocks.bookKeys = ['book-1', 'book-2'];
  useParallelViewStore.setState({ parallelViews: [] });
  mocks.viewSettings.scrolled = false;
  useSidebarStore.setState({
    sideBarBookKey: 'book-1',
    isSideBarVisible: false,
  });
  mocks.saveViewSettings.mockResolvedValue(undefined);
  mocks.viewSettings.annotationQuickAction = null;
  mocks.viewSettings.enableAnnotationQuickActions = true;
});

afterEach(cleanup);

describe('reader ViewMenu', () => {
  it('reloads only the book targeted by its actions menu', () => {
    const close = vi.fn();
    render(<ViewMenu bookKey='book-2' setIsDropdownOpen={close} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reload Book' }));
    expect(mocks.recreateViewer).toHaveBeenCalledWith(mocks.envConfig, 'book-2');
    expect(close).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('menuitem', { name: 'Reload Page' })).toBeNull();
  });

  it('runs the same reload from command search and rejects a stale result after switching books', () => {
    useSidebarStore.getState().setSideBarBookKey('book-2');
    render(<ViewMenu bookKey='book-2' />);
    renderHook(() => useReaderPaletteCommands('book-2', mocks.bookKeys, vi.fn()));
    const commands = mocks.setReaderCommands.mock.lastCall?.[0] ?? [];
    const result = searchCommands('Reload Book', commands).find(
      ({ item }) => item.id === 'reader.reload',
    )?.item;
    expect(result).toBeDefined();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reload Book' }));
    result!.action();
    expect(mocks.recreateViewer.mock.calls).toEqual([
      [mocks.envConfig, 'book-2'],
      [mocks.envConfig, 'book-2'],
    ]);
    act(() => useSidebarStore.getState().setSideBarBookKey('book-1'));
    expect(result!.isAvailable?.()).toBe(false);
    result!.action();
    expect(mocks.recreateViewer).toHaveBeenCalledTimes(2);
  });

  it('updates the menu and command search when the auto-scroll shortcut is rebound', () => {
    const original = loadShortcuts();
    mocks.viewSettings.scrolled = true;
    render(<ViewMenu bookKey='book-1' />);
    renderHook(() => useReaderPaletteCommands('book-1', mocks.bookKeys, vi.fn()));
    try {
      act(() =>
        saveShortcuts({
          ...original,
          onToggleAutoScroll: { ...original.onToggleAutoScroll, keys: ['shift+g'] },
        }),
      );
      const row = screen.getByRole('menuitemcheckbox', { name: /Auto Scroll/ });
      const command = mocks.setReaderCommands.mock.lastCall?.[0].find(
        ({ id }) => id === 'reader.autoScroll',
      );
      expect(command?.shortcut).toHaveLength(1);
      expect(row.querySelector('kbd')?.textContent).toBe(command?.shortcut?.[0]);
      expect(row.querySelector('kbd')?.textContent).toMatch(/G$/);
    } finally {
      act(() => saveShortcuts(original));
    }
  });
  it('keeps global preferences out of current-book actions', () => {
    render(<ViewMenu bookKey='book-1' />);
    expect(screen.queryByRole('menuitem', { name: 'About Glossa' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Light Mode' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Fullscreen' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Font & Layout/ })).toBeNull();
  });
  it('keeps the scroll icon and persists the new flow from Aa', async () => {
    render(<ReadingDisplayControls bookKey='book-2' onRegisterReset={vi.fn()} />);
    const row = screen.getByRole('menuitemcheckbox', { name: 'Scrolled Mode - OFF' });
    const icon = row.querySelector('.glossa-menu-icon svg');
    expect(icon).not.toBeNull();
    expect(row.querySelector('.glossa-menu-check svg')).toBeNull();
    fireEvent.click(row);
    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(row.querySelector('.glossa-menu-icon svg')).toBe(icon);
    expect(row.querySelector('.glossa-menu-check svg')).not.toBeNull();
    expect(row.textContent).toContain('Shift+J');
    await waitFor(() =>
      expect(mocks.saveViewSettings).toHaveBeenCalledWith(
        mocks.envConfig,
        'book-2',
        'scrolled',
        true,
        false,
        false,
        true,
      ),
    );
  });

  it.each([
    undefined,
    [42, 317] as [number, number],
  ])('opens details for the menu book with live progress %s', (progress) => {
    const close = vi.fn();
    render(<ViewMenu bookKey='book-2' setIsDropdownOpen={close} />);
    mocks.progress = progress;
    expect(mocks.dispatchSync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Book Details' }));
    expect(mocks.dispatchSync).toHaveBeenCalledWith('show-book-details', {
      hash: 'book-2',
      format: 'EPUB',
      progress: progress ?? [10, 200],
    });
    expect(close).toHaveBeenCalledWith(false);
  });

  it('starts reading aloud for the menu book', () => {
    const close = vi.fn();
    render(<ViewMenu bookKey='book-2' setIsDropdownOpen={close} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Read Aloud' }));
    expect(mocks.dispatch).toHaveBeenCalledWith('tts-start', { bookKey: 'book-2' });
    expect(close).toHaveBeenCalledWith(false);
  });
  it('keeps directory, sidebar and annotation management out of More', () => {
    render(<ViewMenu bookKey='book-2' />);
    for (const label of [
      'Pin Sidebar',
      'Sort TOC by Page',
      'Export Annotations',
      'Import Annotations',
      'Clear Annotations',
    ])
      expect(screen.queryByText(label)).toBeNull();
  });

  it('runs annotation commands from the notes menu for the active notes book', () => {
    render(
      <DropdownProvider>
        <ReaderPanelMenu bookKey='book-2' />
      </DropdownProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Annotation Actions' });
    fireEvent.click(trigger);
    const entries = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(entries).toEqual(['Export Annotations', 'Import Annotations', 'Clear Annotations']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export Annotations' }));
    expect(mocks.dispatch).toHaveBeenCalledWith('export-annotations', { bookKey: 'book-2' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shares parallel reading actions and rejects commands for a closed book', () => {
    const run = (id: ReaderCommandId) =>
      runReaderCommand(mocks.envConfig as EnvConfigType, id, 'book-2');
    render(<ViewMenu bookKey='book-2' />);
    fireEvent.click(screen.getByRole('button', { name: 'Parallel Read' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Parallel Read' }));
    expect(useParallelViewStore.getState().areParallels('book-1', 'book-2')).toBe(true);
    run('exitParallel');
    expect(useParallelViewStore.getState().parallelViews).toEqual([]);
    mocks.bookKeys = ['book-1'];
    run('reload');
    expect(mocks.recreateViewer).not.toHaveBeenCalled();
  });

  it('keeps repeated selection and sync commands out of the reading menu and exposes global settings', () => {
    const close = vi.fn();
    render(<ViewMenu bookKey='book-2' setIsDropdownOpen={close} />);
    for (const name of ['Selection Actions', 'Sync Book', 'Sync Info'])
      expect(screen.queryByText(name)).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(mocks.openSettingsDialog).toHaveBeenCalledWith('application');
    expect(close).toHaveBeenCalledWith(false);
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
    render(<ViewMenu bookKey='book-1' setIsDropdownOpen={closeMenu} showReadingAppearance />);

    fireEvent.click(screen.getByRole('menuitem', { name: /Reading Appearance/ }));

    expect(mocks.openSettingsDialog).toHaveBeenCalledWith('reading', 'book-1');
    expect(closeMenu).toHaveBeenCalledWith(false);
  });
});
