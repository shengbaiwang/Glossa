import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import BookItem from '@/app/library/components/BookItem';
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
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
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
    settings: { libraryGroupBy: 'none' },
    openSettingsDialog: mocks.settings,
  }),
}));
vi.mock('@/components/BookCover', () => ({
  default: ({ book }: { book: Book }) => (
    <div
      className='flex h-full w-full items-center justify-center p-4 text-center'
      style={{ background: book.hash === 'long' ? '#64736b' : '#c4b9a3', color: '#fff' }}
    >
      {book.title}
    </div>
  ),
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
    if (!svg) continue;
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

it('keeps authors close to their titles while aligning covers and footers', async () => {
  await page.viewport(1100, 780);
  document.documentElement.setAttribute('data-page', 'library');
  const { container } = render(<LibraryPreview />);
  const cards = Array.from(container.querySelectorAll('.library-grid-item'));
  const bounds = (card: Element, selector: string) =>
    card.querySelector(selector)!.getBoundingClientRect();
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    for (const card of cards) {
      const title = bounds(card, '.glossa-book-title');
      const author = bounds(card, '.glossa-book-author');
      expect(author.top - title.bottom).toBeCloseTo(4, 0);
      const footer = bounds(card, '.glossa-book-status');
      const detail = bounds(card, '.glossa-book-detail-button');
      expect(detail.right).toBeCloseTo(footer.right, 0);
      if (matchMedia('(pointer: coarse)').matches) {
        expect(detail.width).toBeGreaterThanOrEqual(44);
        expect(detail.height).toBeGreaterThanOrEqual(44);
      }
    }
    expect(bounds(cards[0]!, '.glossa-book-author').top).toBeGreaterThan(
      bounds(cards[1]!, '.glossa-book-author').top + 10,
    );
    for (const selector of ['.bookitem-main', '.glossa-book-status']) {
      expect(bounds(cards[0]!, selector).bottom).toBeCloseTo(bounds(cards[1]!, selector).bottom, 0);
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
