import { Book, BookConfig } from '@/types/book';

/** A buffered file payload + its byte length (for the HEAD-vs-local probe). */
export interface BookBytes {
  bytes: ArrayBuffer;
  size: number;
}

/**
 * App-side local I/O the {@link FileSyncEngine} needs, abstracted away from
 * `appService` / Zustand stores so the engine stays testable with a plain
 * fake. One implementation — {@link createAppLocalStore} — is built once per
 * consumer (the reader hook and the library "Sync now" form) and shared, so
 * the buffered + streaming book/cover loaders live in exactly one place
 * instead of being copy-pasted across consumers.
 *
 * Split of responsibilities with {@link FileSyncProvider}:
 *   - provider owns the REMOTE side (and the actual stream transport);
 *   - localStore owns the LOCAL side (reading/writing files on this device,
 *     resolving on-disk paths for streaming, and mutating the local library).
 */
export interface LocalStore {
  /** Load a book's local config (progress + booknotes), or null if none. */
  loadConfig(book: Book): Promise<BookConfig | null>;
  /** Persist a (merged) config to local disk. */
  saveBookConfig(book: Book, config: BookConfig): Promise<void>;
  /** A new download or retry must not overwrite a personal sidecar already on disk. */
  saveDownloadedConfig?(book: Book, config: BookConfig): Promise<void>;

  /** Buffered upload source: the book file bytes, or null when not on disk. */
  loadBookFile(book: Book): Promise<BookBytes | null>;
  /**
   * Streaming upload source: the absolute on-disk path + size of the book
   * file, or null when not on this device. Size lets the engine run the
   * HEAD-vs-local short-circuit without reading any bytes.
   */
  resolveLocalBookPath(book: Book): Promise<{ path: string; size: number } | null>;
  /** Buffered download sink: write freshly-pulled book bytes to disk. */
  saveBookFile(book: Book, bytes: ArrayBuffer): Promise<void>;
  /**
   * Streaming download sink: ensure the per-book directory exists and return
   * the absolute destination path the provider should stream into.
   */
  prepareLocalBookPath(book: Book): Promise<string>;

  /** Buffered cover source, or null when the book has no local cover. */
  loadBookCover(book: Book): Promise<BookBytes | null>;
  /** Write a freshly-pulled cover image to disk. */
  saveBookCover(book: Book, bytes: ArrayBuffer): Promise<void>;

  /** Verify downloaded bytes and register once; legacy duplicates retain archived personal records. */
  addBookToLibrary(book: Book): Promise<Book | void>;
  /** Persist refreshed metadata for a book already in the local library. */
  updateBookMetadata(book: Book): Promise<void>;
  /**
   * Record that these books' files are present on the remote (`uploadedAt`), in
   * one library write — the engine can confirm many books in a single run.
   *
   * Field-scoped by contract: the stamp is applied to the LIVE library rows, not
   * to the snapshots the engine captured when the run started. A sync can take
   * minutes, and writing whole snapshots back would roll back any progress or
   * metadata the user saved while it was running.
   */
  markBooksUploaded(hashes: string[], uploadedAt: number): Promise<void>;
  /**
   * Apply a peer's deletion locally: remove this device's managed copy of the
   * book file and persist the tombstone (`book.deletedAt`) so the book drops
   * off the shelf and stops being re-uploaded. External / in-place sources are
   * never touched — only the app-managed `Books/<hash>/` copy is removed.
   */
  deleteBookLocally(book: Book): Promise<Book | void>;
  /** Latest persisted lifecycle; sync snapshots cannot authorize a later deletion. */
  getCurrentBook?(hash: string): Promise<Book | undefined>;
  acknowledgeRemoval?(book: Book, backend: string, status: 'complete' | 'failed'): Promise<void>;
  withCurrentRemoval?(book: Book, action: () => Promise<void>): Promise<boolean>;
  /** Hold the book's lifecycle across the entire native streaming write. */
  withBookFileWrite?<T>(book: Book, action: () => Promise<T>): Promise<T>;
}
