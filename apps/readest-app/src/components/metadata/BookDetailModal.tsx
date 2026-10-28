import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';

import { Book } from '@/types/book';
import { useLibraryBookEdits } from '@/app/library/hooks/useLibraryBookEdits';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { removalScope } from '@/services/appBookRemoval';
import { EXTS, MIMETYPES } from '@/libs/document';
import { getLocalBookFilename } from '@/utils/book';
import { makeSafeFilename } from '@/utils/misc';
import { formatAuthors, formatTitle, getBookWithUpdatedMetadata } from '@/utils/book';
import { BookMetadata } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useMetadataEdit } from './useMetadataEdit';
import { DeleteAction } from '@/types/system';
import { eventDispatcher } from '@/utils/event';
import { isWebAppPlatform } from '@/services/environment';
import DeleteConfirmAlert from '@/components/DeleteConfirmAlert';
import Dialog from '@/components/Dialog';
import ModalPortal from '@/components/ModalPortal';
import BookDetailView from './BookDetailView';
import BookDetailEdit from './BookDetailEdit';
import SourceSelector from './SourceSelector';
import Spinner from '../Spinner';

type DeleteHandler = (book: Book, signal?: AbortSignal) => void | boolean | Promise<void | boolean>;

interface BookDetailModalProps {
  book: Book;
  isOpen: boolean;
  onClose: () => void;
  handleBookDownload?: (book: Book, options?: { redownload?: boolean; queued?: boolean }) => void;
  handleBookUpload?: (book: Book) => void;
  handleBookDelete?: DeleteHandler;
  handleBookDeleteLocalCopy?: DeleteHandler;
  handleBookPurge?: DeleteHandler;
  handleBookMetadataUpdate?: (book: Book, updatedMetadata: BookMetadata, tags: string[]) => void;
  onMetadataValueClick?: (type: 'tag', value: string) => void;
}

// Permanent deletion is available only from Recently Deleted.
type DeleteMenuAction = Exclude<DeleteAction, 'purge' | 'cloud'>;

interface DeleteConfig {
  title: string;
  message: string;
  handler?: DeleteHandler;
  confirmLabel: string;
}

