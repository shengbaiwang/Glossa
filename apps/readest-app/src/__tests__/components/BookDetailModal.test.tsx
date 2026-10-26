import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, screen } from '@testing-library/react';

import { useLibraryStore } from '@/store/libraryStore';
import type { BookMetadata } from '@/libs/document';
import { Book } from '@/types/book';
import BookDetailModal from '@/components/metadata/BookDetailModal';
import { DropdownProvider } from '@/context/DropdownContext';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const appSvc = {
  isMacOSApp: false,
  saveLibraryBooks: vi.fn(async () => {}),
  exists: vi.fn(async (_path: string, base: string) => base === 'None'),
  resolveFilePath: vi.fn(async (path: string) => path),
  saveFile: vi.fn(async () => {}),
  getBookFileSize: vi.fn(async () => 1024),
  fetchBookDetails: vi.fn(async (): Promise<BookMetadata | null> => null),
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => appSvc }, appService: appSvc }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 } }),
}));

vi.mock('@/store/settingsStore', () => {
  const state = {
    settings: {
      metadataSeriesCollapsed: true,
      metadataOthersCollapsed: true,
      metadataDescriptionCollapsed: true,
    },
  };
  return { useSettingsStore: Object.assign(() => state, { getState: () => state }) };
});

vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({ selectFiles: vi.fn() }),
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn() }));

vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isWebAppPlatform: () => false,
}));

vi.mock('@/libs/metadata', () => ({ searchMetadata: vi.fn(async () => []) }));

// Render the cover with the same src-resolution as the real <BookCover> so we
// can assert which cover the view actually shows.
vi.mock('@/components/BookCover', () => ({
  __esModule: true,
  default: ({ book }: { book: Book }) => (
    // biome-ignore lint/a11y/useAltText: test mock
    <img data-testid='cover' src={book.metadata?.coverImageUrl || book.coverImageUrl || ''} />
  ),
}));

