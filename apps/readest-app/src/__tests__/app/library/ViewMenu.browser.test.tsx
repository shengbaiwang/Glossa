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
      <ViewMenu onSelectBooks={vi.fn()} />
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

it('keeps both controls on their view rows in light, dark, narrow RTL and e-ink', async () => {
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
    for (const name of ['List', 'Grid']) {
      const row = screen.getByRole('group', { name });
      const choice = within(row).getByRole('menuitemcheckbox', { name: new RegExp(`^${name} -`) });
      const plus = within(row).getByRole('button', { name: 'Increase' });
      const rowRect = row.getBoundingClientRect();
      const choiceRect = choice.getBoundingClientRect();
      const plusRect = plus.getBoundingClientRect();
      expect(rowRect.height).toBeLessThanOrEqual(48);
      if (matchMedia('(pointer: coarse)').matches) {
        expect(plusRect.width).toBeGreaterThanOrEqual(44);
        expect(plusRect.height).toBeGreaterThanOrEqual(44);
      }
      expect(
        Math.abs(plusRect.top + plusRect.height / 2 - choiceRect.top - choiceRect.height / 2),
      ).toBeLessThan(1);
      expect(
        dir === 'ltr' ? plusRect.left >= choiceRect.right : plusRect.right <= choiceRect.left,
      ).toBe(true);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    const menu = container.querySelector('.view-menu')!;
    const touch = matchMedia('(pointer: coarse)').matches;
    expect(menu.getBoundingClientRect().height).toBeLessThan(touch ? 440 : 400);
    const covers = screen.getByRole('group', { name: 'Book Covers' });
    const crop = within(covers).getByRole('menuitemcheckbox', { name: 'Crop - ON' });
    const fit = within(covers).getByRole('menuitemcheckbox', { name: 'Fit - OFF' });
    expect(crop.getBoundingClientRect().top).toBe(fit.getBoundingClientRect().top);
    expect(crop.getBoundingClientRect().height).toBeGreaterThanOrEqual(touch ? 44 : 36);
    expect(screen.queryByRole('button', { name: 'Group by...' })).toBeNull();
    crop.focus();
    expect(getComputedStyle(crop).outlineStyle).toBe('none');
    expect(getComputedStyle(crop).textDecorationLine).toBe('underline');
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/view-menu-${touch ? 'touch' : 'pointer'}-${width}-${theme}-${dir}.png`,
    });
    expect(container.querySelectorAll('.glossa-library-view-row')).toHaveLength(2);
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
  const plus = within(screen.getByRole('group', { name: 'List' })).getByRole('button', {
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
  const sort = screen.getByRole('button', { name: 'Sort by...' });
  expect(sort.getAttribute('aria-expanded')).toBe('false');
  sort.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(sort.getAttribute('aria-expanded')).toBe('true'));
  expect(
    within(sort.closest('details')!).getByRole('menuitemcheckbox', { name: 'Date Read - OFF' }),
  ).toBeTruthy();
  const menu = container.querySelector('.view-menu')!;
  expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(560);
  expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
  expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(sort.getAttribute('aria-expanded')).toBe('false'));
});
