import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import { useSettingsStore } from '@/store/settingsStore';
import { fingerprintPath, libraryIdentityIO } from '@/services/bookIdentity';
import { resolveBookContentSource } from '@/services/bookContent';
import { BookRemovalError } from '@/services/bookRemovalState';
import { withUnusedBook } from '@/glossa/sync/bookUse';
import { createFileSyncProvider } from '../../file/providerRegistry';
import { confirmUploadedBlob, verifyUploadedBlob } from './blob';
import { verifyVault } from './vault';

export async function prepareVaultRelease(app: AppService, book: Book, signal?: AbortSignal) {
  const asset = book.icloudAsset;
  const expected = book.storedContentFingerprint ?? book.contentFingerprint;
  const unavailable = () =>
    new BookRemovalError('unavailable-copy', 'Waiting for a verified iCloud Drive copy');
  if (
    !asset ||
    'sha256:' + asset.file !== expected ||
    !book.localRemoval ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(book.hash)
  )
    throw unavailable();
  const scope = 'icloud:' + asset.vault + ':' + asset.manifest;
  const settings = useSettingsStore.getState().settings;
  const check = () => {
    signal?.throwIfAborted();
    const active = useSettingsStore.getState().settings.icloud;
    if (
      !active?.enabled ||
      active.vaultId !== asset.vault ||
      active.documentsPath !== settings.icloud.documentsPath
    )
      throw unavailable();
  };
  const same = (row: Book) =>
    row.localRemoval?.id === book.localRemoval!.id &&
    row.localRemoval?.cloudScope === scope &&
    (row.downloadedAt ?? null) === book.localRemoval!.downloadedAt &&
    row.icloudAsset?.manifest === asset.manifest &&
    row.icloudAsset.vault === asset.vault &&
    (row.storedContentFingerprint ?? row.contentFingerprint) === expected &&
    !row.deletedAt;
  check();
  if (!same(book)) throw unavailable();
  const io = libraryIdentityIO(app);
  const root = await app.resolveFilePath('', 'Books');
  const source = await resolveBookContentSource(io, book);
  const provider = await createFileSyncProvider('icloud', settings);
  if (!provider || provider.vaultId !== asset.vault) throw unavailable();
  if (source.kind === 'managed' && (await verifyUploadedBlob(provider, asset, check)) !== expected)
    throw unavailable();
  return async (latest: Book) =>
    withUnusedBook(book.hash, async () => {
      check();
      if (!same(latest) || (await app.resolveFilePath('', 'Books')) !== root) throw unavailable();
      await verifyVault(provider, asset.vault);
      const now = await resolveBookContentSource(io, latest);
      if (now.kind !== 'managed') {
        if (source.kind === 'managed') throw unavailable();
        return;
      }
      if (
        source.kind !== 'managed' ||
        now.path !== source.path ||
        now.path.split('/').length !== 2 ||
        !now.path.startsWith(book.hash + '/') ||
        (await fingerprintPath(io, now.path, 'Books', signal)) !== expected
      )
        throw unavailable();
      check();
      // A synced folder can be replaced or its contents evicted while the local file is hashed.
      await confirmUploadedBlob(provider, asset, check);
      check();
      await app.deleteFile(now.path, 'Books');
    });
}
