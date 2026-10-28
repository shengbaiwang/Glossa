import { SystemSettings } from '@/types/settings';
import { archiveRemoval } from './bookRemovalState';
import { activateBookData, withBookDataWrite } from './bookDataLifecycle';
import { bookNoteEdits } from './bookDataConflicts';
import { FileSystem, AppPlatform, BaseDir, OsPlatform } from '@/types/system';
import {
  Book,
  BookConfig,
  BookContent,
  BookFormat,
  BookImportInput,
  BookImportProgress,
  BookImportResult,
  BookLookupIndex,
  FIXED_LAYOUT_FORMATS,
  ImportBookOptions,
} from '@/types/book';
import {
  getDir,
  getLocalBookFilename,
  getCoverFilename,
  getConfigFilename,
  getBookNavFilename,
  INIT_BOOK_CONFIG,
  formatTitle,
  formatAuthors,
  getPrimaryLanguage,
  getMetadataHash,
} from '@/utils/book';
import type { BookNav } from '@/services/nav';
import { partialMD5, md5 } from '@/utils/md5';
import { getBaseFilename, getFilename, getFolderImportGroupName } from '@/utils/path';
import { BookDoc, DocumentLoader } from '@/libs/document';

import { tryNativeParseEpub } from '@/utils/tauriEpubBridge';
import { tryNativeParseMobi } from '@/utils/tauriMobiBridge';
import { isPseStreamFileName, openPseStreamBook, parsePseStreamFileName } from './opds/pseStream';
import { DEFAULT_BOOK_SEARCH_CONFIG, DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS } from './constants';
import { isContentURI, isValidURL, makeSafeFilename } from '@/utils/misc';
import { deserializeConfig, serializeConfig, serializeRawConfig } from '@/utils/serializer';
import { ClosableFile } from '@/utils/file';
import { TxtToEpubConverter } from '@/utils/txt';
import { svg2png } from '@/utils/svg';
import { normalizeMetadataIsbn } from '@/utils/isbn';
import { resolveImportedMetadata } from '@/utils/importMetadata';
import { BookFileNotFoundError } from './errors';
import { snapshotMarkdownImport } from './markdownImport';
import { fingerprintFile, fingerprintPath, contentIdentity } from './bookIdentity';
import { withLibraryLock } from './libraryLock';
import { notifyLibraryUpdated } from '@/utils/libraryEvents';
import { mergeLibraryBook, saveLibraryBooksUnlocked } from './libraryService';
import { loadLibraryRows } from './libraryRepository';
import { importResourceGate, runImportTasks, type ImportResourceLease } from './importTaskQueue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  isBookFileContentSource,
  resolveBookContentSource,
  type BookFileContentSource,
  type BookContentSource,
} from './bookContent';

export function buildBookLookupIndex(books: Book[], osPlatform?: OsPlatform): BookLookupIndex {
  const byHash = new Map<string, Book>();
  const byContentFingerprint = new Map<string, Book[]>();
  const byMetaKey = new Map<string, Book[]>();
  const byFilePath = new Map<string, Book>();
  for (const book of books) {
    byHash.set(book.hash, book);
    const identity = contentIdentity(book);
    if (identity) {
      const list = byContentFingerprint.get(identity);
      if (list) list.push(book);
      else byContentFingerprint.set(identity, [book]);
    }
    if (book.metaHash && !book.deletedAt) {
      const key = `${book.metaHash}:${book.format}`;
      const list = byMetaKey.get(key);
      if (list) list.push(book);
      else byMetaKey.set(key, [book]);
    }
    // Paths are discovery hints. Reimport must still verify actual file bytes.
    if (book.filePath && !isValidURL(book.filePath) && !book.deletedAt) {
      const key = normalizeFilePathForIndex(book.filePath, osPlatform);
      if (key) byFilePath.set(key, book);
    }
  }
  return { byHash, byContentFingerprint, byMetaKey, byFilePath };
}

/**
 * Normalize an absolute file path into a stable map key for `byFilePath`.
 *
 * Mirrors the same rules `ingestService.shouldImportInPlace` uses to compare
 * paths against the user's in-place roots so both sides agree on whether a
 * given source file matches a previously-indexed book:
 *   - Backslashes are normalized to `/`.
 *   - Trailing slashes are stripped.
 *   - On case-insensitive filesystems (macOS / iOS / Windows) the key is
 *     lowercased. Linux / Android keep the original casing.
 *
 * Returns an empty string for non-string / falsy input so callers can do a
 * `if (key) map.set(key, …)` guard without an extra null check.
 */
export function normalizeFilePathForIndex(path: string, osPlatform?: OsPlatform): string {
  if (!path) return '';
  const caseInsensitive =
    osPlatform === 'macos' || osPlatform === 'ios' || osPlatform === 'windows';
  const n = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return caseInsensitive ? n.toLowerCase() : n;
}

export interface ScannedFileEntry {
  /** Absolute path, already joined with the folder root. */
  fullPath: string;
  /** File size in bytes. */
  size: number;
}

/**
 * From a folder scan, keep only entries that (a) match one of `extensions`
 * (lowercased, no leading dot), (b) are at least `minSizeBytes`, and (c) are
 * NOT already in the library. Membership is tested against `existingPaths`,
 * which the caller builds from `buildBookLookupIndex(...).byFilePath.keys()`
 * (those keys are already normalized by `normalizeFilePathForIndex`, so we
 * normalize each scanned path the same way before comparing). Pure — no I/O.
 */
export function selectNewImportableFiles(
  entries: ScannedFileEntry[],
  opts: {
    extensions: string[];
    minSizeBytes: number;
    existingPaths: Set<string>;
    osPlatform?: OsPlatform;
  },
): ScannedFileEntry[] {
  const exts = new Set(opts.extensions.map((e) => e.toLowerCase()));
  return entries.filter((entry) => {
    const ext = entry.fullPath.split('.').pop()?.toLowerCase() ?? '';
    if (!exts.has(ext)) return false;
    if (opts.minSizeBytes > 0 && entry.size < opts.minSizeBytes) return false;
    const key = normalizeFilePathForIndex(entry.fullPath, opts.osPlatform);
    return !!key && !opts.existingPaths.has(key);
  });
}

/**
 * Turn the newly-found entries of one watched folder into importer inputs.
 *
 * `flatten` mirrors the Import-from-Folder dialog's "Folder Structure" choice
 * for that folder. In the default "Create groups from subfolders" mode every
 * file carries the watched folder as `basePath` — that hint is what makes
 * `importBooks` derive a group from the subfolder the file lives in. Without it
 * auto-imported books piled up in the library root while the same folder's
 * initial import stayed grouped (issue #5423). Flattening removes only the
 * subfolder hierarchy: the chosen folder's own name remains the destination.
 */
