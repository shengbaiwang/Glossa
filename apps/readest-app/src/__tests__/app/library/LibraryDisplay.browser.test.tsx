import { useLibraryRefresh } from '@/hooks/useLibraryRefresh';
import { notifyLibraryUpdated } from '@/utils/libraryEvents';
import { useReducer } from 'react';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import Bookshelf from '@/app/library/components/Bookshelf';
import ViewMenu from '@/app/library/components/ViewMenu';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { LibraryGroupByType, SystemSettings } from '@/types/settings';
import { Book } from '@/types/book';
import { md5Fingerprint } from '@/utils/md5';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';
import '@/styles/glossa-desktop.css';

const mocks = vi.hoisted(() => ({
  search: 'groupBy=group',
  navigate: (_query: string) => {},
  saveSettings: vi.fn(),
  saveLibraryBooks: vi.fn(),
  openBook: vi.fn(),
  importBooks: vi.fn(),
  router: {},
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: (_router: unknown, query: string) => mocks.navigate(query),
  navigateToReader: vi.fn(),
  showReaderWindow: vi.fn(),
  navigateToLogin: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => {
  const appService = { ...mocks, hasContextMenu: true, isLinuxApp: true };
  return {
    useEnv: () => ({
      envConfig: { getAppService: async () => appService },
      appService,
    }),
  };
});
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
}));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/app/library/hooks/useOpenBook', () => ({
  useOpenBook: () => ({ openBook: mocks.openBook }),
}));
vi.mock('@/app/library/components/LibrarySearchResults', () => ({ default: () => null }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: mocks.insets }),
}));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));

// The native WebDriver's resize command can hang; keep its actual window.
// Chromium covers fixed/narrow viewport geometry independently.
const displayViewport = async () => {
  if (!('__TAURI_INTERNALS__' in window)) await page.viewport(1100, 780);
};
const noop = () => {};
const transfer = async () => true;
const original: Book = {
  hash: 'a'.repeat(32),
  title: '原创测试书籍',
  author: '测试作者',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};

function Shelf({ direct = false } = {}) {
  const [, update] = useReducer((n) => n + 1, 0);
  if (!direct)
    mocks.navigate = (query) => {
      mocks.search = query;
      window.history.replaceState(null, '', `?${query}`);
      update();
    };
  const { library } = useLibraryStore();
  const current = useSettingsStore
    .getState()
    .settings.libraryFolders?.find(
      (path) => md5Fingerprint(path) === new URLSearchParams(mocks.search).get('group'),
    );
  return (
    <div
      className='full-height flex flex-col'
      style={{ width: '100%', maxWidth: 1100, margin: 'auto' }}
    >
      <Bookshelf
        renderGroupNavigation={
          current
            ? (openMenu) => (
                <div className='glossa-shelf-breadcrumbs'>
                  <button
                    type='button'
                    className='glossa-folder-heading-action'
                    aria-current='location'
                    aria-haspopup='menu'
                    onClick={(event) => openMenu(event.currentTarget)}
                  >
                    {current}
                  </button>
                </div>
              )
            : undefined
        }
        libraryBooks={library}
        onScrollerRef={noop}
        handleImportBooks={mocks.importBooks}
        handleBookUpload={transfer}
        handleBookDownload={transfer}
        handleBookDelete={transfer}
        handleBookPurge={transfer}
        handleShowDetailsBook={noop}
        handleLibraryNavigation={(group) => {
          const params = new URLSearchParams(mocks.search);
          params.set('group', group);
          mocks.navigate(params.toString());
        }}
        booksTransferProgress={{}}
        contentSearch={null}
        handlePushLibrary={async () => {}}
        onSearchContents={noop}
      />
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search = 'groupBy=group';
  mocks.saveSettings.mockResolvedValue(undefined);
  mocks.saveLibraryBooks.mockResolvedValue(undefined);
  window.history.replaceState(null, '', '?groupBy=group');
  document.documentElement.setAttribute('data-page', 'library');
  document.documentElement.setAttribute('data-theme', 'default-light');
  useSettingsStore.getState().setSettings({
    ...DEFAULT_SYSTEM_SETTINGS,
    libraryGroupBy: LibraryGroupByType.None,
    libraryFolders: [],
    libraryRecentShelfEnabled: false,
  } as SystemSettings);
  useLibraryStore.setState({ libraryLoaded: true });
  useLibraryStore.getState().setLibrary([]);
});
afterEach(() => {
  cleanup();
  for (const attr of ['data-page', 'data-theme', 'dir', 'data-eink'])
    document.documentElement.removeAttribute(attr);
});

