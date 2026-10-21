import { useReducer, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent, commands } from 'vitest/browser';
import Bookshelf from '@/app/library/components/Bookshelf';
import GroupingModal from '@/app/library/components/GroupingModal';
import LibraryNavigation from '@/app/library/components/LibraryNavigation';
import { useDragDropImport } from '@/app/library/hooks/useDragDropImport';
import { eventDispatcher } from '@/utils/event';
import { generateBookshelfItems } from '@/app/library/components/BookshelfItem';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { LibraryGroupByType, SystemSettings } from '@/types/settings';
import { Book, BooksGroup } from '@/types/book';
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
      envConfig: {},
      appService,
    }),
  };
});
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => false,
}));
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
vi.mock('@/components/BookCover', () => ({
  default: () => <div className='h-full w-full' style={{ background: '#b8b09a' }} />,
}));

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
  const [selecting, setSelecting] = useState(false);
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
        isSelectMode={selecting}
        isSelectAll={false}
        isSelectNone={false}
        onScrollerRef={noop}
        handleImportBooks={mocks.importBooks}
        handleBookUpload={transfer}
        handleBookDownload={transfer}
        handleBookDelete={transfer}
        handleBookPurge={transfer}
        handleSetSelectMode={setSelecting}
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

function DirectShelf() {
  const [, update] = useReducer((n) => n + 1, 0);
  useDragDropImport();
  mocks.navigate = (query) => {
    mocks.search = query;
    window.history.replaceState(null, '', `?${query}`);
    update();
  };
  return (
    <div className='library-page full-height flex flex-col'>
      <div className='glossa-library-workspace'>
        <LibraryNavigation onNavigate={noop} />
        <main className='glossa-library-content'>
          <Shelf direct />
        </main>
      </div>
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
  useLibraryStore.getState().setLibrary([]);
});
afterEach(() => {
  cleanup();
  for (const attr of ['data-page', 'data-theme', 'dir', 'data-eink'])
    document.documentElement.removeAttribute(attr);
});

