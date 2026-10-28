import type { Book, BookImportProgress, BookLookupIndex } from '@/types/book';
import type { AppService, OsPlatform } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import { transferManager } from '@/services/transferManager';
import { isReadestCloudStorageActive } from '@/services/sync/cloudSyncProvider';
import { normalizeFilePathForIndex } from '@/services/bookService';

export interface IngestFileDeps {
  appService: AppService;
  settings: SystemSettings;
  isLoggedIn: boolean;
  /**
   * Pre-resolved absolute path to Readest's own `Books/` directory. When
   * provided, any source file already living under this prefix is excluded
   * from in-place import (it is, by definition, a hash copy we wrote). The
   * caller is expected to resolve it once per batch via
   * `appService.fs.getPrefix('Books')` instead of paying the async cost
   * per ingested file. Omit (or pass null) on contexts where the lookup is
   * unavailable — in-place decisions will then proceed without this guard.
   */
  appBooksPrefix?: string | null;
}

export interface IngestFileOptions {
  /** A file path (desktop/mobile) or a File object (web). */
  file: File | string;
  markdownResourceRoot?: string;
  /** Current library, used by importBook for dedup. */
  books: Book[];
  /** Pre-built lookup index for O(1) dedup during batch imports. */
  lookupIndex?: BookLookupIndex;
  /** Collection to place the book in. */
  groupId?: string;
  groupName?: string;
  /** Tag parsed from a Send-to-Readest email subject (`#scifi`). */
  subjectTag?: string;
  /** Upload to the cloud even when the user has turned off book sync. */
  forceUpload?: boolean;
  /** Transient import (not stored long-term) — never uploaded. */
  transient?: boolean;
  /**
   * Opt out of automatic in-place import even when the source file lives under
   * the user's custom root directory. Forces the legacy behavior of copying
   * the file into Books/<hash>/. Defaults to false.
   */
  forceCopy?: boolean;
  /** Explicit re-imports may resume PDF contents; background folder scans opt out. */
  retryPDFContents?: boolean;
  onResult?: (status: 'added' | 'existing') => void;
  onProgress?: (progress: BookImportProgress) => void;
  /** Called as soon as this input has durably completed, independently of other inputs. */
  onComplete?: (result: IngestFileResult) => void;
  signal?: AbortSignal;
}

/**
 * Decide whether `file` should be imported in-place (read directly from its
 * source location) instead of copied into Books/<hash>/.
 *
 * Conditions (all must hold):
 *   - `file` is an absolute path string (not a File / blob / URL / content URI).
 *   - The path lives under one of the user's registered in-place roots
 *     (`settings.externalLibraryFolders`) — directories the user has
 *     explicitly told Readest to read in place. The Readest data location
 *     (`customRootDir`) is intentionally NOT an in-place trigger; that
 *     directory is Readest's own home and may freely contain hash copies.
 *   - The path is NOT inside Readest's own managed books directory
 *     (`appBooksPrefix`, e.g. `<AppData>/Books/`). Anything in that subtree
 *     is a hash copy under Readest's control, no point marking it in-place.
 *     We compare against the actual app data path rather than rejecting any
 *     `<root>/Books/` segment — users routinely have unrelated folders named
 *     `Books` inside their library roots (Baidu Netdisk's default layout,
 *     Calibre exports, etc.) and those must still go in-place.
 *   - Caller did not request `transient` (transient already opts out of
 *     copying via its own filePath path) or `forceCopy`.
 *
 * Returns false in any other case, including web (File objects), URLs, and
 * relative paths.
 *
 * Known limitation: symlinks are not resolved. A registered root of
 * `/Users/me/Library` will NOT match a file accessed through a sibling
 * symlink like `/Users/me/LibrarySymlink/sample.epub` even when both point
 * at the same on-disk directory. Adding best-effort realpath resolution
 * requires async I/O and a cross-platform `realpath` capability on
 * `FileSystem`, which is out of scope for this change.
 */
