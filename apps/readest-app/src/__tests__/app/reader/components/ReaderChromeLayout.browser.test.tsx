import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import HeaderBar from '@/app/reader/components/HeaderBar';
import SidebarHeader from '@/app/reader/components/sidebar/Header';
import { MessageCircle, GitBranch, Highlight } from '@/components/GlossaIcons';
import NotebookHeader from '@/app/reader/components/notebook/Header';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';
import '@/styles/glossa-desktop.css';
import '@/styles/glossa-reader-sidebar.css';

const f = vi.hoisted(() => ({ chinese: false }));

vi.mock('@/hooks/useTranslation', async () => {
  const translations: Record<string, string> = await fetch('/locales/zh-CN/translation.json').then(
    (response) => response.json(),
  );
  return {
    useTranslation: () => (key: string, values?: Record<string, string | number>) =>
      (f.chinese ? (translations[key] ?? key) : key).replace(/{{(\w+)}}/g, (_, name: string) =>
        String(values?.[name] ?? name),
      ),
  };
});
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
    setHoveredBookKey: vi.fn(),
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
    isSideBarVisible: true,
    getIsSideBarVisible: () => true,
    setSideBarBookKey: vi.fn(),
    toggleSideBar: vi.fn(),
  }),
}));
vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: () => ({ isNotebookVisible: true, toggleNotebook: vi.fn() }),
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

const renderChrome = () =>
  render(
    <div data-testid='frame' className='relative h-screen w-full overflow-hidden'>
      <div className='flex h-full min-h-0'>
        <div className='glossa-reader-sidebar bg-base-200 relative z-20 flex w-64 shrink-0 flex-col'>
          <SidebarHeader
            isPinned={false}
            isSearchBarVisible={false}
            onClose={vi.fn()}
            onTogglePin={vi.fn()}
            onToggleSearchBar={vi.fn()}
          />
        </div>
        <div className='bg-base-100 relative min-w-0 flex-1'>
          <HeaderBar
            bookKey='book-0'
            bookTitle='中国历代政治得失'
            isTopLeft
            isHoveredAnim={false}
            gridInsets={insets}
            screenInsets={insets}
            onCloseBook={vi.fn()}
            onGoToLibrary={vi.fn()}
          />
        </div>
        <div className='glossa-reader-notebook bg-base-200 relative z-20 flex w-80 shrink-0 flex-col'>
          <NotebookHeader handleClose={vi.fn()}>
            <div
              className='glossa-reader-tabs glossa-notebook-tabs'
              role='tablist'
              aria-label='Notebook'
            >
              {['Conversation', 'Mind map', 'Notes'].map((label, index) => (
                <button
                  key={label}
                  type='button'
                  role='tab'
                  aria-label={label}
                  aria-selected={index === 0}
                  className='glossa-reader-tab glossa-icon-button'
                >
                  {index === 0 ? <MessageCircle /> : index === 1 ? <GitBranch /> : <Highlight />}
                </button>
              ))}
            </div>
          </NotebookHeader>
        </div>
      </div>
    </div>,
  );

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  f.chinese = false;
});

it('shows the unified chrome: quiet buttons, one selected emphasis, Glossa icons', async () => {
  await page.viewport(1100, 96);
  document.documentElement.setAttribute('data-theme', 'default-light');
  renderChrome();
  const bar = screen.getByRole('banner', { name: 'Header Bar' });

  const start = within(bar.querySelector('.header-tools-start') as HTMLElement)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
  expect(start).toEqual(['Go to Library', 'Toggle Sidebar']);
  const end = within(bar.querySelector('.header-tools-end') as HTMLElement)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
  expect(end).toEqual(['Add Bookmark', 'Font & Layout', 'View Options']);

  const title = bar.querySelector('.glossa-reader-book-title')!;
  const titleRect = title.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  expect(
    Math.abs((titleRect.left + titleRect.right - barRect.left - barRect.right) / 2),
  ).toBeLessThan(1);
  const titleStyle = getComputedStyle(title.parentElement!);
  expect(titleStyle.borderTopWidth).toBe('0px');
  expect(titleStyle.borderRadius).toBe('0px');
  expect(
    screen.getByRole('tablist').closest('.notebook-header')!.getBoundingClientRect().height,
  ).toBe(44);

  // Resting icon buttons draw no frame; the pressed toggle keeps a single wash.
  const bookmark = screen.getByRole('button', { name: 'Add Bookmark' });
  const bookmarkStyle = getComputedStyle(bookmark);
  expect(bookmarkStyle.borderTopColor).toBe('rgba(0, 0, 0, 0)');
  expect(bookmarkStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  const contents = screen.getByRole('button', { name: 'Toggle Sidebar' });
  const contentsStyle = getComputedStyle(contents);
  expect(contentsStyle.borderTopColor).toBe('rgba(0, 0, 0, 0)');
  expect(contentsStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  // All bar icons render at one size.
  const iconSizes = [...bar.querySelectorAll('.glossa-icon')].map((icon) => {
    const rect = icon.getBoundingClientRect();
    return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
  });
  expect(new Set(iconSizes).size).toBe(1);

  await page.screenshot({ path: '../../../../../../../.glossa-dev/qa/obsidian-chrome-light.png' });

  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../../../.glossa-dev/qa/obsidian-chrome-dark.png' });

  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.setAttribute('data-eink', 'true');
  await page.screenshot({ path: '../../../../../../../.glossa-dev/qa/obsidian-chrome-eink.png' });
  document.documentElement.removeAttribute('data-eink');

  document.documentElement.dir = 'rtl';
  await page.screenshot({ path: '../../../../../../../.glossa-dev/qa/obsidian-chrome-rtl.png' });
  document.documentElement.removeAttribute('dir');

  f.chinese = true;
  cleanup();
  renderChrome();
  await page.screenshot({ path: '../../../../../../../.glossa-dev/qa/obsidian-chrome-zh.png' });
});
