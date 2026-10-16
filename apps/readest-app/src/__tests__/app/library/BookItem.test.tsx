import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BookItem from '@/app/library/components/BookItem';
import type { Book } from '@/types/book';

const mocks = vi.hoisted(() => ({
  service: { isMobile: false },
  showDetails: vi.fn(),
  download: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: mocks.service }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test-user' } }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
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
      handleBookUpload={vi.fn()}
      handleBookDownload={mocks.download}
      showBookDetailsModal={mocks.showDetails}
      showTimeRemaining={false}
    />,
  );
  return item;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.service.isMobile = false;
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