vi.mock('next/image', () => ({
  __esModule: true,
  // biome-ignore lint/a11y/useAltText: test mock
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

// Chrome we don't exercise — keep imports cheap and side-effect free.
vi.mock('@/components/Dialog', () => ({
  __esModule: true,
  default: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}</div> : null,
}));
// Expose the confirm callback with the purge flag so we can assert routing
// without driving the real toggle UI (covered by DeleteConfirmAlert.test.tsx).
vi.mock('@/components/DeleteConfirmAlert', () => ({
  __esModule: true,
  default: ({
    showPurgeToggle,
    onConfirm,
    onStop,
  }: {
    showPurgeToggle?: boolean;
    onConfirm: (purgeData: boolean) => void;
    onStop?: () => void;
  }) => (
    <div data-testid='delete-confirm' data-purge-toggle={String(!!showPurgeToggle)}>
      <button onClick={() => onConfirm(false)}>confirm-keep-data</button>
      <button onClick={onStop}>stop-deletion</button>
      <button onClick={() => onConfirm(true)}>confirm-purge-data</button>
    </div>
  ),
}));
vi.mock('@/components/metadata/SourceSelector', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/Spinner', () => ({ __esModule: true, default: () => null }));

afterEach(() => {
  cleanup();
  useLibraryStore.getState().setLibrary([]);
  appSvc.isMacOSApp = false;
  vi.clearAllMocks();
});

const makeBook = (): Book =>
  ({
    hash: 'abc123',
    title: 'Old Title',
    author: 'Old Author',
    format: 'EPUB',
    coverImageUrl: 'old-cover',
    primaryLanguage: 'en',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {
      title: 'Old Title',
      author: 'Old Author',
      language: 'en',
      coverImageUrl: 'old-cover',
    },
  }) as Book;

describe('BookDetailModal cover refresh after save', () => {
  it('edits and resets the corrected imported name without restoring raw placeholder metadata', async () => {
    const book = makeBook();
    book.title = '马基雅维里主义';
    book.author = '';
    book.metadata = { title: 'ssreader', author: 'ssreader', language: 'zh' };
    const onUpdate = vi.fn();
    render(
      <BookDetailModal book={book} isOpen onClose={vi.fn()} handleBookMetadataUpdate={onUpdate} />,
    );
    await screen.findByTitle('Edit Metadata');
    fireEvent.click(screen.getByTitle('Edit Metadata'));
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await waitFor(() => expect((title as HTMLInputElement).value).toBe('马基雅维里主义'));
    expect((screen.getByRole('textbox', { name: 'Author' }) as HTMLInputElement).value).toBe('');
    fireEvent.change(title, { target: { value: 'temporary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect((title as HTMLInputElement).value).toBe('马基雅维里主义');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdate.mock.calls[0]?.[1]).toMatchObject({ title: '马基雅维里主义', author: '' });
    expect(book.metadata.title).toBe('ssreader');
  });

  it('restores the cover preview and labeled fields when resetting edits', async () => {
    render(
      <BookDetailModal
        book={makeBook()}
        isOpen
        onClose={vi.fn()}
        handleBookMetadataUpdate={vi.fn()}
      />,
    );
    await screen.findByTestId('cover');
    fireEvent.click(screen.getByTitle('Edit Metadata'));
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'New Title' } });
    fireEvent.click(screen.getByTitle('Remove cover image'));
    expect(screen.getByTestId('cover').getAttribute('src')).toBe('_blank');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect((title as HTMLInputElement).value).toBe('Old Title');
    expect(screen.getByTestId('cover').getAttribute('src')).toBe('old-cover');
  });

  it('updates the Book Details view cover when the cover is edited and saved', async () => {
    const book = makeBook();
    const onUpdate = vi.fn();
    render(
      <BookDetailModal book={book} isOpen onClose={vi.fn()} handleBookMetadataUpdate={onUpdate} />,
    );

    // The view initially shows the original cover.
    await waitFor(() => expect(screen.getByTestId('cover').getAttribute('src')).toBe('old-cover'));

    // Edit → remove the cover → save.
    fireEvent.click(screen.getByTitle('Edit Metadata'));
    fireEvent.click(await screen.findByTitle('Remove cover image'));
    fireEvent.click(screen.getByText('Save'));

    expect(onUpdate).toHaveBeenCalledTimes(1);

    // The details view must reflect the saved cover change without needing the
    // modal to be reopened (the bug: it kept showing the stale `book` prop).
    await waitFor(() => {
      expect(screen.getByTestId('cover').getAttribute('src')).not.toBe('old-cover');
    });
    expect(screen.getByTestId('cover').getAttribute('src')).toBe('_blank');
  });
});

describe('BookDetailModal recoverable deletion routing', () => {
  const renderModal = (handlers: { handleBookDelete: () => void; handleBookPurge: () => void }) =>
    render(
      <DropdownProvider>
        <BookDetailModal
          book={makeBook()}
          isOpen
          onClose={vi.fn()}
          handleBookDelete={handlers.handleBookDelete}
          handleBookDeleteLocalCopy={vi.fn()}
          handleBookPurge={handlers.handleBookPurge}
        />
      </DropdownProvider>,
    );

  const openStandardDelete = (container: HTMLElement) => {
    fireEvent.click(container.querySelector('button[aria-label="Delete book"]')!);
  };

  it('keeps ordinary deletion recoverable and never exposes a permanent-delete toggle', () => {
    const handleBookDelete = vi.fn();
    const handleBookPurge = vi.fn();
    const { container } = renderModal({ handleBookDelete, handleBookPurge });

    openStandardDelete(container);
    expect(screen.getByTestId('delete-confirm').getAttribute('data-purge-toggle')).toBe('false');

    fireEvent.click(screen.getByText('confirm-purge-data'));
    expect(handleBookPurge).not.toHaveBeenCalled();
    expect(handleBookDelete).toHaveBeenCalledTimes(1);
  });

  it('routes the standard delete to a plain delete when the toggle is off', () => {
    const handleBookDelete = vi.fn();
    const handleBookPurge = vi.fn();
    const { container } = renderModal({ handleBookDelete, handleBookPurge });

    openStandardDelete(container);
    fireEvent.click(screen.getByText('confirm-keep-data'));
    expect(handleBookDelete).toHaveBeenCalledTimes(1);
    expect(handleBookPurge).not.toHaveBeenCalled();
  });
});

describe('BookDetailModal direct actions', () => {
  it('keeps a saved inline title when an earlier metadata read finishes later', async () => {
    const book = { ...makeBook(), metadata: undefined, downloadedAt: 2 };
    useLibraryStore.setState({ libraryLoaded: true, library: [book] });
    let finish!: (value: null) => void;
    appSvc.fetchBookDetails.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <BookDetailModal book={book} isOpen onClose={vi.fn()} handleBookMetadataUpdate={vi.fn()} />,
    );
    await waitFor(() => expect(appSvc.fetchBookDetails).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Title' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Saved in place' },
    });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Title' }).closest('form')!);
    await waitFor(() =>
      expect(useLibraryStore.getState().library[0]?.title).toBe('Saved in place'),
    );
    finish(null);
    await waitFor(() => expect(appSvc.getBookFileSize).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle('Edit Metadata'));
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
        'Saved in place',
      ),
    );
  });

  it('sends the actual local book file from details through the system share sheet', async () => {
    appSvc.isMacOSApp = true;
    const book = { ...makeBook(), filePath: '/original/reader.epub', downloadedAt: 2 };
    render(
      <DropdownProvider>
        <BookDetailModal book={book} isOpen onClose={vi.fn()} />
      </DropdownProvider>,
    );
    await waitFor(() => expect(appSvc.getBookFileSize).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'More Actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Send' }));
    await waitFor(() =>
      expect(appSvc.saveFile).toHaveBeenCalledWith(
        'Old Title.epub',
        null,
        expect.objectContaining({
          share: true,
          filePath: '/original/reader.epub',
          mimeType: 'application/epub+zip',
        }),
      ),
    );
  });
});

