import { useEffect, useState } from 'react';
import GroupItem from '@/app/library/components/GroupItem';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import BookItem from '@/app/library/components/BookItem';
import RecentShelf from '@/app/library/components/RecentShelf';
import LibraryHeader from '@/app/library/components/LibraryHeader';
import LibraryNavigation from '@/app/library/components/LibraryNavigation';
import { DropdownProvider } from '@/context/DropdownContext';
import type { Book } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';
import '@/styles/glossa-desktop.css';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), details: vi.fn(), search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
}));
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useShortcuts', () => ({ default: vi.fn() }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }),
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: () => ({ library: [], currentBookshelf: [] }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { libraryGroupBy: 'none', libraryFolders: ['历史', '历史/近代'] },
    openSettingsDialog: mocks.settings,
  }),
}));
vi.mock('@/components/BookCover', () => ({
  default: ({
    book,
    onAspectRatioChange,
  }: {
    book: Book;
    onAspectRatioChange?: (ratio: number) => void;
  }) => {
    useEffect(() => {
      const timer = setTimeout(() => onAspectRatioChange?.(book.hash === 'long' ? 0.45 : 1.4), 10);
      return () => clearTimeout(timer);
    }, [book.hash, onAspectRatioChange]);
    return (
      <div
        className='flex h-full w-full items-center justify-center p-4 text-center'
        style={{ background: book.hash === 'long' ? '#64736b' : '#c4b9a3', color: '#fff' }}
      >
        {book.title}
      </div>
    );
  },
}));

const books: Book[] = [
  {
    hash: 'long',
    title: '雨后的城市：关于散步与阅读的随笔集',
    author: '林青',
    format: 'EPUB',
    progress: [23, 100],
    createdAt: 1,
    updatedAt: 1,
  },
  {
    hash: 'short',
    title: '北方来信',
    author: '江远',
    format: 'EPUB',
    readingStatus: 'finished',
    createdAt: 1,
    updatedAt: 1,
  },
];

function LibraryPreview() {
  const [sidebar, setSidebar] = useState(true);
  return (
    <DropdownProvider>
      <div className='full-height flex flex-col overflow-hidden'>
        <LibraryHeader
          isSidebarVisible={sidebar}
          onToggleSidebar={() => setSidebar(!sidebar)}
          isSelectMode={false}
          isSelectAll={false}
          onToggleSelectMode={vi.fn()}
          onSelectAll={vi.fn()}
          onDeselectAll={vi.fn()}
          onImportBooks={vi.fn()}
          onPullLibrary={vi.fn()}
          searchQuery=''
          searchTarget='books'
          searchConfig={{
            scope: 'book',
            mode: 'contains',
            matchCase: false,
            matchDiacritics: false,
          }}
          onSearchConfigChange={vi.fn()}
          onSearchQueryChange={vi.fn()}
          onSearchTargetChange={vi.fn()}
        />
        <div className='glossa-library-workspace'>
          {sidebar && <LibraryNavigation onNavigate={vi.fn()} />}
          <main className='glossa-library-content overflow-auto p-4'>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 184px))',
                gap: 12,
              }}
            >
              {books.map((book) => (
                <div key={book.hash} className='glossa-book-card glossa-book-card-grid'>
                  <BookItem
                    book={book}
                    mode='grid'
                    coverFit='crop'
                    isSelectMode={false}
                    bookSelected={false}
                    transferProgress={null}
                    handleBookUpload={vi.fn()}
                    handleBookDownload={vi.fn()}
                    showBookDetailsModal={mocks.details}
                    showTimeRemaining={false}
                  />
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    </DropdownProvider>
  );
}

afterEach(() => {
  cleanup();
  document.body.classList.remove('bg-base-100', 'text-base-content');
  vi.clearAllMocks();
  mocks.search = '';
  for (const attr of ['dir', 'data-theme', 'data-eink', 'data-page'])
    document.documentElement.removeAttribute(attr);
});

it('separates direct folders from the library and metadata with quiet, compact rows', async () => {
  await page.viewport(1100, 780);
  document.documentElement.setAttribute('data-page', 'library');
  mocks.search = 'groupBy=subject';
  render(<LibraryPreview />);
  const library = screen.getByRole('region', { name: 'Library' });
  const browse = screen.getByRole('region', { name: 'Browse' });
  const selected = screen.getByRole('button', { name: 'Subjects' });
  const regular = screen.getByRole('button', { name: 'Authors' });
  const groups = screen.getByRole('region', { name: 'My Groups' });
  expect(groups.getBoundingClientRect().top - library.getBoundingClientRect().bottom).toBe(24);
  expect(browse.getBoundingClientRect().top - groups.getBoundingClientRect().bottom).toBe(24);
  expect(getComputedStyle(regular).fontWeight).toBe('400');
  expect(getComputedStyle(selected).fontWeight).toBe('500');
  expect(getComputedStyle(selected).borderRadius).toBe('7px');
  const nav = screen.getByRole('navigation', { name: 'Library' });
  const folder = screen.getByRole('button', { name: '历史' });
  for (const selector of ['svg', 'span']) {
    const reference = regular.querySelector(selector)!.getBoundingClientRect();
    const item = folder.querySelector(selector)!.getBoundingClientRect();
    expect(item.left).toBeCloseTo(reference.left, 0);
  }
  expect(folder.getBoundingClientRect().height).toBe(regular.getBoundingClientRect().height);
  const libraryHeading = library.querySelector('h2')!.getBoundingClientRect();
  expect(groups.querySelector('h2')!.getBoundingClientRect().height).toBe(libraryHeading.height);
  for (const button of nav.querySelectorAll('button')) {
    const bounds = button.getBoundingClientRect();
    expect(bounds.height).toBeGreaterThanOrEqual(
      matchMedia('(pointer: coarse)').matches
        ? 44
        : button.classList.contains('glossa-library-folders-heading')
          ? 30
          : 36,
    );
    expect(bounds.left).toBeGreaterThanOrEqual(nav.getBoundingClientRect().left);
    expect(bounds.right).toBeLessThanOrEqual(nav.getBoundingClientRect().right);
    const svg = button.querySelector('svg');
    if (!svg || button.hasAttribute('data-expander')) continue;
    const icon = svg.getBoundingClientRect();
    expect(icon.width).toBe(18);
    expect(icon.height).toBe(18);
  }
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    const background = getComputedStyle(selected).backgroundColor;
    await page.getByRole('button', { name: 'Subjects' }).hover();
    expect(getComputedStyle(selected).backgroundColor).toBe(background);
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/library-sections-${matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer'}-${theme}.png`,
    });
  }
});