export function toWatchedFolderImports(
  folder: string,
  entries: ScannedFileEntry[],
  flatten: boolean,
  groupPath?: string,
): Array<{ path: string; basePath?: string; groupName?: string }> {
  const root = getFilename(folder.replace(/[\\/]+$/, ''));
  return entries.map(({ fullPath }) => {
    if (flatten) return { path: fullPath, groupName: groupPath ?? root };
    if (groupPath !== undefined) {
      const relative = getFolderImportGroupName(fullPath, folder)
        .slice(root.length)
        .replace(/^\//, '');
      return { path: fullPath, groupName: [groupPath, relative].filter(Boolean).join('/') };
    }
    return { path: fullPath, basePath: folder };
  });
}

/**
 * Collect all known local source paths from the library into a normalized set.
 *
 * Unlike `buildBookLookupIndex(...).byFilePath`, this includes soft-deleted
 * books (`deletedAt` set) so that auto-import does not resurrect a book the
 * user intentionally removed from their library. `altFilePaths` is included
 * alongside `filePath`: several files in a watched folder can dedup into one
 * book (same bytes under two names, or two files sharing a metaHash), and a
 * path the importer folded away is just as "known" as the one it kept.
 *
 * URL-backed entries (remote books) are excluded — only on-disk paths matter.
 */
export function collectKnownSourcePaths(books: Book[], osPlatform?: OsPlatform): Set<string> {
  const paths = new Set<string>();
  for (const book of books) {
    for (const path of [book.filePath, ...(book.altFilePaths ?? [])]) {
      if (!path || isValidURL(path)) continue;
      const key = normalizeFilePathForIndex(path, osPlatform);
      if (key) paths.add(key);
    }
  }
  return paths;
}

/**
 * Move `book.filePath` into `book.altFilePaths` because `nextFilePath` is about
 * to take its place.
 *
 * The newest path always wins the `filePath` slot — that is what makes a rename
 * recoverable (the old name is gone from disk, the new one is where the bytes
 * are). Without this the displaced path would simply be forgotten, and the
 * auto-import scan would rediscover it as a "new" file on the next pass,
 * re-import it, displace the current path in turn, and ping-pong forever.
 *
 * Idempotent: entries are deduplicated by normalized key and `nextFilePath` is
 * never kept as its own alternative.
 */
function displaceSourcePath(book: Book, nextFilePath: string, osPlatform?: OsPlatform): void {
  const nextKey = normalizeFilePathForIndex(nextFilePath, osPlatform);
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const path of [book.filePath, ...(book.altFilePaths ?? [])]) {
    if (!path || isValidURL(path)) continue;
    const key = normalizeFilePathForIndex(path, osPlatform);
    if (!key || key === nextKey || seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
  }
  book.altFilePaths = paths.length > 0 ? paths : undefined;
}

export interface CoverContext {
  fs: FileSystem;
  appPlatform: AppPlatform;
  localBooksDir: string;
}

export function getCoverImageUrl(ctx: CoverContext, book: Book): string {
  return ctx.fs.getURL(`${ctx.localBooksDir}/${getCoverFilename(book)}`);
}

export async function getCoverImageBlobUrl(ctx: CoverContext, book: Book): Promise<string> {
  return ctx.fs.getBlobURL(`${ctx.localBooksDir}/${getCoverFilename(book)}`, 'None');
}

export async function getCachedImageUrl(ctx: CoverContext, pathOrUrl: string): Promise<string> {
  const cachedKey = `img_${md5(pathOrUrl)}`;
  const cachePrefix = await ctx.fs.getPrefix('Cache');
  const cachedPath = `${cachePrefix}/${cachedKey}`;
  if (await ctx.fs.exists(cachedPath, 'None')) {
    return await ctx.fs.getImageURL(cachedPath);
  } else {
    const file = await ctx.fs.openFile(pathOrUrl, 'None');
    await ctx.fs.writeFile(cachedKey, 'Cache', await file.arrayBuffer());
    return await ctx.fs.getImageURL(cachedPath);
  }
}

export async function generateCoverImageUrl(ctx: CoverContext, book: Book): Promise<string> {
  return ctx.appPlatform === 'web'
    ? await getCoverImageBlobUrl(ctx, book)
    : getCoverImageUrl(ctx, book);
}

function imageToArrayBuffer(
  ctx: CoverContext,
  imageUrl?: string,
  imageFile?: string,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (!imageUrl && !imageFile) {
      reject(new Error('No image URL or file provided'));
      return;
    }
    if (ctx.appPlatform === 'web' && imageUrl && imageUrl.startsWith('blob:')) {
      fetch(imageUrl)
        .then((response) => response.arrayBuffer())
        .then(resolve)
        .catch(reject);
    } else if (ctx.appPlatform === 'tauri' && imageFile) {
      ctx.fs
        .openFile(imageFile, 'None')
        .then((file) => file.arrayBuffer())
        .then(resolve)
        .catch(reject);
    } else if (ctx.appPlatform === 'tauri' && imageUrl) {
      tauriFetch(imageUrl, { method: 'GET' })
        .then((response) => response.arrayBuffer())
        .then(resolve)
        .catch(reject);
    } else {
      reject(new Error('Unsupported platform or missing image data'));
    }
  });
}

export async function updateCoverImage(
  ctx: CoverContext,
  book: Book,
  imageUrl?: string,
  imageFile?: string,
): Promise<void> {
  if (imageUrl === '_blank') {
    await withBookDataWrite(book.hash, book.removal?.revision ?? 0, () =>
      ctx.fs.removeFile(getCoverFilename(book), 'Books'),
    );
  } else if (imageUrl || imageFile) {
    const arrayBuffer = await imageToArrayBuffer(ctx, imageUrl, imageFile);
    await withBookDataWrite(book.hash, book.removal?.revision ?? 0, () =>
      ctx.fs.writeFile(getCoverFilename(book), 'Books', arrayBuffer),
    );
  }
}

/**
 * Partial MD5 of the local cover.png, or null when the cover is absent. This is
 * the content-addressed cover-change signal for cross-device sync (issue
 * #4544): keeping `book.coverHash === computeCoverHash(book)` lets a peer
 * re-download the cover iff the synced hash differs from the local one. An
 * identical (re-extracted / re-imported) cover yields the same hash, so there
 * is no re-sync churn.
 */
export async function computeCoverHash(fs: FileSystem, book: Book): Promise<string | null> {
  if (!(await fs.exists(getCoverFilename(book), 'Books'))) return null;
  const coverFile = await fs.openFile(getCoverFilename(book), 'Books');
  return partialMD5(coverFile);
}

// --- Book Import ---

/**
 * Options consumed by bookService.importBook. Extends the user-facing
 * ImportBookOptions with the required AppService callbacks that are bound by
 * the AppService wrapper.
 */
export interface ImportBookInternalOptions extends ImportBookOptions {
  saveBookConfig: (book: Book, config: BookConfig) => Promise<void>;
  generateCoverImageUrl: (book: Book) => Promise<string>;
  preparePDF?: (book: Book, document: BookDoc | undefined, signal?: AbortSignal) => Promise<void>;
  /** Only used to fall back when an early duplicate changes before commit. */
  skipKnownContent?: boolean;
  /** Normalizes device-local source path hints consistently with the lookup index. */
  osPlatform?: OsPlatform;
}

interface ImportCommitContext {
  disk: Book[];
  current: Map<string, Book>;
  index: BookLookupIndex;
  changes: Book[];
  publish: Array<() => Book>;
}

