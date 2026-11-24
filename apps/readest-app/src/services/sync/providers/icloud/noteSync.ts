import type { AppService } from '@/types/system';
import type { Book, BookConfig } from '@/types/book';
import type { ICloudSettings } from '@/types/settings';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { buildBookConfigPath, buildLibraryPath } from '@/services/sync/file/layout';
import { parseRemoteLibraryIndex, parseRemotePayload } from '@/services/sync/file/wire';
import { exchangeSegments } from './exchangeSegments';
import { withLibraryLock } from '@/services/libraryLock';
import { withBookDataWrite } from '@/services/bookDataLifecycle';
import { NoteJournal } from './noteJournal';
import { isVaultId, vaultRoot, verifyVault } from './vault';

export function journalVault(settings: ICloudSettings | undefined, book: Book) {
  if (
    !isVaultId(settings?.vaultId) ||
    !book.contentFingerprint ||
    !/^sha256:[0-9a-f]{64}$/.test(book.contentFingerprint) ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(book.hash) ||
    book.glossaCloud ||
    book.deletedAt
  )
    return undefined;
  return settings.vaultId;
}

export async function withNoteJournal<T>(
  app: AppService,
  book: Book,
  vault: string,
  fn: (journal: NoteJournal) => Promise<T>,
) {
  if (
    !isVaultId(vault) ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(book.hash) ||
    !/^sha256:[0-9a-f]{64}$/.test(book.contentFingerprint ?? '')
  )
    throw new Error('Invalid book identity');
  const file = book.hash + '/.icloud-' + vault + '-' + book.contentFingerprint!.slice(7) + '.db';
  const path = await app.resolveFilePath(file, 'Books');
  return withLibraryLock(
    { getPrefix: async () => path },
    async () => {
      await app.createDir(book.hash, 'Books', true);
      const db = await app.openDatabase('icloud-journal', path, 'None');
      try {
        const journal = new NoteJournal(db, vault, book.hash, book.contentFingerprint!);
        await journal.init();
        return await fn(journal);
      } finally {
        await db.close();
      }
    },
    'sync-replica',
  );
}

export function syncBookJournal(
  app: AppService,
  provider: FileSyncProvider,
  vault: string,
  current: () => ICloudSettings | undefined,
) {
  return async (book: Book, direction: 'pull' | 'push', local: BookConfig) => {
    const check = () => {
      const s = current();
      if (
        !s?.enabled ||
        s.vaultId !== vault ||
        s.strategy === (direction === 'push' ? 'receive' : 'send')
      )
        throw new Error('iCloud synchronization paused');
    };
    check();
    if (journalVault(current(), book) !== vault)
      throw new Error('Verify the original book before syncing');
    const access = <T>(fn: (j: NoteJournal) => Promise<T>) =>
      withBookDataWrite(book.hash, book.removal?.revision ?? 0, () => {
        check();
        return withNoteJournal(app, book, vault, fn);
      });
    await verifyVault(provider, vault);
    const stream = async (kind: 'annotations' | 'positions' | 'typography') => {
      const checkCategory = () => {
        check();
        if (
          kind !== 'typography' &&
          current()?.[kind === 'annotations' ? 'syncNotes' : 'syncProgress'] === false
        )
          throw new Error('iCloud synchronization paused');
      };
      const log = (j: NoteJournal) =>
        kind === 'annotations' ? j : kind === 'positions' ? j.positions : j.typography;
      const dir =
        vaultRoot(vault) + '/' + kind + '/' + book.hash + '/' + book.contentFingerprint!.slice(7);
      await exchangeSegments(
        provider,
        dir,
        direction,
        {
          pending: () => access((j) => log(j).pending()),
          published: (id) => access((j) => log(j).published(id)),
          cursor: () => access((j) => log(j).cursor()),
          receive: (raw) =>
            access((j) => {
              checkCategory();
              return log(j).receive(raw);
            }),
        },
        checkCategory,
        (await import('./delivery')).segmentDelivery(app, provider, dir, checkCategory),
      );
    };
    if (
      direction === 'pull' &&
      (current()?.syncNotes !== false || current()?.syncProgress !== false)
    ) {
      const legacyRaw = await provider.readText(buildBookConfigPath('/', book.hash));
      if (legacyRaw !== null) {
        const legacy = parseRemotePayload(legacyRaw);
        const index = parseRemoteLibraryIndex(await provider.readText(buildLibraryPath('/')));
        const row = index?.books.find((b) => b.hash === book.hash);
        if (row?.contentFingerprint === book.contentFingerprint) {
          if (!legacy || legacy.bookHash !== book.hash)
            throw new Error('The previous iCloud book configuration could not be verified');
          await access(async (j) => {
            if (current()?.syncProgress !== false) await j.positions.importLegacy(legacy);
            if (current()?.syncNotes !== false) {
              if (!Array.isArray(legacy.booknotes))
                throw new Error('Invalid previous iCloud annotations');
              await j.importLegacy(legacy.booknotes);
              const imported = new Map((await j.notes()).map((n) => [n.id, n]));
              if (legacy.booknotes.some((n) => !imported.has(n.id) || !imported.get(n.id)?.cfi))
                throw new Error('The previous iCloud annotations could not be verified');
            }
          });
        }
      }
    }
    if (current()?.syncNotes !== false) await stream('annotations');
    if (current()?.syncProgress !== false) await stream('positions');
    await stream('typography');
    if (current()?.syncStats !== false) {
      const { StatisticsDb } = await import('@/services/statistics/statisticsDb');
      const { exchangeIntervals } = await import('./intervals');
      await exchangeIntervals(
        await StatisticsDb.open(app),
        provider,
        vault,
        book,
        direction,
        () => {
          check();
          if (current()?.syncStats === false) throw new Error('Reading statistics sync paused');
        },
      );
    }
    if (direction === 'push') return { applied: false };
    return access(async (j) => {
      const position =
        current()?.syncProgress === false
          ? { config: local }
          : await j.positions.project(local, book.format);
      const notes = current()?.syncNotes === false ? undefined : await j.notes();
      const known = new Set(notes?.map((n) => n.id));
      const mergedNotes = notes && [
        ...notes,
        ...(local.booknotes ?? []).filter((n) => !known.has(n.id)),
      ];
      const { typographyProfile } = await import('./typography');
      const { useSettingsStore } = await import('@/store/settingsStore');
      const appearance = await j.typography.project(
        local.viewSettings ?? {},
        typographyProfile(app),
        useSettingsStore.getState().settings.globalViewSettings,
      );
      const projected = {
        ...position.config,
        viewSettings: appearance.view,
        icloudTypography: appearance.context,
      };
      const mergedConfig = mergedNotes ? { ...projected, booknotes: mergedNotes } : projected;
      return {
        applied: JSON.stringify(mergedConfig) !== JSON.stringify(local),
        mergedConfig,
        mergedNotes,
        progressCandidate: 'candidate' in position ? position.candidate : undefined,
      };
    });
  };
}
