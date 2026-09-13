import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SideBar from '@/app/reader/components/sidebar/SideBar';
import { eventDispatcher } from '@/utils/event';

const mocks = vi.hoisted(() => ({
  setSideBarVisible: vi.fn(),
  setSearchBarVisible: vi.fn(),
  setSideBarBookKey: vi.fn(),
  setSearchTerm: vi.fn(),
  clearSearch: vi.fn(),
  isSearchBarVisible: false,
  shortcuts: {} as { onEscape?: () => void; onShowSearchBar?: () => void },
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalReadSettings: {} } }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ updateAppTheme: vi.fn(), safeAreaInsets: null }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(
    () => ({
      sideBarBookKey: 'book',
      getSearchNavState: () => ({}),
      isSearchBarVisible: mocks.isSearchBarVisible,
      setSearchBarVisible: mocks.setSearchBarVisible,
      setSideBarBookKey: mocks.setSideBarBookKey,
      setSearchTerm: mocks.setSearchTerm,
      clearSearch: mocks.clearSearch,
    }),
    { getState: () => ({ isSideBarPinned: true }) },
  ),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: {}, bookDoc: { metadata: { language: 'en' } } }),
    getConfig: () => ({ viewSettings: { sideBarTab: 'toc' } }),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: () => null, getViewSettings: () => ({}) }),
}));
vi.mock('@/app/reader/hooks/useSidebar', () => ({
  default: () => ({
    sideBarWidth: '240px',
    isSideBarPinned: true,
    isSideBarVisible: true,
    setSideBarVisible: mocks.setSideBarVisible,
  }),
}));
vi.mock('@/hooks/useShortcuts', () => ({
  default: (callbacks: typeof mocks.shortcuts) => {
    mocks.shortcuts = callbacks;
  },
}));
vi.mock('@/hooks/usePanelResize', () => ({ usePanelResize: () => ({}) }));
vi.mock('@/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({
    panelRef: { current: null },
    overlayRef: { current: null },
    panelHeight: { current: 1 },
  }),
}));
vi.mock('@/app/reader/components/sidebar/Header', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/Content', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/SearchBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/SearchResults', () => ({ default: () => null }));

const originalWidth = window.innerWidth;
beforeEach(() => {
  mocks.isSearchBarVisible = false;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});

describe('sidebar when a pinned desktop reader becomes mobile', () => {
  it('uses an overlay above the mobile header and dismisses after navigation without changing the saved pin', async () => {
    const { container, rerender } = render(<SideBar />);
    expect(container.querySelector('.overlay')).toBeNull();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    rerender(<SideBar />);

    const panel = screen.getByRole('navigation', { name: 'Sidebar' });
    expect(container.querySelector('.overlay')).toBeTruthy();
    expect(panel.classList.contains('z-[45]')).toBe(true);
    expect(panel.style.position).toBe('fixed');
    await act(() => eventDispatcher.dispatch('navigate'));
    expect(mocks.setSideBarVisible).toHaveBeenCalledWith(false);
  });
});

it('closes an empty search with Escape and clears it before a new search can open', () => {
  mocks.isSearchBarVisible = true;
  render(<SideBar />);
  act(() => mocks.shortcuts.onEscape?.());
  expect(mocks.setSearchBarVisible).toHaveBeenLastCalledWith(false);
  expect(mocks.clearSearch).toHaveBeenCalledWith('book');
  expect(mocks.setSideBarVisible).not.toHaveBeenCalled();
  act(() => mocks.shortcuts.onShowSearchBar?.());
  expect(mocks.setSearchBarVisible).toHaveBeenLastCalledWith(true);
  expect(mocks.setSideBarVisible).toHaveBeenLastCalledWith(true);
  expect(mocks.clearSearch).toHaveBeenCalledTimes(1);
});

it('opens search immediately when invoked from selected text', async () => {
  render(<SideBar />);
  await act(() => eventDispatcher.dispatch('search-term', { bookKey: 'book', term: 'gloss' }));
  expect(mocks.setSearchBarVisible).toHaveBeenCalledWith(true);
  expect(mocks.setSearchTerm).toHaveBeenCalledWith('book', 'gloss');
});