class ImportNeedsStage extends Error {}

function mergeImportSnapshot(disk: Book, live: Book): Book {
  return {
    ...mergeLibraryBook(disk, live),
    contentFingerprint: live.contentFingerprint ?? disk.contentFingerprint,
    storedContentFingerprint: live.storedContentFingerprint ?? disk.storedContentFingerprint,
    ...((disk.duplicateUpdatedAt ?? 0) > (live.duplicateUpdatedAt ?? 0)
      ? { duplicateOf: disk.duplicateOf, duplicateUpdatedAt: disk.duplicateUpdatedAt }
      : {}),
  };
}

interface LegacyImportProof {
  rowVersion: string;
  source: BookContentSource;
  sourceVersion: string;
  identity?: string;
}

function legacyRowVersion(book: Book): string {
  return JSON.stringify([
    book.hash,
    book.format,
    book.updatedAt,
    book.filePath,
    book.url,
    book.contentFingerprint,
    book.storedContentFingerprint,
    book.deletedAt,
    book.duplicateOf,
    book.duplicateUpdatedAt,
    book.removal,
    book.localRemoval,
  ]);
}

/** Metadata-only validation is safe inside the short publication transaction. */
async function legacySourceVersion(fs: FileSystem, source: BookContentSource): Promise<string> {
  if (source.kind !== 'managed') return JSON.stringify(source);
  try {
    if (typeof fs.stats === 'function') {
      const stat = await fs.stats(source.path, source.base);
      return JSON.stringify([source, stat.isFile, stat.size, stat.mtime, stat.birthtime]);
    }
    const file = await fs.openFile(source.path, source.base);
    try {
      return JSON.stringify([source, file.size, file.lastModified]);
    } finally {
      await (file as Partial<ClosableFile>).close?.();
    }
  } catch {
    return JSON.stringify([source, 'unavailable']);
  }
}

interface PreparedBookImport {
  stage: (force?: boolean) => Promise<void>;
  commit: (context?: ImportCommitContext) => Promise<Book>;
  discardStaging: () => Promise<void>;
  release: () => Promise<void>;
  schedule: (book: Book) => Promise<void>;
}

