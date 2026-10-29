import type { CSSProperties } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import ViewMenu from '@/app/library/components/ViewMenu';
import BookItem from '@/app/library/components/BookItem';
import GroupItem from '@/app/library/components/GroupItem';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
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
const language = vi.hoisted(() => ({ chinese: false }));
vi.mock('@/hooks/useTranslation', async () => {
  const zh = await fetch('/locales/zh-CN/translation.json').then((response) => response.json());
  return {
    useTranslation: () => (key: string) =>
      language.chinese ? ((zh as Record<string, string>)[key] ?? key) : key,
  };
});
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
  progress: [1, 4],
};

beforeEach(() => {
  language.chinese = false;
  useSettingsStore.setState({
    settings: {
      libraryViewMode: 'grid',
      libraryListScale: 100,
      libraryAutoColumns: true,
      libraryColumns: 6,
      libraryCoverFit: 'crop',
      libraryRecentShelfEnabled: true,
      libraryGroupBy: 'none',
      librarySortBy: 'title',
      librarySortAscending: true,
    } as SystemSettings,
  });
});

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
    const row = screen.getByRole('group', { name: 'Cover Size' });
    const slider = within(row).getByRole('slider');
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(110);
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch) {
      expect(slider.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(slider.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      for (const toggle of container.querySelectorAll('.glossa-library-display-toggle')) {
        expect(toggle.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    const menu = container.querySelector('.view-menu')!;
    expect(menu.getBoundingClientRect().height).toBeLessThan(touch ? 470 : 430);
    const covers = screen.getByRole('group', { name: 'Cover display' });
    const crop = within(covers).getByRole('button', { name: 'Fill cover', pressed: true });
    const fit = within(covers).getByRole('button', { name: 'Show full cover', pressed: false });
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
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, libraryViewMode: 'list' },
  });
  const view = render(<SizePreview />);
  const cover = view.container.querySelector('.bookitem-main')!;
  const group = view.container.querySelector('.groupitem-main')!;
  const initial = cover.getBoundingClientRect().height;
  const initialGroup = group.getBoundingClientRect().height;
  const slider = screen.getByRole('slider', { name: 'List Size' });
  slider.focus();
  await userEvent.keyboard('{ArrowRight}');
  await waitFor(() => expect(cover.getBoundingClientRect().height).toBeGreaterThan(initial));
  expect(group.getBoundingClientRect().height).toBeGreaterThan(initialGroup);
  expect((screen.getByRole('slider', { name: 'List Size' }) as HTMLInputElement).value).toBe('110');
  cleanup();
  render(<SizePreview />);
  expect((screen.getByRole('slider', { name: 'List Size' }) as HTMLInputElement).value).toBe('110');
});

it('opens sorting with the keyboard and bounds expanded content in a short window', async () => {
  await page.viewport(320, 560);
  document.documentElement.setAttribute('data-page', 'library');
  document.documentElement.setAttribute('data-theme', 'default-light');
  const { container } = render(<SizePreview />);
  const sort = screen.getByRole('button', { name: 'Sort' });
  expect(sort.getAttribute('aria-expanded')).toBe('false');
  sort.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(sort.getAttribute('aria-expanded')).toBe('true'));
  expect(
    within(sort.closest('details')!).getByRole('combobox', { name: 'Primary sort' }),
  ).toBeTruthy();
  const menu = container.querySelector('.view-menu')!;
  expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(560);
  expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
  expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(sort.getAttribute('aria-expanded')).toBe('false'));
});

it('applies book information to list and recent-style cards and retains it after reopening', async () => {
  await page.viewport(390, 844);
  const view = render(<SizePreview />);
  await page.getByRole('button', { name: 'Card information' }).click();
  await page.getByRole('checkbox', { name: /^Author$/ }).click();
  await waitFor(() =>
    expect(view.container.querySelector('.book-item .glossa-book-author')).toBeNull(),
  );
  expect(screen.getByText(book.title)).toBeTruthy();
  await page.getByRole('checkbox', { name: 'Reading Progress' }).click();
  await waitFor(() => expect(screen.queryByText('25%')).toBeNull());
  cleanup();
  render(<SizePreview />);
  expect(document.querySelector('.book-item .glossa-book-author')).toBeNull();
  await page.getByRole('button', { name: 'Card information' }).click();
  expect((screen.getByRole('checkbox', { name: /^Author$/ }) as HTMLInputElement).checked).toBe(
    false,
  );
});

it('previews the compact Chinese menu with the actual translations', async () => {
  language.chinese = true;
  await page.viewport(600, 660);
  document.documentElement.setAttribute('data-page', 'library');
  document.documentElement.setAttribute('data-theme', 'default-dark');
  const view = render(<SizePreview />);
  expect(screen.getByRole('button', { name: '完整' })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: '立体封面' })).toBeNull();
  expect(screen.getByRole('button', { name: '卡片信息' })).toBeTruthy();
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/display-menu-zh-dark.png' });
  const menu = view.container.querySelector('.view-menu')!;
  expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
});

it('opens native sort controls from the chevron and the full trailing edge in either direction', async () => {
  await page.viewport(600, 800);
  for (const dir of ['ltr', 'rtl']) {
    document.documentElement.dir = dir;
    render(<SizePreview />);
    await userEvent.click(screen.getByRole('button', { name: 'Sort' }));
    for (const name of ['Primary sort', 'Secondary sort']) {
      const select = screen.getByRole('combobox', { name }) as HTMLSelectElement;
      const wrapper = select.parentElement!;
      wrapper.scrollIntoView({ block: 'nearest' });
      const rect = wrapper.getBoundingClientRect();
      const trailingX = dir === 'rtl' ? 3 : rect.width - 3;
      expect(document.elementFromPoint(rect.left + trailingX, rect.top + rect.height / 2)).toBe(
        select,
      );
      const click = vi.fn();
      select.addEventListener('click', click);
      await userEvent.click(wrapper, { position: { x: trailingX, y: rect.height / 2 } });
      expect(click).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(select);
      await userEvent.keyboard('{Escape}');
      select.removeEventListener('click', click);
    }
    cleanup();
  }
});