it('aligns authors and progress across one-line and two-line titles with comfortable spacing', async () => {
  await page.viewport(1100, 780);
  document.documentElement.setAttribute('data-page', 'library');
  const { container } = render(<LibraryPreview />);
  const cards = Array.from(container.querySelectorAll('.library-grid-item'));
  const bounds = (card: Element, selector: string) =>
    card.querySelector(selector)!.getBoundingClientRect();
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    for (const selector of ['.glossa-book-author', '.glossa-book-status', '.bookitem-main']) {
      expect(bounds(cards[0]!, selector).bottom).toBeCloseTo(bounds(cards[1]!, selector).bottom, 0);
    }
    for (const card of cards) {
      const title = bounds(card, '.glossa-book-title');
      const author = bounds(card, '.glossa-book-author');
      expect(author.top - title.bottom).toBeCloseTo(6, 0);
      const footer = bounds(card, '.glossa-book-status');
      expect(footer.top - author.bottom).toBeCloseTo(10, 0);
      const detail = bounds(card, '.glossa-book-detail-button');
      expect(detail.right).toBeCloseTo(footer.right, 0);
      if (matchMedia('(pointer: coarse)').matches) {
        expect(detail.width).toBeGreaterThanOrEqual(44);
        expect(detail.height).toBeGreaterThanOrEqual(44);
      }
    }
    expect(getComputedStyle(screen.getByText('Finished')).borderTopWidth).toBe('0px');
    expect(screen.queryByRole('button', { name: 'Upload Book' })).toBeNull();
    const details = screen.getAllByRole('button', { name: 'Show Book Details' });
    details[0]!.focus();
    await waitFor(() => expect(getComputedStyle(details[0]!).opacity).toBe('1'));
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/natural-library-${matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer'}-${theme}.png`,
    });
  }
  await userEvent.keyboard('{Enter}');
  expect(mocks.details).toHaveBeenCalledExactlyOnceWith(books[0]);
});