function setupDisplay(extra: Partial<SystemSettings> = {}, search = 'groupBy=none') {
  mocks.search = search;
  window.history.replaceState(null, '', `?${search}`);
  useSettingsStore.getState().setSettings({
    ...useSettingsStore.getState().settings,
    libraryAutoColumns: false,
    libraryCoverWidth: 188,
    ...extra,
  });
  useLibraryStore.getState().setLibrary(
    Array.from({ length: 8 }, (_, i) => ({
      ...original,
      hash: String(i).padStart(32, '0'),
      title: `Original ${i}`,
      author: `Author ${7 - i}`,
      createdAt: i + 1,
      updatedAt: i + 1,
      ...(i === 7 ? { progress: [1, 4] as [number, number] } : {}),
      coverImageUrl:
        'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#c6b797"/><text x="20" y="100">Original test</text></svg>',
        ),
    })),
  );
  return render(
    <>
      <div style={{ position: 'absolute', top: 0, right: 0, zIndex: 20 }}>
        <ViewMenu />
      </div>
      <Shelf />
    </>,
  );
}

it('every small slider step should visibly change cover width', async () => {
  await displayViewport();
  const view = setupDisplay();
  const grid = await waitFor(() => {
    const e = view.container.querySelector<HTMLElement>('.glossa-collection-grid');
    expect(e).toBeTruthy();
    return e!;
  });
  // Wait for the virtual grid's first measured item before interacting.
  await waitFor(() =>
    expect(grid.firstElementChild?.getBoundingClientRect().width ?? 0).toBeGreaterThan(0),
  );
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const widths: number[] = [];
  for (const value of [188, 192, 196, 200, 204, 208, 212, 216, 220]) {
    fireEvent.change(screen.getByRole('slider', { name: 'Cover Size' }), {
      target: { value: String(value) },
    });
    await waitFor(() => expect(useSettingsStore.getState().settings.libraryCoverWidth).toBe(value));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    widths.push(parseFloat(getComputedStyle(grid).gridTemplateColumns));
  }
  expect(new Set(widths).size).toBe(widths.length);
});

it('uses the same available width for actual grid columns and virtual rows near a wrap boundary', async () => {
  await displayViewport();
  const view = setupDisplay();
  const native = '__TAURI_INTERNALS__' in window;
  await waitFor(() =>
    expect(
      view.container
        .querySelector('.glossa-library-grid-scroller')
        ?.hasAttribute('data-overlayscrollbars-viewport'),
    ).toBe(true),
  );
  for (const width of native ? [300, 414] : [414, 700, 1100, 414]) {
    view.container.querySelector<HTMLElement>('.full-height')!.style.width = `${width}px`;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await waitFor(() => {
      const grid = view.container.querySelector<HTMLElement>('.glossa-collection-grid')!;
      const item = grid?.firstElementChild;
      expect(item?.getBoundingClientRect().width ?? 0).toBeCloseTo(188, 0);
      const style = getComputedStyle(grid);
      const columns = style.gridTemplateColumns.split(' ').length;
      const gap = parseFloat(style.columnGap);
      const itemWidth = item!.getBoundingClientRect().width;
      const viewportWidth = grid.parentElement!.getBoundingClientRect().width;
      expect(columns).toBe(Math.max(1, Math.floor((viewportWidth + gap) / (itemWidth + gap))));
      const scroller = view.container.querySelector<HTMLElement>('.glossa-library-grid-scroller')!;
      expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
    });
  }
  const scroller = view.container.querySelector<HTMLElement>('.glossa-library-grid-scroller')!;
  scroller.scrollTop = scroller.scrollHeight;
  await waitFor(() => {
    const last = view.container.querySelector<HTMLElement>('[data-index="7"]');
    expect(last).toBeTruthy();
    expect(last!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      scroller.getBoundingClientRect().bottom,
    );
  });
});

