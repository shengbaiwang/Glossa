import type { Book } from '@/types/book';
import type { AppService, BaseDir } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
import type { FileSyncProvider } from './sync/file/provider';
import { isContentURI } from '@/utils/misc';
import { fingerprintFile } from './bookIdentity';
import { resolveBookContentSource } from './bookContent';
import { buildBookDirPath, findRemoteBookFile } from './sync/file/layout';
import { BookRemovalError } from './bookRemovalState';

const unavailable = () =>
  new BookRemovalError(
    'unavailable-copy',
    'No verified recovery copy is available. Keep the local download and retry after syncing.',
  );

async function fingerprint(app: AppService, path: string, base: BaseDir) {
  const file = await app.openFile(path, base);
  try {
    return await fingerprintFile(file);
  } finally {
    await (file as Partial<ClosableFile>).close?.();
  }
}

async function remoteFingerprint(
  app: AppService,
  provider: FileSyncProvider,
  path: string,
  book: Book,
): Promise<string | undefined> {
  if (!provider.downloadStream) {
    const bytes = await provider.readBinary(path);
    return bytes ? fingerprintFile(new File([bytes], 'verification')) : undefined;
  }
  // Native downloads stay out of the JS heap and never overwrite the reading copy.
  const directory = `removal-checks/${book.hash}`;
  const temporary = `${directory}/${crypto.randomUUID()}`;
  await app.createDir(directory, 'Cache', true);
  try {
    const destination = await app.resolveFilePath(temporary, 'Cache');
    if (!(await provider.downloadStream(path, destination))) return undefined;
    return await fingerprint(app, temporary, 'Cache');
  } finally {
    if (await app.exists(temporary, 'Cache')) await app.deleteFile(temporary, 'Cache');
  }
}

/** Caller holds the per-book write lock. A historical upload marker proves nothing about current bytes. */
export async function clearVerifiedBookDownload(app: AppService, book: Book): Promise<void> {
  const verificationDir = `removal-checks/${book.hash}`;
  if (await app.exists(verificationDir, 'Cache'))
    await app.deleteDir(verificationDir, 'Cache', true);
  const fs = {
    exists: app.exists.bind(app),
    openFile: app.openFile.bind(app),
    readDir: app.readDirectory.bind(app),
  };
  const source = await resolveBookContentSource(fs, book);
  // A retry after successful removal is idempotent; external files are never downloads.
  if (source.kind !== 'managed') return;
  const expected = await fingerprint(app, source.path, source.base);
  let verified = false;
  if (book.filePath) {
    try {
      if (isContentURI(book.filePath) || (await app.exists(book.filePath, 'None')))
        verified = (await fingerprint(app, book.filePath, 'None')) === expected;
    } catch {
      // An unavailable original may still have a verified cloud copy.
    }
  }
  if (!verified) {
    const [{ useSettingsStore }, { getReadyFileSyncBackends }, { createFileSyncProvider }] =
      await Promise.all([
        import('@/store/settingsStore'),
        import('./sync/file/runLibrarySync'),
        import('./sync/file/providerRegistry'),
      ]);
    const settings = useSettingsStore.getState().settings;
    for (const kind of getReadyFileSyncBackends(settings)) {
      let actual: string | undefined;
      try {
        const provider = await createFileSyncProvider(kind, settings);
        if (!provider) continue;
        const directory = buildBookDirPath(provider.rootPath, book.hash);
        const entry = findRemoteBookFile(await provider.list(directory), directory, book.format);
        if (entry) actual = await remoteFingerprint(app, provider, entry.path, book);
      } catch {
        // One unavailable mirror must not hide another independently verified copy.
        continue;
      }
      if (!actual) continue;
      // Download tries mirrors in this order. Do not clear the good local copy
      // when the first downloadable mirror would supply different content.
      if (actual !== expected) throw unavailable();
      verified = true;
      break;
    }
  }
  if (!verified) throw unavailable();
  const current = await resolveBookContentSource(fs, book);
  if (
    current.kind !== 'managed' ||
    current.path !== source.path ||
    (await fingerprint(app, current.path, current.base)) !== expected
  )
    throw new BookRemovalError(
      'changed-file',
      'The local book changed during verification. Retry clearing the download.',
    );
  await app.deleteBook(book, 'local');
}