it.each([
  { theme: 'default-light', width: 1100, rtl: false, eink: false },
  { theme: 'default-dark', width: 1100, rtl: false, eink: false },
  { theme: 'default-dark', width: 320, rtl: true, eink: false },
  { theme: 'default-light', width: 320, rtl: false, eink: true },
])('keeps the resume information button fully visible in $theme at $width, rtl=$rtl, eink=$eink', async ({
  theme,
  width,
  rtl,
  eink,
}) => {
  await page.viewport(width, 600);
  document.documentElement.setAttribute('data-page', 'library');
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('data-eink', String(eink));
  document.body.classList.add('bg-base-100', 'text-base-content');
  const props = {
    books: [books[0]!],
    coverFit: 'crop' as const,
    isSelectMode: false,
    selectedBooks: new Set<string>(),
    onOpenBook: vi.fn(),
    toggleSelection: vi.fn(),
    handleSetSelectMode: vi.fn(),
    handleBookUpload: vi.fn(),
    handleBookDownload: vi.fn(),
    showBookDetailsModal: mocks.details,
    showTimeRemaining: false,
  };
  const { container, rerender } = render(<RecentShelf {...props} />);
  const card = screen.getByRole('button', { name: books[0]!.title });
  const detail = screen.getByRole('button', { name: 'Show Book Details' });
  const footer = container.querySelector('.glossa-book-status')!;
  const buttonBounds = detail.getBoundingClientRect();
  expect(buttonBounds.top).toBeGreaterThanOrEqual(footer.getBoundingClientRect().top);
  expect(buttonBounds.bottom).toBeLessThanOrEqual(footer.getBoundingClientRect().bottom);
  for (const x of [buttonBounds.left + 3, buttonBounds.right - 3]) {
    expect(detail.contains(document.elementFromPoint(x, buttonBounds.bottom - 3))).toBe(true);
  }
  if (matchMedia('(pointer: coarse)').matches) {
    expect(buttonBounds.width).toBeGreaterThanOrEqual(44);
    expect(buttonBounds.height).toBeGreaterThanOrEqual(44);
  }
  expect(getComputedStyle(card).borderTopColor).toBe('rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Show Book Details' }).hover();
  expect(getComputedStyle(card).borderTopColor).toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({
    path: `../../../../../../.glossa-dev/qa/library-resume-${theme}-${width}-${rtl}-${eink}-${matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer'}.png`,
  });
  detail.focus();
  await userEvent.keyboard('{Enter}');
  expect(mocks.details).toHaveBeenCalledExactlyOnceWith(books[0]);
  expect(props.onOpenBook).not.toHaveBeenCalled();
  card.focus();
  expect(getComputedStyle(card).outlineStyle).toBe('solid');
  expect(getComputedStyle(card).outlineWidth).toBe('2px');
  await userEvent.keyboard('{Enter}');
  expect(props.onOpenBook).toHaveBeenCalledExactlyOnceWith(books[0]);
  rerender(<RecentShelf {...props} isSelectMode selectedBooks={new Set([books[0]!.hash])} />);
  expect(getComputedStyle(card).borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
});

it('keeps one settings entry at the sidebar bottom and restores the toolbar entry when needed', async () => {
  await page.viewport(1100, 780);
  document.documentElement.setAttribute('data-page', 'library');
  document.documentElement.setAttribute('data-theme', 'default-dark');
  render(<LibraryPreview />);
  let settings = screen.getByRole('button', { name: 'Settings' });
  expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(1);
  const nav = screen.getByRole('navigation', { name: 'Library' });
  expect(settings.closest('nav')).toBe(nav);
  expect(nav.getBoundingClientRect().bottom - settings.getBoundingClientRect().bottom).toBeCloseTo(
    22,
    0,
  );
  await userEvent.click(settings);
  await userEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
  settings = screen.getByRole('button', { name: 'Settings' });
  expect(settings.closest('.glossa-library-header')).toBeTruthy();
  await userEvent.click(settings);
  await userEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
  await page.viewport(320, 780);
  settings = screen.getByRole('button', { name: 'Settings' });
  expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(1);
  expect(settings.closest('.glossa-library-header')).toBeTruthy();
  expect(settings.getBoundingClientRect().right).toBeLessThanOrEqual(320);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  await page.screenshot({
    path: `../../../../../../.glossa-dev/qa/natural-library-narrow-${matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer'}.png`,
  });
  await userEvent.click(settings);
  expect(mocks.settings).toHaveBeenCalledTimes(3);
  expect(mocks.settings).toHaveBeenLastCalledWith('application');
});