it.each([
  'grid',
  'list',
] as const)('marquee-selects books in %s, moves the complete selection and supports undo', async (view) => {
  await page.viewport(1100, 780);
  mocks.search = 'groupBy=none';
  window.history.replaceState(null, '', '?groupBy=none');
  useSettingsStore.getState().setSettings({
    ...useSettingsStore.getState().settings,
    libraryFolders: ['研究'],
    libraryViewMode: view,
  });
  useLibraryStore
    .getState()
    .setLibrary([original, { ...original, hash: 'b'.repeat(32), title: '另一部原创书籍' }]);
  render(<DirectShelf />);
  const first = await screen.findByRole('button', { name: original.title });
  const second = await screen.findByRole('button', { name: '另一部原创书籍' });
  const a = first.getBoundingClientRect(),
    b = second.getBoundingClientRect();
  await commands.dragPDFText(
    { x: Math.min(a.left, b.left) - 8, y: Math.min(a.top, b.top) - 8 },
    { x: Math.max(a.right, b.right) + 8, y: Math.max(a.bottom, b.bottom) + 8 },
  );
  await waitFor(() =>
    expect(useLibraryStore.getState().getSelectedBooks().sort()).toEqual([
      original.hash,
      'b'.repeat(32),
    ]),
  );
  expect(mocks.openBook).not.toHaveBeenCalled();
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/library-marquee-${view}-${theme}.png`,
    });
  }
  const folder = page.getByRole('navigation').getByRole('button', { name: '研究', exact: true });
  await page.getByRole('button', { name: original.title, exact: true }).dropTo(folder);
  await waitFor(() =>
    expect(useLibraryStore.getState().library.every((book) => book.groupName === '研究')).toBe(
      true,
    ),
  );
  expect(mocks.saveLibraryBooks.mock.calls.at(-1)![0]).toHaveLength(2);
  await userEvent.click(folder, { button: 'right' });
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Undo' }));
  await waitFor(() =>
    expect(useLibraryStore.getState().library.every((book) => !book.groupName)).toBe(true),
  );
});

async function pointerMove(
  from: string,
  to: string,
  edge: 'inside' | 'before' | 'after' = 'inside',
) {
  const nav = screen.getByRole('navigation');
  const source = [...nav.querySelectorAll<HTMLButtonElement>('[data-folder-drop]')].find(
    (b) => b.getAttribute('aria-label') === from,
  )!;
  const target = [...nav.querySelectorAll<HTMLButtonElement>('[data-folder-drop]')].find(
    (b) => b.getAttribute('aria-label') === to,
  )!;
  const a = source.getBoundingClientRect(),
    b = target.getBoundingClientRect();
  const x = a.left + a.width / 2,
    y = a.top + a.height / 2;
  const tx = b.left + b.width / 2,
    ty = b.top + b.height * (edge === 'before' ? 0.1 : edge === 'after' ? 0.9 : 0.5);
  // This command uses Playwright's mouse, including intermediate pointer motion.
  await commands.dragPDFText({ x, y }, { x: tx, y: ty });
}

it('keeps folder rows quiet on hover and exposes editing through context menus', async () => {
  await page.viewport(1100, 780);
  useSettingsStore.getState().setSettings({
    ...useSettingsStore.getState().settings,
    libraryFolders: ['历史'],
  });
  render(<DirectShelf />);
  const nav = page.getByRole('navigation', { name: 'Library' });
  const folder = nav.getByRole('button', { name: '历史', exact: true });
  await userEvent.hover(folder);
  expect(screen.queryByRole('button', { name: /^Rename group/ })).toBeNull();
  const row = screen.getByRole('navigation').querySelector('.glossa-library-folder-row')!;
  expect(row.querySelectorAll('button')).toHaveLength(1);
  const link = row.querySelector('button')!.getBoundingClientRect();
  expect(Math.abs(link.right - row.getBoundingClientRect().right)).toBeLessThan(1);
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/folder-quiet-hover-${theme}.png`,
    });
  }
  await userEvent.click(folder, { button: 'right' });
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename group' }));
  await userEvent.fill(screen.getByRole('textbox', { name: 'Group name' }), '历史研究');
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(useSettingsStore.getState().settings.libraryFolders).toContain('历史研究'),
  );
  expect(new URLSearchParams(mocks.search).get('group')).toBeNull();
  fireEvent.pointerDown(screen.getByRole('navigation').querySelector('[aria-label="历史研究"]')!, {
    button: 0,
    pointerId: 8,
    pointerType: 'touch',
    clientX: 80,
    clientY: 180,
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  fireEvent.pointerUp(document, { pointerId: 8, pointerType: 'touch', clientX: 80, clientY: 180 });
  await screen.findByRole('menuitem', { name: 'Rename group' });
  expect(new URLSearchParams(mocks.search).get('group')).toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('历史研究');
  const card = page.getByRole('main').getByRole('button', { name: '历史研究', exact: true });
  await userEvent.hover(card);
  expect(screen.queryByRole('button', { name: /^Rename group/ })).toBeNull();
  await userEvent.click(card, { button: 'right' });
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename group' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('textbox', { name: 'Group name' })).toBeNull();
});

it('opens folders directly and drags books and imported folder subtrees from the sidebar', async () => {
  await page.viewport(1100, 780);
  useSettingsStore.getState().setSettings({
    ...useSettingsStore.getState().settings,
    libraryFolders: ['文学', '文学/小说', '历史', '研究'],
  });
  useLibraryStore.getState().setLibrary([original]);
  render(<DirectShelf />);
  const nav = page.getByRole('navigation', { name: 'Library' });
  await page
    .getByRole('button', { name: original.title, exact: true })
    .dropTo(nav.getByRole('button', { name: '文学/小说', exact: true }));
  await waitFor(() => expect(useLibraryStore.getState().library[0]?.groupName).toBe('文学/小说'));
  expect(mocks.openBook).not.toHaveBeenCalled();
  await pointerMove('历史', '文学');
  await waitFor(() =>
    expect(useSettingsStore.getState().settings.libraryFolders).toContain('文学/历史'),
  );
  await userEvent.click(nav.getByRole('button', { name: '文学/小说', exact: true }));
  await waitFor(() =>
    expect(new URLSearchParams(mocks.search).get('group')).toBe(md5Fingerprint('文学/小说')),
  );
  screen.getByRole('navigation').querySelector<HTMLButtonElement>('[aria-label="文学"]')!.focus();
  await userEvent.keyboard('{F2}');
  await userEvent.fill(screen.getByRole('textbox', { name: 'Group name' }), '文学研究');
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(new URLSearchParams(mocks.search).get('group')).toBe(md5Fingerprint('文学研究/小说')),
  );
  await pointerMove('文学研究', '研究');
  await waitFor(() =>
    expect(useSettingsStore.getState().settings.libraryFolders).toContain('研究/文学研究/小说'),
  );
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/library-direct-${matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer'}-${theme}.png`,
    });
  }
  if (matchMedia('(pointer: coarse)').matches)
    for (const button of screen.getByRole('navigation').querySelectorAll('button')) {
      if (getComputedStyle(button).visibility === 'hidden') continue;
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
});