async function prepareBookImport(
  fs: FileSystem,
  // file might be:
  // 1.1 absolute path for local file on Desktop
  // 1.2 /private/var inbox file path on iOS
  // 2. remote url
  // 3. content provider uri
  // 4. File object from browsers
  file: string | File,
  books: Book[],
  options: ImportBookInternalOptions,
  sharedLease?: ImportResourceLease,
): Promise<PreparedBookImport> {
  const {
    saveBookConfig: saveBookConfigFn,
    generateCoverImageUrl: generateCoverImageUrlFn,
    saveBook = true,
    saveCover = true,
    overwrite = false,
    transient = false,
    inPlace: requestedInPlace = false,
    lookupIndex,
    osPlatform,
  } = options;
  let inPlace = requestedInPlace;
  const isPseStream = typeof file === 'string' && isPseStreamFileName(file);

  let loadedBook: BookDoc | undefined;
  let fileobj: File | undefined;
  let originalFile: File | undefined;
  let contentFingerprint: string | undefined;
  const stageDirectory = `.importing/${crypto.randomUUID()}`;
  let stagedBookPath: string | undefined;
  let stagedCover: Blob | null | undefined;
  let coverPrepared = false;
  let inPlaceVerified = false;
  let released = false;
  let resourceLease = sharedLease;
  const reserveResources = async (size?: number) => {
    if (resourceLease) return;
    options.onProgress?.({ stage: 'waiting', elapsedMs: 0 });
    resourceLease = await importResourceGate.acquire(size, options.signal);
    options.onProgress?.({ stage: 'fingerprinting', elapsedMs: 0 });
  };
  const releaseResources = async () => {
    if (released) return;
    released = true;
    try {
      await loadedBook?.destroy?.();
    } catch (error) {
      console.warn('Error destroying book document:', error);
    }
    if (originalFile && originalFile !== fileobj) {
      try {
        await (originalFile as Partial<ClosableFile>).close?.();
      } catch {}
    }
    const current = fileobj as ClosableFile | undefined;
    if (current?.close) {
      try {
        await current.close();
      } catch {}
    }
    resourceLease?.release();
  };
  try {
    let format: BookFormat;
    let filename: string;
    // When the Rust EPUB parser succeeds it gives us the partialMD5 for free,
    // so we can short-circuit the JS hashing pass below.
    let nativeHash: string | undefined;
    let usedNativeParser = false;

    if (transient && typeof file !== 'string') {
      throw new Error('Transient import is only supported for file paths');
    }

    try {
      if (isPseStream) {
        await reserveResources();
        const data = parsePseStreamFileName(file as string);
        ({ book: loadedBook, format } = await openPseStreamBook(data));
        filename = file as string;
      } else {
        if (typeof file === 'string') {
          fileobj = await fs.openFile(file, 'None');
          filename = fileobj.name || getFilename(file);
        } else {
          fileobj = file;
          filename = file.name;
        }
        originalFile = fileobj;
        await reserveResources(fileobj.size);
        options.signal?.throwIfAborted();
        if (/\.(?:md|markdown)$/i.test(filename)) {
          // Markdown is an immutable reading snapshot, even in a watched folder.
          inPlace = false;
          if (typeof file === 'string' && options.markdownResourceRoot)
            fileobj = await snapshotMarkdownImport(
              fs,
              fileobj,
              file,
              options.markdownResourceRoot,
              options.signal,
            );
        }
        contentFingerprint =
          fileobj === originalFile && typeof file === 'string'
            ? await fingerprintPath(fs, file, 'None', options.signal)
            : await fingerprintFile(fileobj, options.signal);
        // Full identity is known before conversion, unpacking or cover work.
        // Missing, removed and in-place books retain the normal recovery path.
        if (!transient && !inPlace && !overwrite && saveBook && !options.skipKnownContent) {
          const known = (
            lookupIndex?.byContentFingerprint.get(contentFingerprint) ??
            books.filter((book) => contentIdentity(book) === contentFingerprint)
          )
            .filter(
              (book) =>
                !book.deletedAt &&
                !book.duplicateOf &&
                ![book.removal, book.localRemoval].some(
                  (intent) => intent && intent.local !== 'complete',
                ),
            )
            .sort((a, b) => a.createdAt - b.createdAt || a.hash.localeCompare(b.hash));
          for (const candidate of known) {
            if (!(await fs.exists(getLocalBookFilename(candidate), 'Books'))) continue;
            let replacement: PreparedBookImport | undefined;
            const stageKnown = async (force = false) => {
              if (!force) return;
              replacement ??= await prepareBookImport(
                fs,
                file,
                books,
                { ...options, skipKnownContent: true },
                resourceLease,
              );
              await replacement.stage(true);
            };
            return {
              stage: stageKnown,
              commit: async (context) => {
                if (replacement) return replacement.commit(context);
                options.signal?.throwIfAborted();
                const latest = context?.current.get(candidate.hash);
                if (
                  !context ||
                  !latest ||
                  latest.deletedAt ||
                  latest.duplicateOf ||
                  contentIdentity(latest) !== contentFingerprint ||
                  [latest.removal, latest.localRemoval].some(
                    (intent) => intent && intent.local !== 'complete',
                  ) ||
                  !(await fs.exists(getLocalBookFilename(latest), 'Books'))
                )
                  throw new ImportNeedsStage();
                const target = { ...latest };
                if (typeof file === 'string') {
                  if (isValidURL(file)) target.url ??= file;
                  else target.altFilePaths = [...new Set([...(target.altFilePaths ?? []), file])];
                }
                target.coverImageUrl = await generateCoverImageUrlFn(target);
                options.signal?.throwIfAborted();
                context.current.set(target.hash, target);
                context.index.byHash.set(target.hash, target);
                context.changes.push(target);
                context.publish.push(() => {
                  const live = books.find((book) => book.hash === target.hash);
                  const result = live ? Object.assign(live, target) : target;
                  if (!live) books.push(result);
                  if (lookupIndex) {
                    lookupIndex.byHash.set(result.hash, result);
                    lookupIndex.byContentFingerprint.set(
                      contentFingerprint!,
                      (lookupIndex.byContentFingerprint.get(contentFingerprint!) ?? [result]).map(
                        (row) => (row.hash === result.hash ? result : row),
                      ),
                    );
                  }
                  try {
                    options.onResult?.('existing');
                  } catch {
                    /* Isolate observers. */
                  }
                  return result;
                });
                return target;
              },
              discardStaging: async () => {
                await replacement?.discardStaging();
              },
              release: async () => {
                await replacement?.release();
                await releaseResources();
              },
              schedule: async (result) => {
                if (replacement) await replacement.schedule(result);
                await releaseResources();
                if (replacement) return;
                if (
                  result.format === 'PDF' &&
                  options.retryPDFContents !== false &&
                  options.preparePDF
                )
                  try {
                    void options.preparePDF(result, undefined, options.signal).catch(() => {});
                  } catch {
                    /* Optional task. */
                  }
              },
            };
          }
        }
        if (/\.txt$/i.test(filename)) {
          const txt2epub = new TxtToEpubConverter();
          ({ file: fileobj } = await txt2epub.convert({ file: fileobj }));
        }
        if (!fileobj || fileobj.size === 0) {
          throw new Error('Invalid or empty book file');
        }
        // Q1 fast path: when running under Tauri with a real file
        // path, let Rust contribute the mechanical parts of the
        // import work — partialMD5 over the file, the downscaled
        // cover, and (for EPUB) the raw OPF bytes. Metadata
        // extraction itself runs through foliate-js so the import
        // path produces the same `Book.metadata` shape the reader
        // path does (`refines` chains / ONIX5 / language maps / EPUB
        // `belongs-to-collection` for EPUB; PalmDB UID identifier
        // for MOBI), without any `DocumentLoader.open()` overhead —
        // the importer never reads sections / toc / fixed-layout
        // detection, so spending CPU on a zip central-directory
        // scan, nav/ncx inflate, or PDB record-table walk would be
        // pure waste here.
        //
        // Both bridges are no-ops on web / non-eligible paths, so
        // the cost when neither matches is just two cheap regex
        // tests.
        let nativeBookDoc: BookDoc | undefined;
        let nativeFormat: BookFormat | undefined;
        options.onProgress?.({ stage: 'parsing', elapsedMs: 0 });
        if (typeof file === 'string' && !/\.txt$/i.test(filename)) {
          const nativeEpub = await tryNativeParseEpub(file);
          if (nativeEpub) {
            nativeBookDoc = nativeEpub.bookDoc;
            nativeFormat = 'EPUB' as BookFormat;
            nativeHash = nativeEpub.partialMd5;
          } else {
            const nativeMobi = await tryNativeParseMobi(file, fileobj);
            if (nativeMobi) {
              nativeBookDoc = nativeMobi.bookDoc;
              nativeFormat = nativeMobi.format;
              nativeHash = nativeMobi.partialMd5;
            }
          }
        }
        if (nativeBookDoc && nativeFormat) {
          loadedBook = nativeBookDoc;
          format = nativeFormat;
          usedNativeParser = true;
        } else {
          ({ book: loadedBook, format } = await new DocumentLoader(fileobj, {
            loadPDFCache: false,
            importOnly: true,
          }).open());
        }
      }
      if (!loadedBook) {
        throw new Error('Unsupported or corrupted book file');
      }
      normalizeMetadataIsbn(loadedBook.metadata);
    } catch (error) {
      options.signal?.throwIfAborted();
      throw new Error(`Failed to open the book file: ${(error as Error).message || error}`);
    }

    const legacyHash = isPseStream
      ? md5(file as string)
      : usedNativeParser
        ? nativeHash!
        : await partialMD5(fileobj!);

    // Metadata remains a legacy candidate hint; only a full fingerprint deduplicates.
    const importedMetadata = resolveImportedMetadata(
      loadedBook.metadata,
      isPseStream ? '' : filename,
      format,
    );
    const identityMetadata = {
      ...loadedBook.metadata,
      ...(importedMetadata.usesFilename ? { title: importedMetadata.title } : {}),
      ...(importedMetadata.author !==
      formatAuthors(loadedBook.metadata.author, getPrimaryLanguage(loadedBook.metadata.language))
        ? { author: importedMetadata.author }
        : {}),
    };
    const metaHash = getMetadataHash(
      identityMetadata,
      format === 'PDF' ? getBaseFilename(filename) : undefined,
    );
    const parsedBook = loadedBook;
    const storedContentFingerprint =
      originalFile && fileobj !== originalFile
        ? await fingerprintFile(fileobj!, options.signal)
        : contentFingerprint;
    const legacyProofs = new Map<string, LegacyImportProof>();
    const pendingLegacy = new Map<string, Book>();
    for (const candidate of books) {
      if (
        !contentIdentity(candidate) &&
        (candidate.hash === legacyHash ||
          (metaHash && candidate.metaHash === metaHash && candidate.format === format))
      )
        pendingLegacy.set(candidate.hash, structuredClone(candidate));
    }
    const stage = async (force = false) => {
      // A newly discovered legacy candidate exits commit before any full read.
      // Recheck its row/source metadata when the next short transaction resumes.
      for (const [hash, candidate] of pendingLegacy) {
        options.signal?.throwIfAborted();
        const source = await resolveBookContentSource(fs, candidate);
        const before = await legacySourceVersion(fs, source);
        let identity: string | undefined;
        if (source.kind === 'managed') {
          options.onProgress?.({ stage: 'fingerprinting', elapsedMs: 0 });
          try {
            identity = await fingerprintPath(fs, source.path, source.base, options.signal);
          } catch {
            options.signal?.throwIfAborted();
            // Missing or unreadable original bytes cannot establish identity.
          }
        }
        const after = await legacySourceVersion(fs, source);
        if (before !== after) throw new Error('Book file changed during import. Please retry.');
        legacyProofs.set(hash, {
          rowVersion: legacyRowVersion(candidate),
          source,
          sourceVersion: after,
          identity,
        });
        pendingLegacy.delete(hash);
      }
      const likelyExisting =
        !!lookupIndex?.byContentFingerprint?.get(contentFingerprint ?? '')?.length ||
        books.some((book) => contentIdentity(book) === contentFingerprint);
      if (inPlace && originalFile && contentFingerprint && !inPlaceVerified) {
        const current = await fingerprintPath(fs, file as string, 'None', options.signal);
        if (current !== contentFingerprint)
          throw new Error('Book file changed during import. Please retry.');
        inPlaceVerified = true;
      }
      if (
        saveBook &&
        !transient &&
        !inPlace &&
        fileobj &&
        storedContentFingerprint &&
        (force || !likelyExisting) &&
        !stagedBookPath
      ) {
        await fs.createDir(stageDirectory, 'Books', true);
        const staged = `${stageDirectory}/book`;
        let verifiedDuringCopy = false;
        if (
          fileobj === originalFile &&
          typeof file === 'string' &&
          !isValidURL(file) &&
          !isContentURI(file) &&
          fs.copyFileVerified
        ) {
          const actual = await fs.copyFileVerified(
            file,
            'None',
            staged,
            'Books',
            storedContentFingerprint,
            options.signal,
          );
          if (actual !== storedContentFingerprint)
            throw new Error('Book file changed during import. Please retry.');
          verifiedDuringCopy = true;
        } else if (/\.txt$/i.test(filename)) {
          await fs.writeFile(staged, 'Books', fileobj);
        } else if (fileobj === originalFile && typeof file === 'string' && isContentURI(file)) {
          await fs.copyFile(file, 'None', staged, 'Books');
        } else if (fileobj === originalFile && typeof file === 'string' && !isValidURL(file)) {
          try {
            await fs.copyFile(file, 'None', staged, 'Books');
          } catch {
            options.signal?.throwIfAborted();
            await fs.writeFile(staged, 'Books', await fileobj.arrayBuffer());
          }
        } else {
          await fs.writeFile(staged, 'Books', fileobj);
        }
        if (!verifiedDuringCopy) {
          const actual = await fingerprintPath(fs, staged, 'Books', options.signal);
          if (actual !== storedContentFingerprint)
            throw new Error('Book file changed during import. Please retry.');
        }
        stagedBookPath = staged;
      }
      if (saveCover && (force || !likelyExisting) && !coverPrepared) {
        stagedCover = await parsedBook.getCover();
        if (stagedCover?.type === 'image/svg+xml') {
          try {
            stagedCover = await svg2png(stagedCover);
          } catch {}
        }
        coverPrepared = true;
      }
    };
    const discardStaging = async () => {
      await Promise.resolve(fs.removeDir(stageDirectory, 'Books', true)).catch(() => {});
    };
    let returnedExisting = false;
    const commit = async (context?: ImportCommitContext): Promise<Book> => {
      options.signal?.throwIfAborted();
      const disk = context ? context.disk : transient ? [] : await loadLibraryRows(fs);
      const current = context?.current ?? new Map(books.map((book) => [book.hash, book]));
      if (!context && Array.isArray(disk))
        for (const book of disk) {
          const live = current.get(book.hash);
          current.set(book.hash, live ? mergeImportSnapshot(book, live) : book);
        }
      const candidates = transient ? [] : [...current.values()];
      const commitIndex = context?.index ?? buildBookLookupIndex(candidates, osPlatform);
      const nominated = new Map<string, Book>();
      const nominate = (book: Book | undefined) => {
        if (book) nominated.set(book.hash, book);
      };
      if (contentFingerprint) {
        for (const book of commitIndex.byContentFingerprint.get(contentFingerprint) ?? [])
          nominate(book);
      }
      nominate(commitIndex.byHash.get(legacyHash));
      if (metaHash) {
        for (const book of commitIndex.byMetaKey.get(`${metaHash}:${format}`) ?? []) nominate(book);
      }
      const identityCandidates = transient ? [] : [...nominated.values()];
      let existingBook: Book | undefined;
      if (contentFingerprint) {
        const matches: Book[] = [];
        for (const candidate of identityCandidates) {
          let identity = contentIdentity(candidate);
          if (
            !identity &&
            (candidate.hash === legacyHash || (metaHash && candidate.metaHash === metaHash))
          ) {
            const proof = legacyProofs.get(candidate.hash);
            const source = await resolveBookContentSource(fs, candidate);
            const sourceVersion = await legacySourceVersion(fs, source);
            if (
              !proof ||
              proof.rowVersion !== legacyRowVersion(candidate) ||
              proof.sourceVersion !== sourceVersion ||
              JSON.stringify(proof.source) !== JSON.stringify(source)
            ) {
              pendingLegacy.set(candidate.hash, structuredClone(candidate));
              throw new ImportNeedsStage();
            }
            identity = proof.identity;
          }
          if (identity === contentFingerprint) matches.push(candidate);
        }
        matches.sort(
          (a, b) =>
            Number(!!a.deletedAt) - Number(!!b.deletedAt) ||
            Number(!!a.duplicateOf) - Number(!!b.duplicateOf) ||
            a.createdAt - b.createdAt ||
            a.hash.localeCompare(b.hash),
        );
        existingBook = matches[0];
      } else if (isPseStream) {
        existingBook = current.get(legacyHash);
      }
      // Keep established sidecar paths and anchors when verifying a legacy record.
      let hash = existingBook?.hash ?? (contentFingerprint ? md5(contentFingerprint) : legacyHash);
      let collision = 0;
      while (!existingBook && current.has(hash)) hash = md5(`${contentFingerprint}:${++collision}`);
      const storedSourceTitle = existingBook?.sourceTitle || existingBook?.title;
      const primaryLanguage = getPrimaryLanguage(parsedBook.metadata.language);
      const book: Book = {
        hash,
        format,
        metaHash,
        title: importedMetadata.title,
        originalFilename: isPseStream ? undefined : getFilename(filename),
        sourceTitle: existingBook ? storedSourceTitle : importedMetadata.title,
        contentFingerprint,
        storedContentFingerprint,
        primaryLanguage,
        author: importedMetadata.author,
        // Cached here because the library list never opens the book: it is a
        // property of the file, so it is re-derived on every (re)import rather
        // than synced as user data.
        hasNarration:
          (!!parsedBook.loadText &&
            !!parsedBook.loadBlob &&
            parsedBook.sections?.some((section) => section.mediaOverlay?.href)) ||
          undefined,
        metadata: parsedBook.metadata,
        groupId: options.initialGroup?.id,
        groupName: options.initialGroup?.name,
        groupUpdatedAt: options.initialGroup ? Date.now() : undefined,
        tags: options.initialTags,
        createdAt: existingBook ? existingBook.createdAt : Date.now(),
        uploadedAt: existingBook ? existingBook.uploadedAt : null,
        deletedAt: transient ? Date.now() : null,
        downloadedAt: Date.now(),
        updatedAt: Date.now(),
      };
      // update series info from metadata
      if (book.metadata?.belongsTo?.series) {
        const belongsTo = book.metadata.belongsTo.series;
        const series = Array.isArray(belongsTo) ? belongsTo[0] : belongsTo;
        if (series) {
          book.metadata.series = formatTitle(series.name);
          book.metadata.seriesIndex = parseFloat(series.position || '0');
          if (series.total) book.metadata.seriesTotal = parseInt(series.total, 10);
        }
      }
      // A repeated import can restore availability; personal fields and sidecars stay intact.
      const target: Book = existingBook
        ? {
            ...existingBook,
            contentFingerprint: contentFingerprint ?? existingBook.contentFingerprint,
          }
        : book;
      const wasExisting = !!existingBook && !existingBook.deletedAt;
      if (
        !transient &&
        existingBook &&
        [existingBook.removal, existingBook.localRemoval].some(
          (intent) => intent && intent.local !== 'complete',
        )
      )
        throw new Error('Finish or retry the existing removal before importing this book.');
      const bookFilename = getLocalBookFilename(target);
      const willWriteBookFile =
        saveBook &&
        !transient &&
        !inPlace &&
        !!fileobj &&
        (!existingBook || overwrite || !(await fs.exists(bookFilename, 'Books')));
      const coverRequired =
        saveCover &&
        !existingBook &&
        (!(await fs.exists(getCoverFilename(target), 'Books')) || overwrite);
      if ((willWriteBookFile && !stagedBookPath) || (coverRequired && !coverPrepared))
        throw new ImportNeedsStage();
      if (inPlace && originalFile && contentFingerprint && !inPlaceVerified)
        throw new ImportNeedsStage();
      if (existingBook?.deletedAt && !transient) {
        target.deletedAt = null;
        target.updatedAt = Date.now();
        target.removalHistory = archiveRemoval(existingBook, 'removal');
        const previous = existingBook.removal;
        target.removal = {
          version: 1,
          id: crypto.randomUUID(),
          revision: Math.max(Date.now(), (previous?.revision ?? 0) + 1),
          requestedAt: Date.now(),
          mode: 'restore',
          local: 'complete',
          cloud: previous?.cloud === 'none' || !previous ? 'none' : 'pending',
          ...(previous?.cloudTargets
            ? {
                cloudTargets: Object.fromEntries(
                  Object.keys(previous.cloudTargets).map((kind) => [kind, 'pending']),
                ),
              }
            : {}),
        };
        await activateBookData(target.hash, target.removal.revision);
      }

      // Idempotent create (recursive): a plain createDir defaults to
      // non-recursive and throws if the dir already exists, and the check-then-
      // create above races two concurrent imports of the same book — on Windows
      // the loser fails with "Cannot create a file when that file already exists"
      // (Sentry READEST-H). create_dir_all is a no-op when the dir exists.
      await fs.createDir(getDir(target), 'Books', true);
      if (willWriteBookFile && stagedBookPath) {
        if (fs.moveFile) {
          await fs.moveFile(stagedBookPath, 'Books', bookFilename, 'Books');
        } else {
          await fs.copyFile(stagedBookPath, 'Books', bookFilename, 'Books');
          await fs.removeDir(stageDirectory, 'Books', true);
        }
        stagedBookPath = undefined;
        target.storedContentFingerprint = book.storedContentFingerprint;
      }
      if (coverRequired && stagedCover) {
        const coverBytes = await stagedCover.arrayBuffer();
        await fs.writeFile(getCoverFilename(target), 'Books', coverBytes);
      }
      // Maintain coverHash === partialMD5(cover.png) so cross-device cover sync
      // can detect changes (issue #4544). Read from disk regardless of whether we
      // just wrote it — a hash-match reimport may reuse an existing cover.
      if (!existingBook) target.coverHash = await computeCoverHash(fs, target);
      // Retrying after a failed commit must never reset a config already on disk.
      if (!existingBook && !(await fs.exists(getConfigFilename(target), 'Books'))) {
        await saveBookConfigFn(target, {
          ...INIT_BOOK_CONFIG,
          ...(target.format === 'MD' ? { viewSettings: { scrolled: true } } : {}),
        });
      }

      // update file links with url or path or content uri
      if (isPseStream) {
        target.url ??= file as string;
      } else if (typeof file === 'string') {
        if (isValidURL(file)) {
          target.url ??= file;
        } else if (transient || inPlace) {
          // transient: source file is loaded directly, never persisted in Books/.
          // inPlace: source file is inside the user's library root and we read it
          // there directly instead of duplicating it under Books/<hash>/.
          if (inPlace && !transient) displaceSourcePath(target, file, osPlatform);
          target.filePath = file;
        } else if (!transient) {
          target.altFilePaths = [...new Set([...(target.altFilePaths ?? []), file])];
        }
      }
      target.coverImageUrl = await generateCoverImageUrlFn(target);
      if (willWriteBookFile || inPlace || transient) target.downloadedAt ??= Date.now();
      const detachedSources: Book[] = [];
      if (!transient && inPlace && typeof file === 'string') {
        const sourceKey = normalizeFilePathForIndex(file, osPlatform);
        for (const previous of candidates) {
          if (
            previous.hash === target.hash ||
            !previous.filePath ||
            normalizeFilePathForIndex(previous.filePath, osPlatform) !== sourceKey
          )
            continue;
          if (contentIdentity(previous) !== contentFingerprint) {
            detachedSources.push({
              ...previous,
              filePath: undefined,
              altFilePaths: previous.altFilePaths?.filter(
                (path) => normalizeFilePathForIndex(path, osPlatform) !== sourceKey,
              ),
              downloadedAt: (await fs.exists(getLocalBookFilename(previous), 'Books'))
                ? previous.downloadedAt
                : null,
            });
          }
        }
      }
      options.signal?.throwIfAborted();
      const updateIndex = (index: BookLookupIndex, result: Book) => {
        index.byHash.set(result.hash, result);
        const identity = contentIdentity(result);
        if (identity && index.byContentFingerprint) {
          const rows = index.byContentFingerprint.get(identity) ?? [];
          if (!rows.some((candidate) => candidate.hash === result.hash)) rows.push(result);
          index.byContentFingerprint.set(identity, rows);
        }
        if (result.metaHash) {
          const key = `${result.metaHash}:${result.format}`;
          const rows = index.byMetaKey.get(key) ?? [];
          if (!rows.some((candidate) => candidate.hash === result.hash)) rows.push(result);
          index.byMetaKey.set(key, rows);
        }
        if (result.filePath) {
          const key = normalizeFilePathForIndex(result.filePath, osPlatform);
          if (key) index.byFilePath.set(key, result);
        }
      };
      const publish = () => {
        for (const detached of detachedSources) {
          const previous = books.find((candidate) => candidate.hash === detached.hash);
          if (previous) Object.assign(previous, detached);
        }
        const inMemory = books.find((candidate) => candidate.hash === target.hash);
        const result = inMemory ? Object.assign(inMemory, target) : target;
        if (!inMemory) books.push(result);
        if (lookupIndex) updateIndex(lookupIndex, result);
        try {
          options.onResult?.(wasExisting ? 'existing' : 'added');
        } catch {
          /* Isolate observers. */
        }
        return result;
      };
      if (context) {
        for (const detached of detachedSources) {
          current.set(detached.hash, detached);
          updateIndex(context.index, detached);
        }
        current.set(target.hash, target);
        updateIndex(context.index, target);
        context.changes.push(...detachedSources, target);
        context.publish.push(publish);
      } else {
        if (!transient) await saveLibraryBooksUnlocked(fs, [...detachedSources, target]);
        const result = publish();
        returnedExisting = wasExisting;
        return result;
      }
      returnedExisting = wasExisting;
      return target;
    };
    const schedule = async (result: Book) => {
      // Background work owns its own document and opens it only when scheduled.
      await releaseResources();
      if (
        format === 'PDF' &&
        !transient &&
        (saveBook || inPlace) &&
        (!returnedExisting || options.retryPDFContents !== false) &&
        options.preparePDF
      ) {
        try {
          void options.preparePDF(result, undefined, options.signal).catch(() => {});
          return;
        } catch {}
      }
    };
    return { stage, commit, discardStaging, release: releaseResources, schedule };
  } catch (error) {
    await Promise.resolve(fs.removeDir(stageDirectory, 'Books', true)).catch(() => {});
    await releaseResources();
    console.error('Error importing book:', error);
    throw error;
  }
}

