import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { Bookmark, Bookmarks, BookmarkPlus } from '@/components/GlossaIcons';
import BookmarkView from '@/app/reader/components/sidebar/BookmarkView';
import { initDayjs } from '@/utils/time';
import type { BookNote } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-reader.css';
import '@/styles/glossa-reader-sidebar.css';

vi.mock('@/hooks/useTranslation', async () => {
  const translations = await fetch('/locales/zh-CN/translation.json').then((response) =>
    response.json(),
  );
  return {
    useTranslation: () => (key: string, params?: Record<string, unknown>) =>
      params && 'number' in params
        ? (translations[key] || key).replace('{{number}}', String(params['number']))
        : translations[key] || key,
  };
});

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { appService: {} } }),
}));

vi.mock('@/store/bookDataStore', () => {
  const state = {
    booksData: {
      book1: {
        get config() {
          return { booknotes: mockBooknotes };
        },
      },
    },
  };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ location: 'epubcfi(/6/2!/4,/1:0,/1:400)' }),
  getBookProgress: () => null,
  setBookProgress: vi.fn(),
  clearBookProgress: vi.fn(),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ setActiveBooknoteType: vi.fn(), setBooknoteResults: vi.fn() }),
}));

vi.mock('@/services/nav', () => ({
  findTocItemBS: (_toc: unknown, cfi: string) => {
    const labels: Record<string, string> = {
      '/6/2': '版权页',
      '/6/6': '第一章 争吵之后',
      '/6/10': '第二章 远行',
      '/6/14': '第三章 归来',
    };
    const spine = cfi.match(/\/6\/(\d+)!/)?.[1];
    return { id: Number(spine ?? 0), href: `ch${spine}.html`, label: labels[`/6/${spine}`] ?? '' };
  },
  findParentPath: vi.fn(),
  findAdjacentTocItem: vi.fn(),
  computeBookNav: vi.fn(),
  hydrateBookNav: vi.fn(),
  updateToc: vi.fn(),
  isBookNavCacheCurrent: vi.fn(),
}));

let mockBooknotes: BookNote[] = [];

const makeBookmark = (id: string, cfi: string, text: string): BookNote =>
  ({ id, type: 'bookmark', cfi, text, note: '', page: 3, createdAt: Date.now() }) as BookNote;

const renderList = (width: number) =>
  act(() => {
    render(
      <div
        className='glossa-reader-sidebar scroll-container'
        style={{ width, height: 520, background: 'var(--glossa-surface)' }}
      >
        <div className='flex items-center gap-3 p-4' aria-label='书签图标对照'>
          <Bookmarks size={18} />
          <BookmarkPlus size={18} />
          <Bookmark size={18} fill='currentColor' />
        </div>
        <BookmarkView bookKey='book1' toc={[]} />
      </div>,
    );
  });

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});