const BookDetailModal: React.FC<BookDetailModalProps> = ({
  book,
  isOpen,
  onClose,
  handleBookDownload,
  handleBookUpload,
  handleBookDelete,
  handleBookDeleteLocalCopy,
  handleBookMetadataUpdate,
  onMetadataValueClick,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const bookEdits = useLibraryBookEdits();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const [activeDeleteAction, setActiveDeleteAction] = useState<DeleteMenuAction | null>(null);
  const deletionController = useRef<AbortController | null>(null);
  useEffect(() => () => deletionController.current?.abort(), []);
  const [isLoading, setIsLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [bookMeta, setBookMeta] = useState<BookMetadata | null>(null);
  const [bookTags, setBookTags] = useState<string[]>(book.tags ?? []);
  const [fileSize, setFileSize] = useState<number | null>(null);
  // The parent owns the `book` prop and does not re-pass it after a metadata
  // save, so the details view tracks the saved book locally to refresh its
  // cover/title/author immediately (otherwise it shows the stale prop).
  const [displayBook, setDisplayBook] = useState<Book>(book);
  const storedBook = useLibraryStore((state) =>
    state.library.find((item) => item.hash === book.hash),
  );
  useEffect(() => {
    if (storedBook) setDisplayBook(storedBook);
  }, [storedBook]);
  useEffect(() => {
    if (!storedBook) return;
    setBookTags(storedBook.tags ?? []);
    setBookMeta((previous) => {
      const metadata = storedBook.metadata ?? previous;
      if (!metadata) return null;
      if (
        metadata === previous &&
        metadata.title === storedBook.title &&
        metadata.author === storedBook.author
      )
        return previous;
      return { ...metadata, title: storedBook.title, author: storedBook.author };
    });
  }, [storedBook?.metadata, storedBook?.title, storedBook?.author, storedBook?.tags]);

  // Initialize metadata edit hook
  const {
    editedMeta,
    editedTags,
    fieldSources,
    lockedFields,
    fieldErrors,
    searchLoading,
    showSourceSelection,
    availableSources,
    handleFieldChange,
    handleToggleFieldLock,
    handleLockAll,
    handleUnlockAll,
    handleAutoRetrieve,
    handleSourceSelection,
    handleCloseSourceSelection,
    resetToOriginal,
  } = useMetadataEdit(bookMeta, bookTags);

  const deleteConfigs: Record<DeleteMenuAction, DeleteConfig> = {
    both: {
      title: _('Delete book?'),
      message: _('You can restore this book and its reading data from Recently Deleted.'),
      handler: handleBookDelete,
      confirmLabel: _('Delete'),
    },
    local: {
      title: _('Clear local download?'),
      message: _(
        'Clear the downloaded copy from this device? Personal data and cloud copies are kept.',
      ),
      handler: handleBookDeleteLocalCopy,
      confirmLabel: _('Clear download'),
    },
  };

  useEffect(() => {
    let cancelled = false;
    const fetchBookDetails = async () => {
      try {
        const service = await envConfig.getAppService();
        const startingBook =
          useLibraryStore.getState().library.find((item) => item.hash === book.hash) ?? book;
        let details = startingBook.metadata ?? null;
        if (!details && startingBook.downloadedAt)
          details = await service.fetchBookDetails(startingBook);
        if (cancelled) return;
        // An earlier disk read must not overwrite a title/author saved while it was pending.
        const current =
          useLibraryStore.getState().library.find((item) => item.hash === book.hash) ??
          startingBook;
        details = current.metadata ?? details;
        setBookMeta(
          details
            ? {
                ...details,
                ...(current.title && current.title !== formatTitle(details.title)
                  ? { title: current.title }
                  : {}),
                ...(current.author !== formatAuthors(details.author, current.primaryLanguage)
                  ? { author: current.author }
                  : {}),
              }
            : null,
        );
        const size = await service.getBookFileSize(current);
        if (!cancelled) setFileSize(size);
      } catch {
        if (!cancelled) setFileSize(null);
      }
    };
    void fetchBookDetails();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  useEffect(() => {
    const current =
      useLibraryStore.getState().library.find((item) => item.hash === book.hash) ?? book;
    setDisplayBook(current);
    setBookTags(current.tags ?? []);
  }, [book]);

  const handleClose = () => {
    setBookMeta(null);
    setEditMode(false);
    setActiveDeleteAction(null);
    onClose();
  };

  const handleEditMetadata = () => {
    setEditMode(true);
  };

  const handleCancelEdit = () => {
    resetToOriginal();
    setEditMode(false);
  };

  const handleSaveMetadata = () => {
    if (editedMeta && handleBookMetadataUpdate) {
      // The edit field keeps empty segments while typing; drop them and
      // dedupe on save.
      const savedTags = [...new Set(editedTags.map((tag) => tag.trim()).filter(Boolean))];
      setBookMeta({ ...editedMeta });
      setBookTags(savedTags);
      // Capture the updated book before handleBookMetadataUpdate clears the
      // temporary cover fields on editedMeta, so the view refreshes its cover.
      setDisplayBook(getBookWithUpdatedMetadata(book, editedMeta, savedTags));
      handleBookMetadataUpdate(book, editedMeta, savedTags);
      setEditMode(false);
    }
  };

  const handleDeleteAction = (action: DeleteMenuAction) => {
    setActiveDeleteAction(action);
  };

  const confirmDeleteAction = async () => {
    if (!activeDeleteAction) return;
    const handler = deleteConfigs[activeDeleteAction].handler;
    const controller = new AbortController();
    deletionController.current = controller;
    try {
      const done = handler && (await handler(displayBook, controller.signal));
      if (controller.signal.aborted && done === false) {
        setActiveDeleteAction(null);
        return;
      }
      if (!handler || done === false) throw new Error('Removal failed');
      handleClose();
    } finally {
      deletionController.current = null;
    }
  };

  const cancelDeleteAction = () => setActiveDeleteAction(null);

  const handleDelete = () => handleDeleteAction('both');
  const handleDeleteLocalCopy = () => handleDeleteAction('local');

  const handleInlineEdit = async (field: 'title' | 'author' | 'tags', value: string) => {
    const saved = await bookEdits.apply(
      [{ ...displayBook, metadata: displayBook.metadata ?? bookMeta ?? undefined }],
      field,
      field === 'tags' ? value.split(/[,，]/) : value,
    );
    if (saved) {
      const latest = useLibraryStore.getState().library.find((b) => b.hash === book.hash);
      if (latest) {
        setDisplayBook(latest);
        setBookMeta(latest.metadata ?? null);
        setBookTags(latest.tags ?? []);
      }
    }
    return saved;
  };
  const handleBookSend = async () => {
    if (!appService) return;
    const anchor = document.querySelector('[role="dialog"] .title-author')?.getBoundingClientRect();
    const sharePosition = anchor
      ? {
          x: anchor.left + anchor.width / 2,
          y: anchor.top + anchor.height / 2,
          preferredEdge: 'bottom' as const,
        }
      : undefined;
    setIsLoading(true);
    try {
      const managed = getLocalBookFilename(displayBook);
      const local = await appService.exists(managed, 'Books');
      const path = local ? managed : displayBook.filePath;
      if (!path || (!local && !(await appService.exists(path, 'None'))))
        throw new Error('file_unavailable');
      const filePath = await appService.resolveFilePath(path, local ? 'Books' : 'None');
      await appService.saveFile(
        `${makeSafeFilename(displayBook.sourceTitle || displayBook.title || displayBook.hash)}.${EXTS[displayBook.format] ?? 'bin'}`,
        null,
        {
          share: true,
          sharePosition,
          filePath,
          mimeType: MIMETYPES[displayBook.format]?.[0] ?? 'application/octet-stream',
        },
      );
    } catch {
      void eventDispatcher.dispatch('toast', { type: 'error', message: _('Failed to send book') });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBookExport = async () => {
    setIsLoading(true);
    setTimeout(async () => {
      const success = await appService?.exportBook(book);
      setIsLoading(false);
      if (!isWebAppPlatform()) {
        eventDispatcher.dispatch('toast', {
          type: success ? 'info' : 'error',
          message: success ? _('Book exported successfully.') : _('Failed to export the book.'),
        });
      }
    }, 0);
  };

  const handleRedownload = async () => {
    handleClose();
    if (handleBookDownload) {
      handleBookDownload(book, { redownload: true, queued: false });
    }
  };

  const handleReupload = async () => {
    handleClose();
    if (handleBookUpload) {
      handleBookUpload(book);
    }
  };

  // Sharing uploads the book to the Readest backend and mints a public link, so
  // it needs a signed-in user and a resolvable on-disk file. `fileSize` is only
  // non-null when getBookFileSize could actually open the local file.
  const shareEnabled = !!user && fileSize !== null;

  const currentDeleteConfig = activeDeleteAction ? deleteConfigs[activeDeleteAction] : null;

  return (
    <>
      <div className='fixed inset-0 z-50 flex items-center justify-center'>
        <Dialog
          title={editMode ? _('Edit Metadata') : _('Book Details')}
          isOpen={isOpen}
          onClose={handleClose}
          boxClassName={clsx(
            editMode
              ? 'glossa-metadata-dialog'
              : 'sm:min-w-[480px] sm:max-w-[480px] sm:h-auto sm:max-h-[90%]',
          )}
          contentClassName={editMode ? 'glossa-metadata-dialog-body' : '!px-6 !py-4'}
        >
          <div
            className={clsx(
              'flex w-full select-text justify-center',
              editMode ? 'min-h-0 flex-1' : 'items-start',
            )}
          >
            {editMode && bookMeta ? (
              <BookDetailEdit
                book={book}
                metadata={editedMeta}
                tags={editedTags}
                fieldSources={fieldSources}
                lockedFields={lockedFields}
                fieldErrors={fieldErrors}
                searchLoading={searchLoading}
                onFieldChange={handleFieldChange}
                onToggleFieldLock={handleToggleFieldLock}
                onAutoRetrieve={handleAutoRetrieve}
                onLockAll={handleLockAll}
                onUnlockAll={handleUnlockAll}
                onCancel={handleCancelEdit}
                onReset={resetToOriginal}
                onSave={handleSaveMetadata}
              />
            ) : (
              <BookDetailView
                book={displayBook}
                metadata={bookMeta}
                fileSize={fileSize}
                shareEnabled={shareEnabled}
                onInlineEdit={handleBookMetadataUpdate ? handleInlineEdit : undefined}
                onSend={
                  appService &&
                  (appService.isMacOSApp || appService.isIOSApp || appService.isAndroidApp)
                    ? handleBookSend
                    : undefined
                }
                onEdit={handleBookMetadataUpdate ? handleEditMetadata : undefined}
                onDelete={handleBookDelete ? handleDelete : undefined}
                onDeleteLocalCopy={handleBookDeleteLocalCopy ? handleDeleteLocalCopy : undefined}
                onDownload={handleBookDownload ? handleRedownload : undefined}
                onUpload={handleBookUpload ? handleReupload : undefined}
                onExport={handleBookExport}
                onMetadataValueClick={onMetadataValueClick}
              />
            )}
          </div>
        </Dialog>

        {/* Source Selection Modal */}
        {showSourceSelection && (
          <SourceSelector
            sources={availableSources}
            isOpen={showSourceSelection}
            onSelect={handleSourceSelection}
            onClose={handleCloseSourceSelection}
          />
        )}

        {isLoading && (
          <div className='fixed inset-0 z-50 flex items-center justify-center'>
            <Spinner loading />
          </div>
        )}

        {activeDeleteAction && currentDeleteConfig && (
          <ModalPortal>
            <DeleteConfirmAlert
              title={currentDeleteConfig.title}
              message={currentDeleteConfig.message}
              books={[displayBook]}
              scope={removalScope(settings, _, activeDeleteAction === 'local')}
              confirmLabel={currentDeleteConfig.confirmLabel}
              destructive={activeDeleteAction === 'both'}
              onStop={() => deletionController.current?.abort()}
              onCancel={cancelDeleteAction}
              onConfirm={confirmDeleteAction}
            />
          </ModalPortal>
        )}
      </div>
    </>
  );
};

export default BookDetailModal;