it('routes an external file drop to its sidebar folder and leaves ordinary navigation intact', async () => {
  await page.viewport(1100, 780);
  useSettingsStore.getState().setSettings({
    ...useSettingsStore.getState().settings,
    libraryFolders: ['文学', '文学/小说'],
  });
  render(<DirectShelf />);
  const spy = vi.spyOn(eventDispatcher, 'dispatch');
  const file = new File(['原创内容'], '散步.epub');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  expect(transfer.types).toContain('Files');
  const target = screen
    .getByRole('navigation')
    .querySelector<HTMLButtonElement>('[aria-label="文学/小说"]')!;
  fireEvent(
    target,
    new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  expect(document.querySelector('.library-page')?.contains(target)).toBe(true);
  fireEvent(
    target,
    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  await waitFor(() =>
    expect(spy).toHaveBeenCalledWith('import-book-files', {
      files: [{ file, groupName: '文学/小说' }],
      folders: [],
    }),
  );
  expect(target.hasAttribute('data-external-drop')).toBe(false);
  spy.mockRestore();
});

it('creates and renames empty folders, navigates two levels, and stays in a valid empty folder', async () => {
  await page.viewport(1100, 780);
  render(<Shelf />);
  await userEvent.click(screen.getByRole('button', { name: /^(All books|Books)$/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: /New (group|subgroup)/ }));
  await userEvent.fill(screen.getByRole('textbox', { name: 'Group name' }), '文学');
  await userEvent.keyboard('{Enter}');
  const card = await screen.findByRole('button', { name: '文学' });
  const title = card.querySelector<HTMLElement>('.glossa-book-title')!;
  const titleStyle = getComputedStyle(title);
  const font = [titleStyle.fontSize, titleStyle.fontWeight, titleStyle.lineHeight];
  const titleBounds = title.getBoundingClientRect();
  card.focus();
  await userEvent.keyboard('{F2}');
  const edit = screen.getByRole('textbox', { name: 'Group name' });
  const editStyle = getComputedStyle(edit);
  expect([editStyle.fontSize, editStyle.fontWeight, editStyle.lineHeight]).toEqual(font);
  expect(editStyle.borderWidth).toBe('0px');
  expect(editStyle.outlineStyle).toBe('none');
  expect(Math.abs(edit.getBoundingClientRect().left - titleBounds.left)).toBeLessThan(1);
  expect(Math.abs(title.getBoundingClientRect().height - titleBounds.height)).toBeLessThan(1);
  await userEvent.fill(screen.getByRole('textbox', { name: 'Group name' }), '文学研究');
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('button', { name: '文学研究' })).toBeTruthy());
  screen.getByRole('button', { name: '文学研究' }).focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(new URLSearchParams(mocks.search).get('group')).toBe(md5Fingerprint('文学研究')),
  );
  expect(screen.getByText('This folder is empty')).toBeTruthy();
  expect(document.querySelector('.bookshelf-import-item')).toBeNull();
  expect(new URLSearchParams(mocks.search).get('groupBy')).toBe('group');
  expect(screen.queryByRole('heading', { name: 'Books' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '文学研究' }));
  await userEvent.click(screen.getByRole('menuitem', { name: /New (group|subgroup)/ }));
  await userEvent.fill(screen.getByRole('textbox'), '俄国文学');
  await userEvent.keyboard('{Enter}');
  const child = await screen.findByRole('button', { name: '文学研究/俄国文学' });
  await page.screenshot({
    path: `../../../../../../.glossa-dev/qa/library-folder-cards-${matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer'}.png`,
  });
  child.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(new URLSearchParams(mocks.search).get('group')).toBe(
      md5Fingerprint('文学研究/俄国文学'),
    ),
  );
  expect(screen.queryByRole('button', { name: 'New subgroup' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Import Books' }));
  expect(mocks.importBooks).toHaveBeenCalled();
  useLibraryStore.getState().setLibrary([]);
  expect(
    useLibraryStore
      .getState()
      .getGroups()
      .map((g) => g.name),
  ).toEqual(['文学研究', '文学研究/俄国文学']);
  const groups = generateBookshelfItems(
    [],
    '',
    useSettingsStore.getState().settings.libraryFolders,
  ) as BooksGroup[];
  expect(groups.map((g) => g.name)).toEqual(['文学研究']);
});

it('offers a usable destination tree with inline children and no narrow-screen overflow', async () => {
  await page.viewport(320, 650);
  useSettingsStore.getState().setSettings({
    ...DEFAULT_SYSTEM_SETTINGS,
    libraryFolders: ['文学', '文学/俄国文学', '研究'],
  } as SystemSettings);
  useLibraryStore.getState().setLibrary([original]);
  const confirm = vi.fn();
  render(
    <GroupingModal
      libraryBooks={[original]}
      selectedBooks={[original.hash]}
      parentGroupName=''
      onCancel={noop}
      onConfirm={confirm}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: '俄国文学' }));
  const destination = screen.getByRole('button', { name: '俄国文学' });
  await userEvent.click(screen.getByRole('button', { name: 'Move to group' }));
  const createChild = await screen.findByRole('menuitem', { name: 'New subgroup' });
  createChild.focus();
  await userEvent.keyboard('{Enter}');
  const name = screen.getByRole('textbox', { name: 'Group name' });
  expect(getComputedStyle(name).fontSize).toBe(getComputedStyle(destination).fontSize);
  expect(getComputedStyle(name).borderWidth).toBe('0px');
  expect(getComputedStyle(name).outlineStyle).toBe('none');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
  for (const theme of ['default-light', 'default-dark']) {
    document.documentElement.setAttribute('data-theme', theme);
    // Theme colors transition in the shared modal styles.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    const picker = screen.getByRole('dialog');
    expect(picker.querySelector('.modal-box')!.getBoundingClientRect().width).toBeLessThanOrEqual(
      320,
    );
    await page.screenshot({
      path: `../../../../../../.glossa-dev/qa/library-folders-${matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer'}-${theme}.png`,
    });
  }
  if (matchMedia('(pointer: coarse)').matches)
    for (const button of document.querySelectorAll(
      '.glossa-folder-destination, .glossa-folder-tree-row > button, .glossa-folder-picker header button',
    ))
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('data-eink', 'true');
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  expect(getComputedStyle(screen.getByRole('button', { name: '俄国文学' })).outlineWidth).toBe(
    '1px',
  );
  await userEvent.click(screen.getByRole('button', { name: /^Move$/ }));
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  expect(useLibraryStore.getState().library[0]?.groupName).toBe('文学/俄国文学');
});