it('retains metadata read from the original file while saving an inline title', async () => {
  const book = { ...makeBook(), metadata: undefined, downloadedAt: 2 };
  useLibraryStore.setState({ libraryLoaded: true, library: [book] });
  appSvc.fetchBookDetails.mockResolvedValueOnce({
    title: book.title,
    author: book.author,
    language: 'en',
    publisher: 'Original publisher',
  });
  render(
    <BookDetailModal book={book} isOpen onClose={vi.fn()} handleBookMetadataUpdate={vi.fn()} />,
  );
  await waitFor(() => expect(appSvc.getBookFileSize).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Personal title' },
  });
  fireEvent.submit(screen.getByRole('textbox', { name: 'Title' }).closest('form')!);
  await waitFor(() => expect(useLibraryStore.getState().library[0]?.title).toBe('Personal title'));
  expect(useLibraryStore.getState().library[0]?.metadata?.publisher).toBe('Original publisher');
});

it('passes the detail Stop action to the running deletion signal', async () => {
  let captured: AbortSignal | undefined;
  let finish!: (result: boolean) => void;
  const remove = vi.fn((_book: Book, signal?: AbortSignal) => {
    captured = signal;
    return new Promise<boolean>((resolve) => {
      finish = resolve;
    });
  });
  render(
    <DropdownProvider>
      <BookDetailModal book={makeBook()} isOpen onClose={vi.fn()} handleBookDelete={remove} />
    </DropdownProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete book' }));
  fireEvent.click(screen.getByText('confirm-keep-data'));
  expect(captured?.aborted).toBe(false);
  fireEvent.click(screen.getByText('stop-deletion'));
  expect(captured?.aborted).toBe(true);
  finish(false);
  await waitFor(() => expect(screen.queryByTestId('delete-confirm')).toBeNull());
});
