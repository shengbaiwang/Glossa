import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { invoke } from '@tauri-apps/api/core';
import LibraryNavigation from '@/app/library/components/LibraryNavigation';
import BookshelfItem from '@/app/library/components/BookshelfItem';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryTransfer } from '@/app/library/utils/libraryTransfer';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { LibraryGroupByType, type SystemSettings } from '@/types/settings';
import type { Book } from '@/types/book';
import '@/styles/globals.css';
import '@/styles/glossa.css';
import '@/styles/glossa-library.css';

const mocks = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  saveLibraryBooks: vi.fn(),
  openBook: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  useSearchParams: () => new URLSearchParams('groupBy=group'),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { ...mocks, isLinuxApp: true, hasContextMenu: false } }),
}));
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: vi.fn(),
  navigateToReader: vi.fn(),
  showReaderWindow: vi.fn(),
  navigateToLogin: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/utils/settingsSync', () => ({ broadcastGlobalSettings: vi.fn() }));
vi.mock('@/app/library/hooks/useOpenBook', () => ({
  useOpenBook: () => ({ openBook: mocks.openBook }),
}));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/components/BookCover', () => ({
  default: () => <div style={{ width: '100%', height: '100%', background: '#b8b09a' }} />,
}));
const book: Book = {
  hash: 'native-drag-book',
  title: 'Original fixture',
  author: '',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
  groupName: 'Source',
};
const noop = () => {};
const transfer = async () => true;
beforeAll(async () => {
  expect(await invoke('get_app_identifier')).toBe('com.bilingify.readest.webdriver-test');
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveSettings.mockResolvedValue(undefined);
  mocks.saveLibraryBooks.mockResolvedValue(undefined);
  useLibraryTransfer.setState({ drag: undefined, dragAccepted: false, restores: new Map() });
  useSettingsStore.setState({
    settings: {
      ...DEFAULT_SYSTEM_SETTINGS,
      libraryFolders: ['Empty'],
      libraryGroupBy: LibraryGroupByType.Group,
    } as SystemSettings,
  });
  useLibraryStore.getState().setLibrary([book]);
});
afterEach(cleanup);
it.each([
  'grid',
  'list',
] as const)('lifts only the cover with trusted macOS input in %s and keeps the emptied group', async (mode) => {
  await page.viewport(1100, 780);
  render(
    <div className='library-page glossa-library-workspace' style={{ height: '100vh' }}>
      <LibraryNavigation onNavigate={noop} />
      <main style={{ padding: 40, width: mode === 'grid' ? 220 : 550 }}>
        <BookshelfItem
          mode={mode}
          item={book}
          coverFit='fit'
          itemSelected={false}
          transferProgress={null}
          setLoading={noop}
          selectItem={(id) => useLibraryStore.getState().setSelectedBooks([id])}
          handleGroupBooks={noop}
          handleBookDownload={transfer}
          handleBookUpload={transfer}
          handleBookDelete={transfer}
          handleShowDetailsBook={noop}
          handleLibraryNavigation={noop}
          handleUpdateReadingStatus={noop}
          showTimeRemaining={false}
        />
      </main>
    </div>,
  );
  const card = screen.getByRole('button', { name: book.title });
  const target = within(screen.getByRole('navigation')).getByRole('button', { name: /^Empty$/ });
  const trusted: boolean[] = [];
  card.addEventListener('pointerdown', (event) => trusted.push(event.isTrusted), { once: true });
  const a = card.querySelector('.bookitem-main')!.getBoundingClientRect(),
    b = target.getBoundingClientRect();
  const dragging = commands.dragPDFText(
    { x: a.left + a.width / 2, y: a.top + a.height / 2 },
    { x: b.left + b.width / 2, y: b.top + b.height / 2 },
    1000,
  );
  await waitFor(() => expect(document.querySelector('.glossa-library-drag-preview')).toBeTruthy());
  const preview = document.querySelector('.glossa-library-drag-preview')!;
  expect(preview.querySelector('.bookitem-main')).toBeTruthy();
  expect(
    preview.querySelector('button, .glossa-book-metadata, .glossa-book-selection-overlay'),
  ).toBeNull();
  await act(async () => {
    await dragging;
  });
  await waitFor(() => expect(useLibraryStore.getState().library[0]?.groupName).toBe('Empty'));
  await waitFor(() => expect(document.querySelector('.glossa-library-drag-preview')).toBeNull());
  expect(trusted).toEqual([true]);
  expect(useSettingsStore.getState().settings.libraryFolders).toContain('Source');
  expect(
    within(screen.getByRole('navigation')).getByRole('button', { name: /^Source$/ }),
  ).toBeVisible();
  expect(mocks.openBook).not.toHaveBeenCalled();
});