export async function importBooks(
  fs: FileSystem,
  inputs: BookImportInput[],
  books: Book[],
  options: ImportBookInternalOptions,
): Promise<BookImportResult[]> {
  const results: BookImportResult[] = inputs.map(() => ({ book: null }));
  const prepared: Array<PreparedBookImport | undefined> = inputs.map(() => undefined);
  const started = inputs.map(() => performance.now());
  const effective = inputs.map((input) => ({ ...options, ...input.options }));
  const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));
  const report = (index: number, stage: BookImportProgress['stage']) => {
    try {
      effective[index]!.onProgress?.({ stage, elapsedMs: performance.now() - started[index]! });
    } catch {
      /* Observers cannot invalidate a durable import. */
    }
  };
  await runImportTasks(
    inputs.length,
    async (index) => {
      try {
        effective[index]!.signal?.throwIfAborted();
        report(index, 'fingerprinting');
        const item = await prepareBookImport(fs, inputs[index]!.file, books, {
          ...effective[index]!,
          onProgress: (event) => report(index, event.stage),
        });
        prepared[index] = item;
        report(index, 'staging');
        await item.stage();
        report(index, 'waiting');
      } catch (error) {
        results[index]!.error = asError(error);
      }
      return index;
    },
    async (ready) => {
      for (const { index } of ready) report(index, 'committing');
      const finalized = new Set<number>();
      const finalize = async (index: number) => {
        if (finalized.has(index)) return;
        finalized.add(index);
        const item = prepared[index];
        if (item) {
          await item.discardStaging();
          if (results[index]!.book) await item.schedule(results[index]!.book!);
          else await item.release();
          prepared[index] = undefined;
        }
        const result = results[index]!;
        report(
          index,
          result.error
            ? result.error.name === 'AbortError'
              ? 'cancelled'
              : 'failed'
            : 'completed',
        );
        try {
          effective[index]!.onComplete?.(result);
        } catch {
          /* Isolate UI observers. */
        }
      };
      const completed = new Set<number>();
      for (const { index } of ready) {
        const item = prepared[index];
        if (!item || !effective[index]!.transient || results[index]!.error) continue;
        try {
          results[index]!.book = await item.commit();
          completed.add(index);
          await finalize(index);
        } catch (error) {
          results[index]!.error = asError(error);
        }
      }

      while (true) {
        let retry: number | undefined;
        let restart = false;
        const committed = new Map<number, Book>();
        let publish: Array<() => Book> = [];
        try {
          await withLibraryLock(fs, async () => {
            const disk = await loadLibraryRows(fs);
            const current = new Map(books.map((book) => [book.hash, book]));
            if (Array.isArray(disk)) {
              for (const book of disk) {
                const live = current.get(book.hash);
                current.set(book.hash, live ? mergeImportSnapshot(book, live) : book);
              }
            }
            const context: ImportCommitContext = {
              disk,
              current,
              index: buildBookLookupIndex([...current.values()], options.osPlatform),
              changes: [],
              publish: [],
            };
            for (const { index } of ready) {
              const item = prepared[index];
              if (
                !item ||
                effective[index]!.transient ||
                completed.has(index) ||
                results[index]!.error
              )
                continue;
              try {
                committed.set(index, await item.commit(context));
              } catch (error) {
                if (error instanceof ImportNeedsStage) {
                  retry = index;
                  break;
                }
                results[index]!.error = asError(error);
              }
            }
            // A peer may have been cancelled while a later item awaited I/O.
            // Rebuild only the still-active intents before starting persistence;
            // their identity decisions may have depended on the cancelled row.
            for (const index of committed.keys()) {
              try {
                effective[index]!.signal?.throwIfAborted();
              } catch (error) {
                results[index]!.error = asError(error);
                restart = true;
              }
            }
            if (restart) return;
            if (context.changes.length) {
              // Once this atomic save starts, its successful publication remains
              // authoritative even if cancellation arrives during persistence.
              await saveLibraryBooksUnlocked(fs, context.changes, undefined, context.disk);
            }
            publish = context.publish;
          });
        } catch (error) {
          for (const [index, item] of ready.map(({ index }) => [index, prepared[index]] as const)) {
            if (item && !completed.has(index) && !results[index]!.error) {
              results[index]!.error = asError(error);
            }
          }
          break;
        }
        if (restart) continue;
        const published = publish.map((publishBook) => publishBook());
        let publishedIndex = 0;
        for (const [index, book] of committed) {
          results[index]!.book = published[publishedIndex] ?? book;
          publishedIndex++;
          completed.add(index);
        }
        if (published.length) {
          try {
            notifyLibraryUpdated();
          } catch {
            /* A peer notification cannot invalidate already persisted books. */
          }
        }
        // Release and report durable peers before a newly discovered legacy
        // candidate performs another potentially slow prepare outside the lock.
        for (const index of committed.keys()) await finalize(index);
        if (retry === undefined) break;
        try {
          await prepared[retry]!.stage(true);
        } catch (error) {
          results[retry]!.error = asError(error);
        }
      }

      for (const { index } of ready) await finalize(index);
    },
  );
  return results;
}