function shouldImportInPlace(
  file: File | string,
  opts: Pick<IngestFileOptions, 'transient' | 'forceCopy'>,
  inPlaceRoots: string[],
  osPlatform: OsPlatform,
  appBooksPrefix: string | null,
): boolean {
  if (opts.transient || opts.forceCopy) return false;
  if (typeof file !== 'string') return false;
  if (inPlaceRoots.length === 0) return false;

  // Absolute path check that works for POSIX and Windows without pulling in
  // node:path (this code also runs in the renderer on web/mobile builds).
  const isWindowsDrive = /^[A-Za-z]:[\\/]/.test(file);
  const isAbs = file.startsWith('/') || isWindowsDrive || file.startsWith('\\\\');
  if (!isAbs) return false;

  // Reject anything that smells like a URL or content URI. Windows drive
  // letters (`C:\…`) match a "scheme:rest" shape too, so exclude them
  // explicitly — `isWindowsDrive` already vouched for those.
  if (!isWindowsDrive && /^[a-z][a-z0-9+.-]*:/i.test(file)) return false;

  // macOS (APFS/HFS+ default), iOS, and Windows ship case-insensitive
  // filesystems out of the box, so `/Users/me/Library` and
  // `/users/me/library` must compare equal there. Linux and Android are
  // case-sensitive and stay strict. We do not attempt unicode normalization
  // (NFC/NFD) — APFS handles that at the FS layer and `toLocaleLowerCase`
  // with the wrong locale would introduce its own bugs (e.g. Turkish `İ`).
  //
  // Defer the actual canonicalization to `normalizeFilePathForIndex` so the
  // path index (`BookLookupIndex.byFilePath`) and this in-place decision
  // agree on what counts as the same path — otherwise a re-import could
  // hit the in-place branch here but miss the fast-path dedup in
  // importBook (or vice versa).
  const norm = (p: string) => normalizeFilePathForIndex(p, osPlatform);
  const target = norm(file);

  // If the file already lives inside Readest's own managed books directory
  // we never want to "in-place" it: it is, by definition, a hash copy we
  // produced ourselves. Compare against the actual resolved app prefix so
  // unrelated user-owned folders that happen to be named `Books` (very
  // common in cloud-drive layouts like Baidu Netdisk's `Books/` root) are
  // left untouched and imported in-place when they fall under a registered
  // external root.
  if (appBooksPrefix) {
    const appBooks = norm(appBooksPrefix);
    if (appBooks && (target === appBooks || target.startsWith(appBooks + '/'))) {
      return false;
    }
  }

  for (const raw of inPlaceRoots) {
    if (!raw) continue;
    const root = norm(raw);
    if (!root) continue;
    // Guard against root-as-prefix-of-different-dir (`/foo` vs `/foobar`).
    if (target !== root && !target.startsWith(root + '/')) continue;
    return true;
  }
  return false;
}

/**
 * Channel-agnostic single-file ingestion. Every capture channel — local library
 * import, the /send page, the inbox drainer — calls this so a sent book behaves
 * exactly like a locally-imported one.
 *
 * The importer owns durable registration, including initial group/tag values.
 * Callers publish committed results to their views and request synchronization.
 */
export async function ingestFile(
  opts: IngestFileOptions,
  deps: IngestFileDeps,
): Promise<Book | null> {
  const { appService, settings, appBooksPrefix } = deps;

  const inPlaceRoots = settings.externalLibraryFolders ?? [];
  const inPlace = shouldImportInPlace(
    opts.file,
    opts,
    inPlaceRoots,
    appService.osPlatform,
    appBooksPrefix ?? null,
  );

  // A known path can contain a replaced edition. Every explicit import verifies bytes.
  const outcome: { status: 'added' | 'existing' } = { status: 'added' };
  const book = await appService.importBook(opts.file, opts.books, {
    lookupIndex: opts.lookupIndex,
    markdownResourceRoot: opts.markdownResourceRoot,
    transient: opts.transient,
    inPlace,
    signal: opts.signal,
    retryPDFContents: opts.retryPDFContents,
    onProgress: opts.onProgress,
    initialGroup:
      opts.groupId !== undefined ? { id: opts.groupId, name: opts.groupName } : undefined,
    initialTags: opts.subjectTag?.trim() ? [opts.subjectTag.trim()] : undefined,
    onResult: (result) => {
      outcome.status = result;
    },
  });
  if (!book) return null;
  opts.onResult?.(outcome.status);
  return finalizeIngest(book, opts, deps, outcome.status);
}

