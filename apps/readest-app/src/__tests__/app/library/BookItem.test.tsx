import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BookItem from '@/app/library/components/BookItem';
import type { Book } from '@/types/book';

const mocks = vi.hoisted(() => ({
  service: { isMobile: false },
  showDetails: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  login: vi.fn(),
  user: { id: 'test-user' } as { id: string } | null,
  fileProvider: false,
  display: {} as { libraryShowAuthor?: boolean; libraryShowProgress?: boolean },
  rename: vi.fn(async () => true),
  status: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks.service }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/utils/nav', () => ({ navigateToLogin: mocks.login }));
vi.mock('@/services/sync/cloudSyncProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/cloudSyncProvider')>()),
  getActiveFileSyncBackends: () => (mocks.fileProvider ? ['webdav'] : []),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: mocks.display }) }));
vi.mock('@/hooks/useMedianPageDurationSecs', () => ({
  useMedianPageDurationSecs: () => undefined,
}));
vi.mock('@/components/BookCover', () => ({ default: () => null }));

const book: Book = {
  hash: 'natural-book',
  title: 'A complete title',
  author: 'An Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};

function renderBook(overrides: Partial<Book> = {}) {
  const item = { ...book, ...overrides };
  render(
    <BookItem
      book={item}
      mode='grid'
      coverFit='crop'
      isSelectMode={false}
      bookSelected={false}
      transferProgress={null}
      handleBookUpload={mocks.upload}
      handleBookDownload={mocks.download}
      showBookDetailsModal={mocks.showDetails}
      showTimeRemaining={false}
      onRename={mocks.rename}
      onUpdateStatus={mocks.status}
    />,
  );
  return item;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.service.isMobile = false;
  mocks.fileProvider = false;
  mocks.display = {};
  mocks.user = { id: 'test-user' };
});

it('omits an empty upload button when the original cloud service is disabled', () => {
  renderBook();
  expect(screen.queryByRole('button', { name: 'Upload Book' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show Book Details' }));
  expect(mocks.showDetails).toHaveBeenCalledExactlyOnceWith(book);
});

it('retains the explicit download action for an existing cloud-only book', () => {
  const item = renderBook({ uploadedAt: 2 });
  const download = screen.getByRole('button', { name: 'Download Book' });
  expect(download.querySelector('svg')).toBeTruthy();
  fireEvent.click(download);
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith(item, { queued: true });
});

it('keeps grid book details directly available on mobile', () => {
  mocks.service.isMobile = true;
  renderBook();
  fireEvent.click(screen.getByRole('button', { name: 'Show Book Details' }));
  expect(mocks.showDetails).toHaveBeenCalledExactlyOnceWith(book);
});

it('edits the title in place and keeps cancelled edits out of storage', async () => {
  renderBook();
  fireEvent.doubleClick(screen.getByText(book.title));
  const input = screen.getByRole('textbox', { name: 'Title' });
  fireEvent.change(input, { target: { value: 'Personal title' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(mocks.rename).not.toHaveBeenCalled();
  fireEvent.doubleClick(screen.getByText(book.title));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Personal title' },
  });
  fireEvent.submit(screen.getByRole('textbox', { name: 'Title' }).closest('form')!);
  expect(mocks.rename).toHaveBeenCalledWith(book, 'Personal title');
});
it('offers status directly even for a book with no progress', () => {
  renderBook();
  fireEvent.click(screen.getByRole('button', { name: 'Reading Status' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as Finished' }));
  expect(mocks.status).toHaveBeenCalledWith(book, 'finished');
});

it('uses the configured personal cloud without requiring an app account', () => {
  mocks.fileProvider = true;
  mocks.user = null;
  renderBook({ downloadedAt: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Upload Book' }));
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith({ ...book, downloadedAt: 2 });
  expect(mocks.login).not.toHaveBeenCalled();
});

it('hides optional author and progress without losing title, status editing or details', () => {
  mocks.display = { libraryShowAuthor: false, libraryShowProgress: false };
  renderBook({ progress: [1, 4] });
  expect(screen.getByText(book.title)).toBeTruthy();
  expect(screen.queryByText(book.author)).toBeNull();
  expect(screen.queryByText('25%')).toBeNull();
  expect(screen.getByRole('button', { name: 'Reading Status' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Show Book Details' })).toBeTruthy();
});