it('deletes a selected empty folder instead of asking to delete zero books', async () => {
  useSettingsStore.getState().setSettings({
    ...DEFAULT_SYSTEM_SETTINGS,
    libraryGroupBy: LibraryGroupByType.Group,
    libraryFolders: ['文学'],
  } as SystemSettings);
  render(<Shelf />);
  const card = await screen.findByRole('button', { name: '文学' });
  fireEvent.contextMenu(card, { clientX: 100, clientY: 150 });
  await userEvent.click(await screen.findByText('Select Group'));
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(useSettingsStore.getState().settings.libraryFolders).toEqual([]));
  expect(screen.queryByText('Confirm Deletion')).toBeNull();
});

it('deletes a nonempty branch safely and restores it with keyboard undo', async () => {
  await page.viewport(1100, 780);
  useSettingsStore.getState().setSettings({
    ...useSettingsStore.getState().settings,
    libraryFolders: ['A', 'A/B', 'A/B/C', 'Target'],
  });
  useLibraryStore.getState().setLibrary([{ ...original, groupName: 'A/B/C', progress: [1, 4] }]);
  render(<DirectShelf />);
  await userEvent.click(
    page.getByRole('navigation').getByRole('button', { name: 'A', exact: true }),
    { button: 'right' },
  );
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete group' }));
  expect(
    screen.getByText('Books and subgroups move up one level. Reading data is kept.'),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Delete group' }));
  await waitFor(() => expect(useLibraryStore.getState().library[0]?.groupName).toBe('B/C'));
  screen.getByRole('navigation').querySelector<HTMLButtonElement>('[aria-label="B"]')!.focus();
  await userEvent.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(useLibraryStore.getState().library[0]?.groupName).toBe('A/B/C'));
  expect(useLibraryStore.getState().library[0]?.progress).toEqual([1, 4]);
});