export interface IngestFileResult {
  book: Book | null;
  status: 'added' | 'existing';
  error?: Error;
}

function notifyComplete(opts: IngestFileOptions, result: IngestFileResult): void {
  try {
    opts.onComplete?.(result);
  } catch {
    // An observer cannot turn a committed book into a failed import.
  }
}

function finalizeIngest(
  book: Book,
  opts: IngestFileOptions,
  deps: IngestFileDeps,
  status: 'added' | 'existing',
): Book {
  if (status === 'existing') return book;
  if (opts.groupId !== undefined) {
    if (book.groupId !== opts.groupId || book.groupName !== opts.groupName)
      book.groupUpdatedAt = Date.now();
    book.groupId = opts.groupId;
    book.groupName = opts.groupName;
  }
  const tag = opts.subjectTag?.trim();
  if (tag) {
    const tags = book.tags ?? [];
    if (!tags.includes(tag)) {
      book.tags = [...tags, tag];
      book.updatedAt = Date.now();
      book.metadataUpdatedAt = book.updatedAt;
    }
  }
  if (
    !opts.transient &&
    deps.isLoggedIn &&
    !book.uploadedAt &&
    (opts.forceUpload || deps.settings.syncCategories?.book !== false) &&
    isReadestCloudStorageActive(deps.settings)
  ) {
    transferManager.queueUpload(book);
  }
  return book;
}

export async function ingestFiles(
  items: IngestFileOptions[],
  deps: IngestFileDeps,
): Promise<IngestFileResult[]> {
  if (!items.length) return [];
  if (typeof deps.appService.importBooks !== 'function') {
    return Promise.all(
      items.map(async (opts) => {
        let status: 'added' | 'existing' = 'added';
        try {
          const book = await ingestFile(
            {
              ...opts,
              onResult: (result) => {
                status = result;
                opts.onResult?.(result);
              },
            },
            deps,
          );
          const result = { book, status };
          notifyComplete(opts, result);
          return result;
        } catch (error) {
          const result = {
            book: null,
            status,
            error: error instanceof Error ? error : new Error(String(error)),
          };
          notifyComplete(opts, result);
          return result;
        }
      }),
    );
  }
  const outcomes = items.map(() => ({ status: 'added' as 'added' | 'existing' }));
  const delivered = new Map<number, IngestFileResult>();
  const deliver = (
    index: number,
    result: Awaited<ReturnType<AppService['importBooks']>>[number],
  ) => {
    const previous = delivered.get(index);
    if (previous) return previous;
    const opts = items[index]!;
    const status = outcomes[index]!.status;
    const completed: IngestFileResult = {
      book: result.book ? finalizeIngest(result.book, opts, deps, status) : null,
      status,
      ...(result.error ? { error: result.error } : {}),
    };
    delivered.set(index, completed);
    notifyComplete(opts, completed);
    return completed;
  };
  const inPlaceRoots = deps.settings.externalLibraryFolders ?? [];
  const inputs = items.map((opts, index) => ({
    file: opts.file,
    options: {
      lookupIndex: opts.lookupIndex,
      markdownResourceRoot: opts.markdownResourceRoot,
      transient: opts.transient,
      inPlace: shouldImportInPlace(
        opts.file,
        opts,
        inPlaceRoots,
        deps.appService.osPlatform,
        deps.appBooksPrefix ?? null,
      ),
      signal: opts.signal,
      retryPDFContents: opts.retryPDFContents,
      onProgress: opts.onProgress,
      onComplete: (result: Awaited<ReturnType<AppService['importBooks']>>[number]) =>
        deliver(index, result),
      initialGroup:
        opts.groupId !== undefined ? { id: opts.groupId, name: opts.groupName } : undefined,
      initialTags: opts.subjectTag?.trim() ? [opts.subjectTag.trim()] : undefined,
      onResult: (result: 'added' | 'existing') => {
        outcomes[index]!.status = result;
        opts.onResult?.(result);
      },
    },
  }));
  const imported = await deps.appService.importBooks(inputs, items[0]!.books);
  // Compatibility adapters may return results without emitting events.
  return imported.map((result, index) => deliver(index, result));
}