export async function importBook(
  fs: FileSystem,
  file: string | File,
  books: Book[],
  options: ImportBookInternalOptions,
): Promise<Book | null> {
  const [result] = await importBooks(fs, [{ file, options }], books, options);
  if (result?.error) throw result.error;
  return result?.book ?? null;
}

// --- Book Content & Config ---

export async function isBookAvailable(fs: FileSystem, book: Book): Promise<boolean> {
  return (await resolveBookContentSource(fs, book)).kind !== 'missing';
}

export async function getBookFileSize(fs: FileSystem, book: Book): Promise<number | null> {
  const source = await resolveBookContentSource(fs, book);
  if (source.kind !== 'managed' && source.kind !== 'external') {
    return null;
  }
  const file = await fs.openFile(source.path, source.base);
  const size = file.size;
  const f = file as ClosableFile;
  if (f && f.close) {
    await f.close();
  }
  return size;
}

async function openBookFileContent(
  fs: FileSystem,
  book: Book,
): Promise<{
  source: BookFileContentSource;
  file: File;
}> {
  const source = await resolveBookContentSource(fs, book);
  if (!isBookFileContentSource(source)) {
    throw new BookFileNotFoundError();
  }
  return { source, file: await fs.openFile(source.path, source.base) };
}

export async function loadBookContent(fs: FileSystem, book: Book): Promise<BookContent> {
  const { file } = await openBookFileContent(fs, book);
  return { book, file };
}