it.each([
  { theme: 'default-light', dir: 'ltr', active: false, eink: false },
  { theme: 'default-dark', dir: 'ltr', active: true, eink: false },
  { theme: 'default-light', dir: 'rtl', active: true, eink: true },
])('keeps inline rename aligned and preserves navigation ($theme, $dir, active=$active)', async ({
  theme,
  dir,
  active,
  eink,
}) => {
  await page.viewport(1100, 780);
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('data-eink', String(eink));
  if (active) mocks.search = `groupBy=group&group=${md5Fingerprint('历史/思想')}`;
  useSettingsStore.getState().setSettings({
    ...useSettingsStore.getState().settings,
    libraryFolders: ['历史', '历史/思想', '历史/思想/语言', '文学'],
  });
  render(<DirectShelf />);
  const row = screen.getByRole('navigation').querySelector('[data-folder-row="历史/思想"]')!;
  const before = row.getBoundingClientRect();
  const background = getComputedStyle(
    row.querySelector('button.glossa-library-folder-link')!,
  ).backgroundColor;
  const text = row.querySelector<HTMLElement>('.glossa-library-folder-link span')!;
  const label = text.getBoundingClientRect();
  const typography = getComputedStyle(text);
  const originalFont = [typography.fontSize, typography.fontWeight, typography.lineHeight];
  screen
    .getByRole('navigation')
    .querySelector<HTMLButtonElement>('[aria-label="历史/思想"]')!
    .focus();
  await userEvent.keyboard('{F2}');
  const input = screen.getByRole('textbox');
  expect(Math.abs(row.getBoundingClientRect().height - before.height)).toBeLessThan(1);
  const edge = dir === 'rtl' ? 'right' : 'left';
  expect(Math.abs(input.getBoundingClientRect()[edge] - label[edge])).toBeLessThan(1);
  const inputBounds = input.getBoundingClientRect();
  expect(
    Math.abs(inputBounds.top + inputBounds.height / 2 - (label.top + label.height / 2)),
  ).toBeLessThan(1);
  const style = getComputedStyle(input);
  expect([style.fontSize, style.fontWeight, style.lineHeight]).toEqual(originalFont);
  expect(style.borderWidth).toBe('0px');
  expect(style.outlineStyle).toBe('none');
  expect(style.boxShadow).toBe('none');
  expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  if (active)
    expect(
      getComputedStyle(input.closest('.glossa-library-folder-edit-content')!).backgroundColor,
    ).toBe(background);
  await page.screenshot({
    path: `../../../../../../.glossa-dev/qa/groups-inline-rename-${theme}-${dir}.png`,
  });
  await userEvent.fill(input, 'Renamed');
  await userEvent.click(
    page.getByRole('navigation').getByRole('button', { name: '文学', exact: true }),
  );
  await waitFor(() =>
    expect(useSettingsStore.getState().settings.libraryFolders).toContain('历史/Renamed/语言'),
  );
  expect(new URLSearchParams(mocks.search).get('group')).toBe(md5Fingerprint('文学'));
  await page.screenshot({ path: '../../../../../../.glossa-dev/qa/groups-integrated.png' });
});

it('reorders branches with mouse edges and rejects moving a full four-level branch too deep', async () => {
  await page.viewport(1100, 780);
  useSettingsStore.getState().setSettings({
    ...useSettingsStore.getState().settings,
    libraryFolders: ['A', 'A/B', 'A/B/C', 'A/B/C/D', 'Target', 'Last'],
  });
  render(<DirectShelf />);
  await pointerMove('Last', 'Target', 'before');
  await waitFor(() =>
    expect(useSettingsStore.getState().settings.libraryFolders).toEqual([
      'A',
      'A/B',
      'A/B/C',
      'A/B/C/D',
      'Last',
      'Target',
    ]),
  );
  const before = [...useSettingsStore.getState().settings.libraryFolders!];
  await pointerMove('A', 'Target');
  expect(await screen.findByRole('alert')).toHaveTextContent('Up to 4 levels');
  expect(useSettingsStore.getState().settings.libraryFolders).toEqual(before);
  await userEvent.click(
    page.getByRole('navigation').getByRole('button', { name: 'Last', exact: true }),
    { button: 'right' },
  );
  await userEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'A/B/C' }));
  await waitFor(() =>
    expect(useSettingsStore.getState().settings.libraryFolders).toContain('A/B/C/Last'),
  );
});

