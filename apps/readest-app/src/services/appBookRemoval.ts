import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import {
  prepareRemoval,
  runRemoval,
  type RemovalResult,
  bookRemovalVersion,
} from './bookRemovalService';
import type { RemovalMode } from './bookRemovalState';
import type { SystemSettings } from '@/types/settings';
import type { TranslationFunc } from '@/hooks/useTranslation';
import { getEnabledFileSyncBackends, cloudProvidersDisplayName } from './sync/cloudSyncProvider';

export function removalScope(settings: SystemSettings, _: TranslationFunc, local = false): string {
  if (local) return _('External originals are kept.');
  const providers = getEnabledFileSyncBackends(settings);
  return providers.length
    ? _('Also applies to devices synced through {{providers}}.', {
        providers: cloudProvidersDisplayName(providers),
      })
    : '';
}

/** Describe the completed action; omit zero-valued failure counters. */
export function removalFeedback(
  result: RemovalResult,
  mode: RemovalMode,
  _: TranslationFunc,
): string {
  const parts = [
    _(
      mode === 'local'
        ? 'Cleared {{count}} download(s)'
        : mode === 'purge'
          ? 'Permanently deleted {{count}} book(s)'
          : 'Moved {{count}} book(s) to Recently Deleted',
      { count: result.completed.length },
    ),
  ];
  if (result.failed.length) parts.push(_('Failed {{count}}', { count: result.failed.length }));
  if (result.pending.length)
    parts.push(_('Not started {{count}}', { count: result.pending.length }));
  return parts.join(' · ');
}

export const bookRemovalIO = (app: AppService) => ({
  getPrefix: () => app.resolveFilePath('', 'Books'),
  readFile: app.readFile.bind(app),
  writeFile: app.writeFile.bind(app),
});
export const cleanRemovedBook =
  (app: AppService) => async (book: Book, mode: 'purge' | 'local') => {
    if (mode === 'purge') {
      const { purgeBookBrowserData } = await import('./bookRemovalData');
      await purgeBookBrowserData(book.hash, book.removal!.revision, async () => {
        const { isTauriAppPlatform } = await import('./environment');
        if (book.format === 'PDF' && isTauriAppPlatform()) {
          const { purgePDFBook } = await import('./pdfEnhancement');
          await purgePDFBook(book.hash, book.removal!.revision);
        }
        await app.deleteBook(book, mode);
      });
    } else {
      const [{ withBookDataWrite }, { clearVerifiedBookDownload }] = await Promise.all([
        import('./bookDataLifecycle'),
        import('./bookDownloadSafety'),
      ]);
      await withBookDataWrite(book.hash, book.removal?.revision ?? 0, () =>
        clearVerifiedBookDownload(app, book),
      );
    }
  };
export async function removeAppBooks(
  app: AppService,
  books: Book[],
  mode: RemovalMode,
  options: {
    cloud?: boolean;
    cloudTargets?: string[];
    signal?: AbortSignal;
    onProgress?: (result: RemovalResult) => void;
    allowConflict?: boolean;
  } = {},
) {
  const io = bookRemovalIO(app);
  const job = await prepareRemoval(
    io,
    books.map((b) => b.hash),
    mode,
    {
      cloud: options.cloud,
      cloudTargets: options.cloudTargets,
      allowConflict: options.allowConflict,
      expected: Object.fromEntries(books.map((b) => [b.hash, bookRemovalVersion(b)])),
    },
  );
  return runRemoval(io, job.id, { ...options, clean: cleanRemovedBook(app) });
}
