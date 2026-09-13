import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeaderBar from '@/app/reader/components/HeaderBar';

const mocks = vi.hoisted(() => ({
  isSideBarVisible: false,
  isNotebookVisible: false,
  toggleSideBar: vi.fn(),
  toggleNotebook: vi.fn(),
  setSideBarBookKey: vi.fn(),
  setHoveredBookKey: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobile: false } }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ systemUIVisible: true, statusBarHeight: 0 }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    bookKeys: ['book-0'],
    hoveredBookKey: 'book-0',
    getView: () => null,
    getViewSettings: () => ({
      writingMode: 'horizontal-tb',
      showHeader: true,
      showFooter: true,
      marginPx: 44,
      compactMarginPx: 16,
    }),
    getViewState: () => null,
    getProgress: () => null,
    setHoveredBookKey: mocks.setHoveredBookKey,
    setBookmarkRibbonVisibility: vi.fn(),
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { format: 'EPUB', title: 'Book' }, bookDoc: { metadata: {} } }),
    getConfig: () => ({}),
    saveConfig: vi.fn(),
    updateBooknotes: vi.fn(),
  }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    sideBarBookKey: 'book-0',
    isSideBarVisible: mocks.isSideBarVisible,
    getIsSideBarVisible: () => mocks.isSideBarVisible,
    setSideBarBookKey: mocks.setSideBarBookKey,
    toggleSideBar: mocks.toggleSideBar,
  }),
}));
vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({
    isNotebookVisible: mocks.isNotebookVisible,
    toggleNotebook: mocks.toggleNotebook,
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {},
    isSettingsDialogOpen: false,
    setSettingsDialogOpen: vi.fn(),
    setSettingsDialogBookKey: vi.fn(),
    setRequestedPanel: vi.fn(),
  }),
}));
vi.mock('@/store/trafficLightStore', () => ({
  useTrafficLightStore: () => ({
    trafficLightInFullscreen: false,
    setTrafficLightVisibility: vi.fn(),
  }),
}));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: vi.fn() }));
vi.mock('@/utils/annotationToolbar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/annotationToolbar')>()),
  getReadingQuickAction: () => null,
}));
vi.mock('@/app/reader/components/annotator/AnnotationTools', () => ({
  annotationToolQuickActions: [{ type: 'copy', label: 'Copy', Icon: () => null }],
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/QuickActionMenu', () => ({ default: () => null }));

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

const renderBar = () =>
  render(
    <HeaderBar
      bookKey='book-0'
      bookTitle='中国历代政治得失'
      isTopLeft
      isHoveredAnim={false}
      gridInsets={insets}
      screenInsets={insets}
      onCloseBook={vi.fn()}
      onGoToLibrary={vi.fn()}
    />,
  );

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.isSideBarVisible = false;
  mocks.isNotebookVisible = false;
});

describe('reader top bar hierarchy', () => {
  it('groups navigation on the left, the title in the middle and book tools on the right', () => {
    renderBar();
    const bar = screen.getByRole('banner', { name: 'Header Bar' });

    const start = bar.querySelector('.header-tools-start')!;
    const startLabels = within(start as HTMLElement)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(startLabels).toEqual(['Toggle Sidebar', 'Go to Library']);

    expect(screen.getByRole('contentinfo', { name: 'Title - 中国历代政治得失' })).toBeTruthy();

    const end = bar.querySelector('.header-tools-end')!;
    const endLabels = within(end as HTMLElement)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(endLabels).toEqual([
      'Add Bookmark',
      'Font & Layout',
      'View Options',
      'Reading Assistant',
    ]);
  });

  it('leaves the collapse control in the open assistant pane', () => {
    mocks.isNotebookVisible = true;
    renderBar();
    expect(screen.queryByRole('button', { name: 'Reading Assistant' })).toBeNull();
  });

  it('leaves the left collapse control in the open sidebar', () => {
    mocks.isSideBarVisible = true;
    renderBar();
    expect(screen.queryByRole('button', { name: 'Toggle Sidebar' })).toBeNull();
  });

  it('toggles the reading assistant from the single right-panel control', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Reading Assistant' }));
    expect(mocks.toggleNotebook).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Conversation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notebook' })).toBeNull();
  });
});