it('restores temporary expansion when a drag is cancelled with Escape', async () => {
  await page.viewport(1100, 780);
  useSettingsStore.getState().setSettings({
    ...useSettingsStore.getState().settings,
    libraryFolders: ['Source', 'Target', 'Target/Child'],
  });
  render(<DirectShelf />);
  const nav = screen.getByRole('navigation');
  const target = nav.querySelector<HTMLElement>('[aria-label="Target"]')!;
  const source = nav.querySelector<HTMLElement>('[aria-label="Source"]')!;
  await userEvent.click(nav.querySelector('[data-folder-row="Target"] [data-expander]')!);
  expect(nav.querySelector('[aria-label="Target/Child"]')).toBeNull();
  const a = source.getBoundingClientRect(),
    b = target.getBoundingClientRect();
  fireEvent.pointerDown(source, {
    button: 0,
    pointerId: 23,
    pointerType: 'mouse',
    clientX: a.left + 50,
    clientY: a.top + 18,
  });
  fireEvent.pointerMove(document, {
    pointerId: 23,
    pointerType: 'mouse',
    clientX: b.left + 50,
    clientY: b.top + 18,
  });
  await waitFor(() => expect(nav.querySelector('[aria-label="Target/Child"]')).toBeTruthy());
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(nav.querySelector('[aria-label="Target/Child"]')).toBeNull());
  expect(useSettingsStore.getState().settings.libraryFolders).toEqual([
    'Source',
    'Target',
    'Target/Child',
  ]);
});

it('aligns new root and nested folder icons and names with the existing rows', async () => {
  await page.viewport(1100, 780);
  useSettingsStore.getState().setSettings({
    ...useSettingsStore.getState().settings,
    libraryFolders: ['A', 'A/B', 'A/B/C'],
  });
  render(<DirectShelf />);
  const nav = screen.getByRole('navigation');
  for (const parent of ['', 'A/B']) {
    const trigger = parent
      ? nav.querySelector<HTMLButtonElement>(`[aria-label="${parent}"]`)!
      : screen.getByRole('button', { name: 'My Groups' });
    if (parent) fireEvent.contextMenu(trigger);
    else await userEvent.click(trigger);
    await userEvent.click(
      screen.getByRole('menuitem', { name: parent ? 'New subgroup' : 'New group' }),
    );
    const editor = nav.querySelector('.glossa-library-folder-edit-row')!;
    const reference = parent
      ? nav.querySelector('[aria-label="A/B/C"]')!
      : screen.getByRole('button', { name: 'All Books' });
    expect(editor.querySelector('svg')!.getBoundingClientRect().left).toBeCloseTo(
      reference.querySelector('svg')!.getBoundingClientRect().left,
      0,
    );
    expect(screen.getByRole('textbox').getBoundingClientRect().left).toBeCloseTo(
      reference.querySelector('span')!.getBoundingClientRect().left,
      0,
    );
    await userEvent.keyboard('{Escape}');
  }
});

it('shows author collections with matching counts and opens missing authors as a dedicated group', async () => {
  await page.viewport(1100, 780);
  mocks.search = 'groupBy=author';
  const missing = [
    { ...original, hash: 'b'.repeat(32), title: 'No author one', author: '' },
    { ...original, hash: 'c'.repeat(32), title: 'No author two', author: '  ' },
  ];
  useLibraryStore.getState().setLibrary([original, ...missing]);
  render(<Shelf />);
  await screen.findByRole('heading', { name: 'Authors' });
  expect(screen.queryByRole('heading', { name: 'All books' })).toBeNull();
  expect(screen.getByText('2 groups')).toBeTruthy();
  expect(screen.queryByRole('button', { name: missing[0]!.title })).toBeNull();
  await page.getByRole('button', { name: 'Author not set', exact: true }).click();
  await screen.findByRole('button', { name: missing[0]!.title });
  expect(screen.getByRole('button', { name: missing[1]!.title })).toBeTruthy();
  expect(screen.queryByRole('button', { name: original.title })).toBeNull();
  expect(mocks.openBook).not.toHaveBeenCalled();
});
