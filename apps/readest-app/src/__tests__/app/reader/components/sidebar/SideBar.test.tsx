import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SideBar from '@/app/reader/components/sidebar/SideBar';
import { eventDispatcher } from '@/utils/event';

const mocks = vi.hoisted(() => ({ setSideBarVisible: vi.fn() }));

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
    () => ({ sideBarBookKey: 'book', getSearchNavState: () => ({}) }),
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
vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));
vi.mock('@/hooks/usePanelResize', () => ({ usePanelResize: () => ({}) }));
vi.mock('@/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({
    panelRef: { current: null },
    overlayRef: { current: null },
    panelHeight: { current: 1 },
  }),
}));
vi.mock('@/app/reader/components/sidebar/Header', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/BookCard', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/Content', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/SearchBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/SearchResults', () => ({ default: () => null }));

const originalWidth = window.innerWidth;
beforeEach(() => {
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