it('keeps settings reachable with the keyboard in a short RTL e-ink window', async () => {
  await page.viewport(1000, 300);
  document.documentElement.setAttribute('data-page', 'library');
  document.documentElement.setAttribute('data-theme', 'default-light');
  document.documentElement.setAttribute('data-eink', 'true');
  document.documentElement.dir = 'rtl';
  const { container } = render(<LibraryPreview />);
  const settings = screen.getByRole('button', { name: 'Settings' });
  const categories = container.querySelector('.glossa-library-navigation-categories')!;
  await page.screenshot({
    path: `../../../../../../.glossa-dev/qa/natural-library-short-rtl-${matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer'}.png`,
  });
  expect(categories.scrollHeight).toBeGreaterThan(categories.clientHeight);
  expect(settings.getBoundingClientRect().bottom).toBeLessThanOrEqual(300);
  if (matchMedia('(pointer: coarse)').matches)
    expect(settings.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  screen.getByRole('button', { name: 'All Books' }).focus();
  await userEvent.keyboard('{Home}');
  expect(getComputedStyle(document.activeElement!).outlineOffset).toBe('-2px');
  await userEvent.keyboard('{End}');
  expect(document.activeElement).toBe(settings);
  await userEvent.keyboard('{Enter}');
  expect(mocks.settings).toHaveBeenCalledExactlyOnceWith('application');
});

it('keeps multiple book actions inside a small grid card', async () => {
  await page.viewport(320, 780);
  document.documentElement.setAttribute('data-page', 'library');
  document.documentElement.setAttribute('data-theme', 'default-dark');
  const { container } = render(
    <div className='glossa-book-card glossa-book-card-grid' style={{ width: 114 }}>
      <BookItem
        book={{ ...books[0]!, uploadedAt: 2, hasNarration: true }}
        mode='grid'
        coverFit='crop'
        isSelectMode={false}
        bookSelected={false}
        transferProgress={null}
        handleBookUpload={vi.fn()}
        handleBookDownload={vi.fn()}
        showBookDetailsModal={mocks.details}
        showTimeRemaining={false}
      />
    </div>,
  );
  const footer = container.querySelector('.glossa-book-status')!.getBoundingClientRect();
  for (const button of container.querySelectorAll('button')) {
    const bounds = button.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(footer.left);
    expect(bounds.right).toBeLessThanOrEqual(footer.right);
    if (matchMedia('(pointer: coarse)').matches) {
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
  }
});

it('keeps mixed fit covers aligned and changes columns with the content width', async () => {
  await page.viewport(1100, 780);
  document.body.classList.add('bg-base-100', 'text-base-content');
  const { container } = render(
    <div className='glossa-collection-grid grid' style={{ width: 1000 }}>
      {books.map((book) => (
        <div key={book.hash} className='glossa-book-card glossa-book-card-grid'>
          <BookItem
            book={book}
            mode='grid'
            coverFit='fit'
            isSelectMode={false}
            bookSelected={false}
            transferProgress={null}
            handleBookUpload={vi.fn()}
            handleBookDownload={vi.fn()}
            showBookDetailsModal={mocks.details}
            showTimeRemaining={false}
          />
        </div>
      ))}
      <div className='glossa-book-card glossa-book-card-grid'>
        <GroupItem
          mode='grid'
          group={{
            id: 'single',
            name: 'A long author name that should stop after two lines without pushing neighboring cards down',
            displayName:
              'A long author name that should stop after two lines without pushing neighboring cards down',
            books: [books[0]!],
            updatedAt: 1,
          }}
          isSelectMode={false}
          groupSelected={false}
        />
      </div>
      <div className='glossa-book-card glossa-book-card-grid'>
        <GroupItem
          mode='grid'
          group={{ id: 'pair', name: 'Pair', displayName: 'Pair', books, updatedAt: 1 }}
          isSelectMode={true}
          groupSelected={true}
        />
      </div>
    </div>,
  );
  const grid = container.firstElementChild as HTMLElement;
  await waitFor(() =>
    expect(container.querySelector('.bookitem-main')?.getAttribute('style')).toContain('0.45'),
  );
  const titles = [...container.querySelectorAll('.library-grid-item .glossa-book-title')];
  expect(titles[0]!.getBoundingClientRect().top).toBeCloseTo(
    titles[1]!.getBoundingClientRect().top,
    0,
  );
  const count = () => getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const wideColumns = count();
  expect(wideColumns).toBeGreaterThanOrEqual(5);
  const single = container.querySelectorAll('.glossa-group-stack')[0]!;
  expect(single.children).toHaveLength(1);
  expect(single.firstElementChild!.getBoundingClientRect().width).toBeCloseTo(
    single.getBoundingClientRect().width,
    0,
  );
  expect(container.querySelectorAll('.glossa-group-stack')[1]!.children).toHaveLength(2);
  for (const width of [460, 320]) {
    grid.style.width = `${width}px`;
    await waitFor(() => expect(count()).toBeLessThan(wideColumns));
    expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth);
  }
  grid.style.width = '1000px';
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/library-fit-stack-${theme}.png`,
    });
  }
});
