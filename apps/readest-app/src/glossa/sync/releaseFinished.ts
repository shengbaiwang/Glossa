import type { AppService } from '@/types/system';
import { removeAppBooks, bookRemovalIO } from '@/services/appBookRemoval';
import { loadLibraryRows } from '@/services/libraryRepository';
import { notifyLibraryUpdated } from '@/utils/libraryEvents';
import { getUserID } from '@/utils/access';
import { isPinned, releaseDays, localReleaseDue } from './releasePolicy';
import { syncOrigin } from './config';
import { withUnusedBook } from './bookUse';

// A catalog refresh may release one eligible download. Concurrent windows skip a busy pass.
export async function releaseFinishedDownload(app: AppService, subject: string) {
  const origin = syncOrigin();
  if (!origin || !navigator.locks || !releaseDays({ origin, subject })) return;
  await navigator.locks.request(
    'glossa-finished-download:' + JSON.stringify([origin, subject]),
    { ifAvailable: true },
    async (lock) => {
      const days = releaseDays({ origin, subject });
      if (!lock || !days || (await getUserID()) !== subject) return;
      const rows = await loadLibraryRows(bookRemovalIO(app), { strict: true });
      for (const row of rows) {
        const p = row.glossaCloud;
        if (
          !p ||
          p.origin !== origin ||
          p.subject !== subject ||
          isPinned(p) ||
          !row.downloadedAt ||
          row.deletedAt ||
          row.duplicateOf ||
          row.glossaDiscovery?.available === false ||
          (row.localRemoval && row.localRemoval.local !== 'complete') ||
          (row.removal && row.removal.local !== 'complete') ||
          !localReleaseDue(row, days)
        )
          continue;
        if (!(await withUnusedBook(row.hash, async () => true).catch(() => false))) continue;
        const result = await removeAppBooks(app, [row], 'local', { releaseAfterDays: days });
        if (result.completed.length) notifyLibraryUpdated(result.completed);
        return;
      }
    },
  );
}
