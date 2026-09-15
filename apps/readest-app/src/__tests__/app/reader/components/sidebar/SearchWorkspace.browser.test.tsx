import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import SearchBar from '@/app/reader/components/sidebar/SearchBar';
import SearchResults from '@/app/reader/components/sidebar/SearchResults';
import SearchResultsNav from '@/app/reader/components/sidebar/SearchResultsNav';
import { useSidebarStore } from '@/store/sidebarStore';
import type { BookSearchConfig } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';
import '@/styles/glossa-reader-sidebar.css';

vi.mock('@/hooks/useTranslation', async () => {
  const translations = await fetch('/locales/zh-CN/translation.json').then((r) => r.json());
  return {
    useTranslation: () => (key: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
        translations[key] ?? key,
      ),
  };
});
const cfg: { current: BookSearchConfig } = {
  current: { scope: 'book', mode: 'contains', matchCase: false, matchDiacritics: false },
};
const appService = {};
const goTo = vi.fn();
const search = vi.fn(async function* () {
  yield 'done';
});
const view = {
  book: { toc: [] },
  clearSearch: vi.fn(),
  setSearchMatchActive: vi.fn(),
  search,
  goTo,
};
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService, envConfig: {} }) }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ book: { hash: 'search-fixture' } }),
    getConfig: () => ({ searchConfig: cfg.current }),
    setConfig: (_key: string, update: { searchConfig: BookSearchConfig }) => {
      cfg.current = update.searchConfig;
    },
    saveConfig: vi.fn(),
  }),
}));
vi.mock('@/store/readerStore', () => {
  const store = {
    getView: () => view,
    getProgress: () => ({ section: { current: 0 }, location: 'epubcfi(/6/2!/4/1:0)' }),
    getViewSettings: () => ({}),
    hoveredBookKey: null,
  };
  return {
    useReaderStore: <T,>(select?: (s: typeof store) => T) => (select ? select(store) : store),
  };
});
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ location: 'epubcfi(/6/2!/4/1:0)' }),
}));
vi.mock('@/app/reader/hooks/useScrollToItem', () => ({
  default: () => ({ isCurrent: false, viewRef: { current: null } }),
}));
vi.mock('@/services/librarySearchService', () => ({
  createLibrarySearchSession: () => ({ close: vi.fn() }),
  resolveSearchChapterRange: vi.fn(),
  resolveSearchResultCfis: async () => [
    { cfi: 'epubcfi(/6/2!/4/1:20)' },
    { cfi: 'epubcfi(/6/2!/4/1:80)' },
  ],
  searchLibraryBooks: async function* () {
    yield {
      type: 'result',
      result: {
        index: 0,
        label: '第一章 阅读与理解',
        subitems: [
          {
            locator: {},
            excerpt: {
              pre: '每一次',
              match: '阅读',
              post: '，都是与另一种经验相遇。理解在文字与生活之间慢慢发生。',
            },
          },
          {
            locator: {},
            excerpt: {
              pre: '当我们放慢',
              match: '阅读',
              post: '的速度，词语之间原本被忽略的联系开始显现。',
            },
          },
        ],
      },
    };
    yield { type: 'book-completed' };
  },
}));
function Workspace() {
  const results = useSidebarStore((s) => s.searchNavStates['search-fixture']?.searchResults);
  return (
    <>
      <aside
        className='glossa-reader-sidebar'
        style={{ width: 280, height: 520, background: 'var(--glossa-surface)' }}
      >
        <SearchBar isVisible bookKey='search-fixture' onHideSearchBar={vi.fn()} />
        {results && (
          <SearchResults bookKey='search-fixture' results={results} onSelectResult={goTo} />
        )}
      </aside>
      <SearchResultsNav
        bookKey='search-fixture'
        gridInsets={{ top: 0, bottom: 32, left: 0, right: 0 }}
      />
    </>
  );
}
afterEach(() => {
  cleanup();
  useSidebarStore.getState().clearSearch('search-fixture');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});
