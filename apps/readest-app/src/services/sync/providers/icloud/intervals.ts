import { z } from 'zod';
import type { Book } from '@/types/book';
import type { FileSyncProvider } from '../../file/provider';
import type { StatisticsDb } from '@/services/statistics/statisticsDb';
import { ancestorsOf } from '../../file/layout';
import { digest } from './noteJournal';
import { vaultRoot } from './vault';
const interval = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    bookHash: z.string(),
    startMs: z.number().int().nonnegative(),
    durationMs: z.number().int().positive(),
  })
  .strict();
const record = z
  .object({
    schema_version: z.literal(2),
    vault_id: z.string().uuid(),
    fingerprint: z.string(),
    interval,
  })
  .strict();
export async function exchangeIntervals(
  db: StatisticsDb,
  p: FileSyncProvider,
  vault: string,
  book: Book,
  direction: 'pull' | 'push',
  check: () => void,
) {
  const dir =
    vaultRoot(vault) + '/intervals/' + book.hash + '/' + book.contentFingerprint!.slice(7);
  await db.initICloudDelivery();
  if (direction === 'push') {
    for (;;) {
      const rows = await db.unpublishedIntervals(vault, book.hash);
      if (!rows.length) return;
      await p.ensureDir(ancestorsOf(dir + '/file'));
      for (const row of rows) {
        check();
        const body = JSON.stringify(
          record.parse({
            schema_version: 2,
            vault_id: vault,
            fingerprint: book.contentFingerprint,
            interval: row,
          }),
        );
        const key = digest(body);
        const path = dir + '/' + key + '.json';
        const existing = await p.readText(path);
        if (existing !== null && existing !== body) throw new Error('Invalid interval digest');
        if (existing === null) {
          check();
          await p.writeText(path, body);
        }
        await db.acknowledgeInterval(vault, row, key);
      }
    }
  }
  if (!(await p.head(dir))) return;
  const known = await db.publishedIntervals(vault, book.hash);
  for (const e of await p.list(dir)) {
    if (e.isDirectory || !/^[0-9a-f]{64}\.json$/.test(e.name) || known.has(e.name.slice(0, -5)))
      continue;
    check();
    const raw = await p.readText(dir + '/' + e.name);
    if (raw === null) continue;
    const key = digest(raw);
    if (e.name !== key + '.json') throw new Error('Invalid interval digest');
    const op = record.parse(JSON.parse(raw));
    if (
      op.vault_id !== vault ||
      op.fingerprint !== book.contentFingerprint ||
      op.interval.bookHash !== book.hash
    )
      throw new Error('Invalid interval identity');
    check();
    await db.acknowledgeInterval(vault, op.interval, key);
  }
}