/**
 * Best-effort resolution of an absolute, on-disk filesystem path for a book.
 *
 * Returns null when the book is not stored on disk (e.g. in-memory blob,
 * remote URL) or the path cannot be resolved. The returned path is
 * suitable for handing to native (Rust) commands that read the file
 * directly via std::fs.
 */
export async function resolveNativeBookFilePath(
  fs: FileSystem,
  resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  book: Book,
): Promise<string | null> {
  try {
    const source = await resolveBookContentSource(fs, book);
    if (source.kind !== 'managed' && source.kind !== 'external') return null;
    const fp = await resolveFilePath(source.path, source.base);
    if (!fp) return null;
    return fp.startsWith('file://') ? decodeURI(fp.slice('file://'.length)) : fp;
  } catch {
    return null;
  }
}

export async function loadBookConfig(
  fs: FileSystem,
  book: Book,
  settings: SystemSettings,
): Promise<BookConfig> {
  const globalViewSettings = {
    ...settings.globalViewSettings,
    ...(FIXED_LAYOUT_FORMATS.has(book.format) ? DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS : {}),
  };
  try {
    let str = '{}';
    if (await fs.exists(getConfigFilename(book), 'Books')) {
      str = (await fs.readFile(getConfigFilename(book), 'Books', 'text')) as string;
    }
    return deserializeConfig(str, globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
  } catch {
    return deserializeConfig('{}', globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
  }
}

export async function saveBookConfig(
  fs: FileSystem,
  book: Book,
  config: BookConfig,
  settings?: SystemSettings,
): Promise<void> {
  let serializedConfig: string;
  if (settings) {
    const globalViewSettings = {
      ...settings.globalViewSettings,
      ...(FIXED_LAYOUT_FORMATS.has(book.format) ? DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS : {}),
    };
    serializedConfig = serializeConfig(config, globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
  } else {
    serializedConfig = serializeRawConfig(config);
  }
  const edit = config.booknotes && bookNoteEdits.get(config.booknotes);
  await withBookDataWrite(
    book.hash,
    book.removal?.revision ?? 0,
    () => fs.writeFile(getConfigFilename(book), 'Books', serializedConfig),
    edit ? { ...edit, kind: 'notes', data: config.booknotes } : undefined,
  );
  if (config.booknotes) bookNoteEdits.delete(config.booknotes);
}

export async function loadBookNav(fs: FileSystem, book: Book): Promise<BookNav | null> {
  try {
    const path = getBookNavFilename(book);
    if (!(await fs.exists(path, 'Books'))) return null;
    const str = (await fs.readFile(path, 'Books', 'text')) as string;
    const parsed = JSON.parse(str) as BookNav;
    if (!parsed || typeof parsed.version !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveBookNav(fs: FileSystem, book: Book, nav: BookNav): Promise<void> {
  await withBookDataWrite(book.hash, book.removal?.revision ?? 0, () =>
    fs.writeFile(getBookNavFilename(book), 'Books', JSON.stringify(nav)),
  );
}

export async function fetchBookDetails(
  fs: FileSystem,
  book: Book,
  downloadBookFn: (book: Book) => Promise<void>,
): Promise<BookDoc['metadata']> {
  const fp = getLocalBookFilename(book);
  if (!(await fs.exists(fp, 'Books')) && book.uploadedAt) {
    await downloadBookFn(book);
  }
  const { file } = await loadBookContent(fs, book);
  let bookDoc: BookDoc | undefined;
  try {
    bookDoc = (await new DocumentLoader(file).open()).book;
    return bookDoc.metadata;
  } finally {
    try {
      await bookDoc?.destroy?.();
    } catch {}
    const f = file as ClosableFile;
    if (f && f.close) {
      await f.close();
    }
  }
}

/**
 * Refresh metadata for a single book by re-opening and re-parsing its file.
 * Updates series info, language, and other metadata fields without modifying
 * user-edited titles or reading progress.
 * Returns true if the metadata was successfully refreshed.
 */
export async function refreshBookMetadata(fs: FileSystem, book: Book): Promise<boolean> {
  const { file } = await loadBookContent(fs, book);
  let bookDoc: BookDoc | undefined;
  try {
    ({ book: bookDoc } = await new DocumentLoader(file).open());
    if (!bookDoc) return false;

    book.metadata = bookDoc.metadata;
    // PDF metaHash is salted with the original import filename (issue #5411),
    // which is lost after import — keep the value stamped at import time.
    if (book.format !== 'PDF' || !book.metaHash) {
      book.metaHash = getMetadataHash(bookDoc.metadata);
    }
    const primaryLanguage = getPrimaryLanguage(bookDoc.metadata.language);
    if (primaryLanguage) {
      book.primaryLanguage = primaryLanguage;
    }

    // Update series info from metadata
    if (book.metadata?.belongsTo?.series) {
      const belongsTo = book.metadata.belongsTo.series;
      const series = Array.isArray(belongsTo) ? belongsTo[0] : belongsTo;
      if (series) {
        book.metadata.series = formatTitle(series.name);
        book.metadata.seriesIndex = parseFloat(series.position || '0');
        if (series.total) book.metadata.seriesTotal = parseInt(series.total, 10);
      }
    }

    return true;
  } finally {
    try {
      await bookDoc?.destroy?.();
    } catch {}
    const f = file as ClosableFile;
    if (f && f.close) {
      await f.close();
    }
  }
}

export async function exportBook(
  fs: FileSystem,
  book: Book,
  resolveFilePath: (path: string, base: BaseDir) => Promise<string>,
  copyFile: (srcPath: string, srcBase: BaseDir, dstPath: string, dstBase: BaseDir) => Promise<void>,
  saveFile: (
    filename: string,
    content: ArrayBuffer,
    options?: { filePath?: string; mimeType?: string },
  ) => Promise<boolean>,
): Promise<boolean> {
  const { source, file } = await openBookFileContent(fs, book);
  const content = await file.arrayBuffer();
  const filename = `${makeSafeFilename(book.title)}.${book.format.toLowerCase()}`;
  const mimeType = file.type || 'application/octet-stream';
  if (source.kind === 'url') {
    return await saveFile(filename, content, { mimeType });
  }
  let filePath = await resolveFilePath(source.path, source.base);
  if (getFilename(filePath) !== filename) {
    await copyFile(source.path, source.base, filename, 'Temp');
    filePath = await resolveFilePath(filename, 'Temp');
  }
  return await saveFile(filename, content, { filePath, mimeType });
}
