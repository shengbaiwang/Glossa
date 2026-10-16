import { useReducer, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
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
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
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
  return (
    <div
      className='full-height flex flex-col'
      style={{ width: '100%', maxWidth: 1100, margin: 'auto' }}
    >
      <Bookshelf
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
  await nav
    .getByRole('button', { name: '历史', exact: true })
    .dropTo(nav.getByRole('button', { name: '文学', exact: true }));
  await waitFor(() =>
    expect(useSettingsStore.getState().settings.libraryFolders).toContain('文学/历史'),
  );
  await userEvent.click(nav.getByRole('button', { name: '文学/小说', exact: true }));
  await waitFor(() =>
    expect(new URLSearchParams(mocks.search).get('group')).toBe(md5Fingerprint('文学/小说')),
  );
  screen.getByRole('navigation').querySelector<HTMLButtonElement>('[aria-label="文学"]')!.focus();
  await userEvent.keyboard('{F2}');
  await userEvent.fill(screen.getByRole('textbox', { name: 'Folder name' }), '文学研究');
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(new URLSearchParams(mocks.search).get('group')).toBe(md5Fingerprint('文学研究/小说')),
  );
  await nav
    .getByRole('button', { name: '文学研究', exact: true })
    .dropTo(nav.getByRole('button', { name: '研究', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Folders support two levels');
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
  await userEvent.click(screen.getByRole('button', { name: 'New Folder' }));
  await userEvent.fill(screen.getByRole('textbox', { name: 'Folder name' }), '文学');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  const card = await screen.findByRole('button', { name: '文学' });
  card.focus();
  await userEvent.keyboard('{F2}');
  await userEvent.fill(screen.getByRole('textbox', { name: 'Folder name' }), '文学研究');
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('button', { name: '文学研究' })).toBeTruthy());
  screen.getByRole('button', { name: '文学研究' }).focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(new URLSearchParams(mocks.search).get('group')).toBe(md5Fingerprint('文学研究')),
  );
  expect(screen.getByText('This folder is empty')).toBeTruthy();
  expect(new URLSearchParams(mocks.search).get('groupBy')).toBe('group');
  await userEvent.click(screen.getByRole('button', { name: 'New Folder' }));
  await userEvent.fill(screen.getByRole('textbox'), '俄国文学');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
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
  expect(screen.queryByRole('button', { name: 'New Folder' })).toBeNull();
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
  expect(screen.getByRole('button', { name: 'New Folder' }).hasAttribute('disabled')).toBe(true);
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
