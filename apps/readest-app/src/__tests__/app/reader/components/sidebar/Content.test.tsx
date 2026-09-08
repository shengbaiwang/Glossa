import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import SidebarContent from '@/app/reader/components/sidebar/Content';

const mocks = vi.hoisted(() => ({
  config: { viewSettings: { sideBarTab: 'toc', fontSize: 20 }, booknotes: [] },
  setConfig: vi.fn(),
  setSideBarVisible: vi.fn(),
  setSearchBarVisible: vi.fn(),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: () => mocks.config, setConfig: mocks.setConfig }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setHoveredBookKey: vi.fn() }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
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
vi.mock('@/app/reader/components/sidebar/BooknoteView', () => ({
  default: ({ type }: { type: string }) => <p>{type} list</p>,
}));

const bookDoc = { toc: [] } as unknown as BookDoc;

beforeEach(() => {
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

  it('does not dismiss the sidebar when its selected tab is pressed again on mobile', () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    render(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    fireEvent.click(screen.getByRole('tab', { name: 'Contents' }));
    expect(mocks.setSideBarVisible).not.toHaveBeenCalled();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  });

  it('falls back to contents for a removed legacy tab', () => {
    mocks.config.viewSettings.sideBarTab = 'history';
    render(<SidebarContent bookDoc={bookDoc} sideBarBookKey='book-0' />);
    expect(screen.getByRole('tab', { selected: true }).getAttribute('aria-label')).toBe('Contents');
    expect(screen.getByText('Chapter list')).toBeTruthy();
  });
});
