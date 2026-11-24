import type { Book } from '@/types/book';
import { syncOrigin } from './config';

export function visibleCloudRow(row: Book, subject: string | null) {
  if (!row.glossaDiscovery) return true;
  const p = row.glossaCloud;
  return (
    p?.subject === subject &&
    p?.origin === syncOrigin() &&
    (row.glossaDiscovery.available || Boolean(row.downloadedAt))
  );
}

export async function requireCloudRowOwner(row: Book) {
  const { getUserID } = await import('@/utils/access');
  if (!visibleCloudRow(row, await getUserID())) throw new Error('sync_account_changed');
}
