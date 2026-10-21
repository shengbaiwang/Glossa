import type { CSSProperties } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import ViewMenu from '@/app/library/components/ViewMenu';
import BookItem from '@/app/library/components/BookItem';
import GroupItem from '@/app/library/components/GroupItem';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';
import '@/styles/glossa-desktop.css';

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/utils/nav', () => ({ navigateToLibrary: vi.fn(), navigateToLogin: vi.fn() }));
vi.mock('@/store/settingsStore', async () => {
  const { create } = await import('zustand');
  return {
    useSettingsStore: create(() => ({
      settings: {
        libraryViewMode: 'list',
        libraryListScale: 100,
        libraryAutoColumns: true,
        libraryColumns: 6,
        libraryCoverFit: 'crop',
        libraryRecentShelfEnabled: true,
        librarySkeuomorphicCovers: false,
        libraryGroupBy: 'none',
        librarySortBy: 'title',
        librarySortAscending: true,
      },
    })),
  };
});
vi.mock('@/helpers/settings', async () => {
  const { useSettingsStore: store } = await import('@/store/settingsStore');
  return {
    saveSysSettings: async (_env: unknown, key: string, value: unknown) => {
      store.setState({ settings: { ...store.getState().settings, [key]: value } });
    },
  };
});
vi.mock('@/components/BookCover', () => ({
  default: () => <div className='h-full w-full bg-base-300' />,
}));

const book: Book = {
  hash: 'sample',
  title: '微雨从东来',
  author: 'Test Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => {
  cleanup();
  for (const attr of ['dir', 'data-theme', 'data-eink', 'data-page'])
    document.documentElement.removeAttribute(attr);
});

function SizePreview() {
  const { settings } = useSettingsStore();
  return (
    <div style={{ padding: 12, maxWidth: 360 }}>
      <ViewMenu />
      <div
        className='glossa-collection-list'
        style={
          {
            '--glossa-list-scale': (settings.libraryListScale ?? 100) / 100,
            marginTop: 16,
          } as CSSProperties
        }
      >
        <div className='glossa-book-card-list'>
          <BookItem
            book={book}
            mode='list'
            coverFit='crop'
            isSelectMode={false}
            bookSelected={false}
            transferProgress={null}
            handleBookUpload={vi.fn()}
            handleBookDownload={vi.fn()}
            showBookDetailsModal={vi.fn()}
            showTimeRemaining={false}
          />
        </div>
        <GroupItem
          mode='list'
          group={{
            id: 'group',
            name: 'Sample',
            displayName: 'Sample',
            books: [book],
            updatedAt: 1,
          }}
          isSelectMode={false}
          groupSelected={false}
        />
      </div>
    </div>
  );
}

it('keeps active sizing and cover choices aligned in light, dark, narrow RTL and e-ink', async () => {
  for (const [width, theme, dir, eink] of [
    [1100, 'default-light', 'ltr', false],
    [1100, 'default-dark', 'ltr', false],
    [320, 'default-dark', 'ltr', false],
    [390, 'default-light', 'rtl', true],
  ] as const) {
    await page.viewport(width, 844);
    document.documentElement.setAttribute('data-page', 'library');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.dir = dir;
    document.documentElement.setAttribute('data-eink', String(eink));
    const { container } = render(<SizePreview />);
    const row = screen.getByRole('group', { name: 'List Size' });
    const plus = within(row).getByRole('button', { name: 'Increase' });
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(48);
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch) {
      expect(plus.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(plus.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    const menu = container.querySelector('.view-menu')!;
    expect(menu.getBoundingClientRect().height).toBeLessThan(touch ? 470 : 430);
    const covers = screen.getByRole('group', { name: 'Book Covers' });
    const crop = within(covers).getByRole('button', { name: 'Crop', pressed: true });
    const fit = within(covers).getByRole('button', { name: 'Fit', pressed: false });
    expect(crop.getBoundingClientRect().top).toBe(fit.getBoundingClientRect().top);
    expect(crop.getBoundingClientRect().height).toBeGreaterThanOrEqual(touch ? 44 : 36);
    expect(screen.queryByRole('menuitem', { name: 'Select Books' })).toBeNull();
    crop.focus();
    expect(getComputedStyle(crop).outlineStyle).toBe('none');
    expect(getComputedStyle(crop).textDecorationLine).toBe('underline');
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/view-menu-${touch ? 'touch' : 'pointer'}-${width}-${theme}-${dir}.png`,
    });
    expect(container.querySelectorAll('.glossa-library-size-controls')).toHaveLength(1);
    cleanup();
  }
});

it('sizes book and group covers immediately with the keyboard and retains size after reopening', async () => {
  await page.viewport(1100, 844);
  const view = render(<SizePreview />);
  const cover = view.container.querySelector('.bookitem-main')!;
  const group = view.container.querySelector('.groupitem-main .library-list-item')!;
  const initial = cover.getBoundingClientRect().height;
  const initialGroup = group.getBoundingClientRect().height;
  const plus = within(screen.getByRole('group', { name: 'List Size' })).getByRole('button', {
    name: 'Increase',
  });
  plus.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(cover.getBoundingClientRect().height).toBeGreaterThan(initial));
  expect(group.getBoundingClientRect().height).toBeGreaterThan(initialGroup);
  expect(screen.getByText('110%')).toBeTruthy();
  cleanup();
  render(<SizePreview />);
  expect(screen.getByText('110%')).toBeTruthy();
});

it('opens sorting with the keyboard and bounds expanded content in a short window', async () => {
  await page.viewport(320, 560);
  document.documentElement.setAttribute('data-page', 'library');
  document.documentElement.setAttribute('data-theme', 'default-light');
  const { container } = render(<SizePreview />);
  const sort = screen.getByRole('button', { name: 'Sort by' });
  expect(sort.getAttribute('aria-expanded')).toBe('false');
  sort.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(sort.getAttribute('aria-expanded')).toBe('true'));
  expect(within(sort.closest('details')!).getByRole('combobox', { name: 'Sort by' })).toBeTruthy();
  const menu = container.querySelector('.view-menu')!;
  expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(560);
  expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
  expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(sort.getAttribute('aria-expanded')).toBe('false'));
});