it('live covers, author and progress consume toggles', async () => {
  await displayViewport();
  const view = setupDisplay();
  const cover = await waitFor(() => {
    const e = view.container.querySelector<HTMLElement>('.book-cover-container');
    expect(e).toBeTruthy();
    return e!;
  });
  expect(screen.queryByRole('checkbox', { name: '3D covers' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show full cover' }));
  await waitFor(() => expect(cover.dataset['fit']).toBe('fit'));
  const image = cover.querySelector('img')!;
  await waitFor(() => expect(image.naturalWidth / image.naturalHeight).toBeCloseTo(1));
  const face = cover.querySelector('.book-cover-surface')!;
  await waitFor(() =>
    expect(
      Math.abs(face.getBoundingClientRect().width - face.getBoundingClientRect().height),
    ).toBeLessThan(2),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Card information' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Author' }));
  await waitFor(() => expect(view.container.querySelector('.glossa-book-author')).toBeNull());
  expect(view.container.textContent).toContain('25%');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Reading Progress' }));
  await waitFor(() => expect(view.container.textContent).not.toContain('25%'));
});

it('layout and list sizing update shelf', async () => {
  await displayViewport();
  const view = setupDisplay();
  fireEvent.click(screen.getByRole('button', { name: 'List' }));
  const list = await waitFor(() => {
    const e = view.container.querySelector('.glossa-collection-list');
    expect(e).toBeTruthy();
    return e!;
  });
  const first = await waitFor(() => {
    const e = list.querySelector('.bookitem-main');
    expect(e).toBeTruthy();
    return e!;
  });
  const before = first.getBoundingClientRect().height;
  fireEvent.change(screen.getByRole('slider', { name: 'List Size' }), { target: { value: '140' } });
  await waitFor(() =>
    expect(list.querySelector('.bookitem-main')!.getBoundingClientRect().height).toBeGreaterThan(
      before * 1.3,
    ),
  );
});

it('recent reading appears only with eligible books', async () => {
  await displayViewport();
  setupDisplay();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Recent reading' }));
  await waitFor(() => expect(screen.getByText('Continue reading')).toBeTruthy());
  useLibraryStore
    .getState()
    .setLibrary(useLibraryStore.getState().library.map((b) => ({ ...b, progress: undefined })));
  await waitFor(() => expect(screen.queryByText('Continue reading')).toBeNull());
});

it('URL cover and sorting overrides must match selected menu values', async () => {
  await displayViewport();
  const view = setupDisplay(
    {
      libraryCoverFit: 'crop',
      librarySortAscending: true,
      librarySortBy: 'title' as SystemSettings['librarySortBy'],
    },
    'groupBy=none&cover=fit&sort=author&order=desc',
  );
  await waitFor(() =>
    expect(view.container.querySelector<HTMLElement>('.book-cover-container')?.dataset['fit']).toBe(
      'fit',
    ),
  );
  expect(screen.getByRole('button', { name: 'Show full cover' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});

it('actual helper must retry failed save for the same value', async () => {
  const { saveSysSettings } = await import('@/helpers/settings');
  const env = { getAppService: async () => ({ saveSettings: mocks.saveSettings }) } as never;
  mocks.saveSettings.mockRejectedValueOnce(new Error('diagnostic disk failure'));
  await expect(saveSysSettings(env, 'libraryCoverWidth', 220)).rejects.toThrow();
  mocks.saveSettings.mockResolvedValue(undefined);
  await saveSysSettings(env, 'libraryCoverWidth', 220);
  expect(mocks.saveSettings).toHaveBeenCalledTimes(2);
});

it('removes automatic sizing and previews manual width without awaiting disk', async () => {
  await displayViewport();
  const view = setupDisplay({ libraryAutoColumns: true });
  await waitFor(() => expect(view.container.querySelector('.bookitem-main')).toBeTruthy());
  let release!: () => void;
  mocks.saveSettings.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  fireEvent.change(screen.getByRole('slider', { name: 'Cover Size' }), {
    target: { value: '260' },
  });
  await waitFor(() => expect(useSettingsStore.getState().settings.libraryCoverWidth).toBe(260));
  try {
    expect((screen.getByRole('slider', { name: 'Cover Size' }) as HTMLInputElement).value).toBe(
      '260',
    );
    expect(useSettingsStore.getState().settings.libraryAutoColumns).toBe(false);
  } finally {
    release();
  }
});

it('choosing explicit no secondary sort in author view must disable it', async () => {
  const view = setupDisplay(
    { libraryGroupBy: LibraryGroupByType.Author, libraryThenSortBy: 'none' },
    'groupBy=author',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Sort' }));
  const secondary = screen.getByRole('combobox', { name: 'Secondary sort' });
  if ('__TAURI_INTERNALS__' in window) {
    // The native WebDriver only clicks <option>; even a plain select receives no
    // input/change events. Exercise React's change contract here; Chromium below
    // keeps the real select operation. Native popup interaction remains unverified.
    fireEvent.change(secondary, { target: { value: 'none' } });
  } else {
    await userEvent.selectOptions(secondary, 'none');
  }
  await waitFor(() => expect((secondary as HTMLSelectElement).value).toBe('none'));
  await waitFor(() =>
    expect(useSettingsStore.getState().settings.libraryThenSortByAuto).toBe(false),
  );
  view.unmount();
  mocks.search = 'groupBy=author';
  window.history.replaceState(null, '', '?groupBy=author');
  render(<ViewMenu />);
  await userEvent.click(screen.getByRole('button', { name: 'Sort' }));
  expect(
    (screen.getByRole('combobox', { name: 'Secondary sort' }) as HTMLSelectElement).value,
  ).toBe('none');
});

it('sort arrow should reverse actual URL order on first click', async () => {
  await displayViewport();
  const view = setupDisplay(
    { librarySortAscending: false, librarySortBy: 'title' as SystemSettings['librarySortBy'] },
    'groupBy=none&sort=author&order=asc',
  );
  const titles = () =>
    view.container.querySelector('.glossa-collection-grid .glossa-book-title')?.textContent;
  await waitFor(() => expect(titles()).toContain('Original 7'));
  const before = titles();
  await userEvent.click(screen.getByRole('button', { name: 'Sort' }));
  await userEvent.click(screen.getByRole('button', { name: 'Primary sort / Ascending' }));
  await waitFor(() =>
    expect(useSettingsStore.getState().settings.librarySortAscending).toBe(false),
  );
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  expect(titles()).not.toBe(before);
});

it('offers only manual cover sizing even for an old automatic preference', () => {
  setupDisplay({ libraryAutoColumns: true });
  expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull();
});

it('refreshes recently-read books through the persisted-update channel without closing a reader', async () => {
  const view = setupDisplay({ libraryRecentShelfEnabled: true });
  const books = useLibraryStore
    .getState()
    .library.map((book) => ({ ...book, progress: undefined }));
  useLibraryStore.getState().setLibrary(books);
  await waitFor(() => expect(view.container.querySelector('.glossa-recent-shelf')).toBeNull());
  const loadLibraryBooks = vi
    .fn()
    .mockResolvedValue([{ ...books[0], progress: [1, 4], updatedAt: 50 }, ...books.slice(1)]);
  renderHook(() => useLibraryRefresh({ loadLibraryBooks }));
  notifyLibraryUpdated();
  await waitFor(() => expect(view.container.querySelector('.glossa-recent-shelf')).toBeTruthy());
  expect(loadLibraryBooks).toHaveBeenCalledOnce();
});
it('keeps a failed menu edit available for retry', async () => {
  setupDisplay();
  mocks.saveSettings.mockRejectedValueOnce(new Error('controlled disk failure'));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Recent reading' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Failed to save settings');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(useSettingsStore.getState().settings.libraryRecentShelfEnabled).toBe(true);
});
