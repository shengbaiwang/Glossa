import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import SidebarContent from '@/app/reader/components/sidebar/Content';

const mocks = vi.hoisted(() => ({
  config: { viewSettings: { sideBarTab: 'toc', fontSize: 20 }, booknotes: [] },
  isSearchBarVisible: false,
  setConfig: vi.fn(),
  setSideBarVisible: vi.fn(),
  setSearchBarVisible: vi.fn(),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => mocks.config,
    setConfig: mocks.setConfig,
    getBookData: () => ({ book: { hash: 'book', format: 'EPUB' } }),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setHoveredBookKey: vi.fn() }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    isSearchBarVisible: mocks.isSearchBarVisible,
    setSideBarVisible: mocks.setSideBarVisible,
    setSearchBarVisible: mocks.setSearchBarVisible,
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('overlayscrollbars-react', () => ({
  OverlayScrollbarsComponent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/app/reader/components/sidebar/TOCView', () => ({ default: () => <p>Chapter list</p> }));
vi.mock('@/app/reader/components/sidebar/BookmarkView', () => ({
  default: () => <p>bookmark list</p>,
}));

const bookDoc = { toc: [] } as unknown as BookDoc;

beforeEach(() => {
  mocks.isSearchBarVisible = false;
  mocks.setSearchBarVisible.mockImplementation((visible: boolean) => {
    mocks.isSearchBarVisible = visible;
  });
  mocks.config = { viewSettings: { sideBarTab: 'toc', fontSize: 20 }, booknotes: [] };
  mocks.setConfig.mockImplementation((_key, patch) => {
    mocks.config = { ...mocks.config, ...patch };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Reader sidebar content', () => {
  it('keeps chapter learning notes out of the left navigation and restores old study tabs to contents', () => {
    mocks.config.viewSettings.sideBarTab = 'study';
    render(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    expect(screen.queryByRole('tab', { name: 'Study' })).toBeNull();
    expect(screen.getByRole('tab', { selected: true }).getAttribute('aria-label')).toBe('Contents');
    expect(screen.getByText('Chapter list')).toBeTruthy();
  });

  it('changes panels and saves the tab immediately without a blank transition', () => {
    const { rerender } = render(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    expect(mocks.setConfig).toHaveBeenCalledWith('book-0', {
      viewSettings: { sideBarTab: 'bookmarks', fontSize: 20 },
    });
    expect(mocks.setSearchBarVisible).toHaveBeenCalledWith(false);
    rerender(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    expect(screen.getByText('bookmark list')).toBeTruthy();
    expect(screen.queryByText('Chapter list')).toBeNull();
    const panel = screen.getByRole('tabpanel');
    const tab = screen.getByRole('tab', { selected: true });
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(tab.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps icon navigation available above search and returns to the active destination', () => {
    mocks.isSearchBarVisible = true;
    render(
      <SidebarContent
        bookDoc={bookDoc}
        sideBarBookKey='book-0'
        renderNavigation={(tabs) => <header>{tabs}</header>}
      >
        <p>Search matches</p>
      </SidebarContent>,
    );
    const tab = screen.getByRole('tab', { name: 'Contents' });
    expect(tab.closest('header')).toBeTruthy();
    expect(screen.getByRole('tabpanel').id).toBe(tab.getAttribute('aria-controls'));
    expect(screen.getByText('Search matches')).toBeTruthy();
    fireEvent.click(tab);
    expect(mocks.setSearchBarVisible).toHaveBeenCalledWith(false);
    expect(mocks.setConfig).not.toHaveBeenCalled();
  });

  it('makes search exclusive, including before results arrive, and preserves the saved destination', () => {
    mocks.config.viewSettings.sideBarTab = 'bookmarks';
    const { rerender } = render(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    const search = screen.getByRole('tab', { name: 'Search' });
    fireEvent.click(search);
    rerender(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    expect(screen.getAllByRole('tab', { selected: true })).toEqual([search]);
    expect(screen.queryByText('bookmark list')).toBeNull();
    expect(screen.queryByText('Chapter list')).toBeNull();
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(search.id);
    expect(mocks.config.viewSettings.sideBarTab).toBe('bookmarks');
    fireEvent.click(search);
    expect(mocks.isSearchBarVisible).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Contents' }));
    rerender(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    expect(screen.getAllByRole('tab', { selected: true })).toEqual([
      screen.getByRole('tab', { name: 'Contents' }),
    ]);
    expect(screen.getByText('Chapter list')).toBeTruthy();
  });

  it('selects only search when opened by the search shortcut and restores the prior tab on close', () => {
    mocks.config.viewSettings.sideBarTab = 'bookmarks';
    mocks.isSearchBarVisible = true;
    const { rerender } = render(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    expect(screen.getByRole('tab', { selected: true }).getAttribute('aria-label')).toBe('Search');
    mocks.isSearchBarVisible = false;
    rerender(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    expect(screen.getByRole('tab', { selected: true }).getAttribute('aria-label')).toBe(
      'Bookmarks',
    );
    expect(screen.getByText('bookmark list')).toBeTruthy();
  });

  it('does not dismiss the sidebar when its selected tab is pressed again on mobile', () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    render(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    fireEvent.click(screen.getByRole('tab', { name: 'Contents' }));
    expect(mocks.setSideBarVisible).not.toHaveBeenCalled();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  });

  it('falls back to contents for a removed legacy tab', () => {
    mocks.config.viewSettings.sideBarTab = 'annotations';
    render(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    expect(screen.getByRole('tab', { selected: true }).getAttribute('aria-label')).toBe('Contents');
    expect(screen.getByText('Chapter list')).toBeTruthy();
  });
});