it('renders a quiet bookmark list with ink states, hover delete button and keyboard access', async () => {
  initDayjs('zh-cn');
  await page.viewport(900, 720);
  document.documentElement.setAttribute('data-theme', 'default-light');
  mockBooknotes = [
    makeBookmark(
      'bm-1',
      'epubcfi(/6/2!/4/1:0)',
      '×××出版社印刷发行，北京市东城区某街22号 100010。',
    ),
    makeBookmark('bm-2', 'epubcfi(/6/6!/4/1:5)', '他们吵完之后，谁也没有再提起那天晚上的事情。'),
    makeBookmark(
      'bm-3',
      'epubcfi(/6/10!/4/1:0)',
      '火车穿过平原的时候，天色刚刚泛白，站台上的灯还亮着，映在结霜的玻璃上。',
    ),
  ];
  renderList(320);
  await screen.findByText('版权页', {}, { timeout: 5000 });
  await screen.findByText('第二章 远行', {}, { timeout: 5000 });

  const rows = within(screen.getByRole('tree'))
    .getAllByRole('button')
    .filter((row) => row.classList.contains('glossa-reader-bookmark-item'));
  expect(rows.length).toBe(3);
  const currentRow = rows.find((row) => row.getAttribute('aria-current') === 'page')!;
  const restRow = rows.find((row) => row.getAttribute('aria-current') !== 'page')!;

  // Quiet chassis: transparent at rest, a softened ink wash only on the current
  // page; content sits 16px inside the pane.
  expect(getComputedStyle(restRow).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  const selectedWash = getComputedStyle(currentRow).backgroundColor;
  expect(selectedWash).not.toBe('rgba(0, 0, 0, 0)');
  const paneRect = screen.getByRole('tree').getBoundingClientRect();
  const heading = within(currentRow).getByText('版权页');
  expect(Math.round(heading.getBoundingClientRect().left - paneRect.left)).toBe(16);
  const preview = currentRow.querySelector('.glossa-reader-bookmark-preview')!;
  const header = currentRow.querySelector('.glossa-reader-bookmark-header')!;
  const pageLabel = within(header as HTMLElement).getByText('第 3 页');
  const deleteButton = within(currentRow).getByRole('button', { name: '删除' });
  const pageRect = pageLabel.getBoundingClientRect();
  const deleteRect = deleteButton.getBoundingClientRect();
  const headingRect = heading.getBoundingClientRect();
  const previewRect = preview.getBoundingClientRect();
  expect(Math.round(paneRect.right - pageRect.right)).toBe(16);
  expect(Math.abs(pageRect.bottom - headingRect.bottom)).toBeLessThan(2);
  expect(previewRect.top - header.getBoundingClientRect().bottom).toBe(4);
  expect(previewRect.right).toBeLessThanOrEqual(deleteRect.left - 4);
  expect(Math.abs(previewRect.bottom - deleteRect.bottom)).toBeLessThan(1);
  expect(currentRow.getBoundingClientRect().height).toBeLessThan(90);

  // The delete button stays hidden at rest on hover-capable pointers and
  // never shifts the row when it appears.
  const trigger = within(restRow).getByRole('button', { name: '删除' });
  expect(getComputedStyle(trigger).opacity).toBe('0');
  expect(getComputedStyle(trigger).pointerEvents).toBe('none');
  const rowBefore = restRow.getBoundingClientRect();
  await userEvent.hover(restRow);
  await vi.waitFor(() => expect(getComputedStyle(trigger).opacity).toBe('1'));
  expect(getComputedStyle(trigger).pointerEvents).toBe('auto');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/bookmark-delete-hover.png' });
  const rowAfter = restRow.getBoundingClientRect();
  expect(rowAfter.width).toBe(rowBefore.width);
  expect(rowAfter.height).toBe(rowBefore.height);
  expect(rowAfter.left).toBe(rowBefore.left);
  await userEvent.unhover(restRow);

  // Hovering the current page keeps its selected wash instead of the hover one.
  await userEvent.hover(currentRow);
  expect(getComputedStyle(currentRow).backgroundColor).toBe(selectedWash);
  await userEvent.unhover(currentRow);

  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/bookmark-list-light.png' });
  document.documentElement.setAttribute('data-theme', 'default-dark');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/bookmark-list-dark.png' });
  document.documentElement.setAttribute('data-theme', 'default-light');

  // Keyboard access reveals the same action without opening a menu.
  const focusedTrigger = within(restRow).getByRole('button', { name: '删除' });
  focusedTrigger.focus();
  await vi.waitFor(() => expect(getComputedStyle(focusedTrigger).opacity).toBe('1'));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.queryByRole('button', { name: '更多' })).toBeNull();
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/bookmark-delete-focus.png' });

  // Narrow sidebar keeps the same rhythm without overflow.
  cleanup();
  renderList(240);
  await screen.findByText('第二章 远行', {}, { timeout: 5000 });
  await page.viewport(320, 720);
  const narrowPane = screen.getByRole('tree');
  expect(narrowPane.scrollWidth).toBeLessThanOrEqual(240);
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/bookmark-list-narrow.png' });
  document.documentElement.setAttribute('dir', 'rtl');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/bookmark-list-rtl.png' });
  expect(narrowPane.scrollWidth).toBeLessThanOrEqual(240);
  document.documentElement.removeAttribute('dir');
  await page.viewport(900, 720);

  // E-ink marks the current row with a crisp outline instead of relying on
  // the wash alone.
  cleanup();
  renderList(320);
  await screen.findByText('第二章 远行', {}, { timeout: 5000 });
  document.documentElement.setAttribute('data-eink', 'true');
  const einkRow = within(screen.getByRole('tree'))
    .getAllByRole('button')
    .find((row) => row.getAttribute('aria-current') === 'page')!;
  expect(getComputedStyle(einkRow).outlineWidth).toBe('1px');
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/bookmark-list-eink.png' });
});

it('shows only the empty bookmark state with no duplicate action', async () => {
  mockBooknotes = [];
  document.documentElement.setAttribute('data-theme', 'default-dark');
  renderList(320);
  await screen.findByText('暂无书签');
  expect(screen.queryByRole('button')).toBeNull();
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/bookmark-list-empty.png' });
});