it('keeps search modes in one menu with quiet selection and visible keyboard focus in all themes', async () => {
  await page.viewport(780, 620);
  document.documentElement.setAttribute('data-theme', 'default-light');
  await act(async () => {
    render(<Workspace />);
  });
  const input = screen.getByRole('textbox');
  expect(input.getAttribute('placeholder')).toBe('搜索书内文字');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'yuedu' } });
  expect(screen.queryByText('第一章 阅读与理解')).toBeNull();
  fireEvent.change(input, { target: { value: '阅读' } });
  fireEvent.compositionEnd(input);
  await vi.waitFor(() => expect(screen.getByText('第一章 阅读与理解')).toBeTruthy());
  await vi.waitFor(() => expect(screen.getByText('1 / 2')).toBeTruthy());
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(goTo).toHaveBeenLastCalledWith('epubcfi(/6/2!/4/1:80)');
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(goTo).toHaveBeenLastCalledWith('epubcfi(/6/2!/4/1:20)');
  await userEvent.click(screen.getByRole('button', { name: '下一个结果' }));
  expect(goTo).toHaveBeenLastCalledWith('epubcfi(/6/2!/4/1:80)');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/search-light.png' });
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/search-dark.png' });
  document.documentElement.setAttribute('data-theme', 'default-light');
  await userEvent.click(screen.getByRole('button', { name: '搜索选项' }));
  expect(screen.getAllByRole('menuitemradio')).toHaveLength(4);
  expect(screen.queryByText('高级搜索')).toBeNull();
  expect(screen.getByRole('menuitemcheckbox', { name: '区分大小写' })).toBeTruthy();
  const normal = screen.getByRole('menuitemradio', { name: '普通' });
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    await userEvent.hover(normal);
    const style = getComputedStyle(normal);
    expect(style.outlineStyle).toBe('none');
    expect(style.boxShadow).toBe('none');
    // Selection must keep the same fill as the scope tabs, including on hover.
    const scope = document.querySelector('.glossa-search-scope [aria-pressed="true"]')!;
    await vi.waitFor(() =>
      expect(getComputedStyle(normal).backgroundColor).toBe(
        getComputedStyle(scope).backgroundColor,
      ),
    );
    await page.screenshot({ path: `../../../../../../.glossa-dev/qa/search-menu-${theme}.png` });
  }
  await userEvent.keyboard('{ArrowDown}');
  const focused = document.activeElement!;
  expect(focused.getAttribute('role')).toBe('menuitemradio');
  expect(getComputedStyle(focused).outlineStyle).toBe('none');
  expect(getComputedStyle(focused).textDecorationLine).toBe('underline');
  await userEvent.click(screen.getByRole('menuitemradio', { name: '邻近' }));
  await vi.waitFor(() => expect(screen.getByRole('menuitemradio', { name: '20 词' })).toBeTruthy());
  await userEvent.click(screen.getByRole('menuitemradio', { name: '20 词' }));
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/search-menu-nearby.png' });
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: '搜索选项' }).textContent).toBe('选项');
  expect(cfg.current.nearbyWords).toBe(20);
  expect(cfg.current.mode).toBe('nearby-words');
  await vi.waitFor(() => expect(screen.getByText('第一章 阅读与理解')).toBeTruthy());
  await page.viewport(320, 620);
  const aside = document.querySelector('aside')!;
  aside.style.width = '240px';
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/search-narrow.png' });
  expect(aside.scrollWidth).toBeLessThanOrEqual(240);
  document.documentElement.setAttribute('dir', 'rtl');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/search-rtl.png' });
  await userEvent.click(screen.getByRole('button', { name: '搜索选项' }));
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '搜索选项' }));
  document.documentElement.setAttribute('data-eink', 'true');
  await userEvent.click(screen.getByRole('button', { name: '搜索选项' }));
  const selected = screen.getByRole('menuitemradio', { name: '邻近' });
  expect(getComputedStyle(selected).outlineStyle).toBe('none');
  expect(document.querySelector('[role="menu"]')!.scrollWidth).toBeLessThanOrEqual(296);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/search-menu-eink-rtl.png' });
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: '返回阅读位置' }));
  expect(goTo).toHaveBeenLastCalledWith('epubcfi(/6/2!/4/1:0)');
  expect(useSidebarStore.getState().getSearchNavState('search-fixture').searchResults).toBeNull();
});
