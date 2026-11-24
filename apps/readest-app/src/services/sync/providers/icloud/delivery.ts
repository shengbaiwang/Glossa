import { z } from 'zod';
import type { AppService } from '@/types/system';
import type { DatabaseService } from '@/types/database';
import type { FileSyncProvider } from '../../file/provider';
import { ancestorsOf } from '../../file/layout';
import { withGlobalTypography } from './typography';
import { digest } from './noteJournal';
import { useSettingsStore } from '@/store/settingsStore';

const receipt = z
  .object({
    schema_version: z.literal(2),
    vault: z.string().uuid(),
    stream: z.string(),
    device: z.string().uuid(),
    cursor: z.record(z.string().uuid(), z.number().int().nonnegative().safe()),
  })
  .strict();

export function segmentDelivery(
  app: AppService,
  p: FileSyncProvider,
  dir: string,
  check: () => void,
) {
  const vault = p.vaultId!;
  const access = <T>(work: (db: DatabaseService, device: string) => Promise<T>) =>
    withGlobalTypography(app, vault, async (_, db, device) => {
      check();
      return work(db, device);
    });
  const base = p.rootPath + '/receipts/' + digest(dir);
  return {
    async published(path: string, actor: string, seq: number) {
      await access((db) =>
        db.execute(
          'INSERT OR IGNORE INTO segment_delivery(path,stream,actor,seq) VALUES(?,?,?,?)',
          [path, dir, actor, seq],
        ),
      );
    },
    async report(cursor: Record<string, number>) {
      const allowed = () => useSettingsStore.getState().settings.icloud?.strategy !== 'receive';
      if (!Object.keys(cursor).length || !allowed()) return;
      const [device, previous] = await access(
        async (db, id) =>
          [
            id,
            (
              await db.select<{ body: string }>('SELECT body FROM local_receipt WHERE stream=?', [
                dir,
              ])
            )[0]?.body,
          ] as const,
      );
      const sorted = Object.fromEntries(
        Object.entries(cursor).sort(([a], [b]) => a.localeCompare(b)),
      );
      const body = JSON.stringify(
        receipt.parse({ schema_version: 2, vault, stream: dir, device, cursor: sorted }),
      );
      if (previous === body) return;
      // Keep receipts immutable too. A slow second window cannot roll back a newer cursor.
      const path = base + '/' + device + '_' + digest(body) + '.json';
      await p.ensureDir(ancestorsOf(path));
      check();
      if (!(await p.head(path))) {
        check();
        if (!allowed()) return;
        await p.writeText(path, body);
      }
      await access((db) =>
        db.execute('INSERT OR REPLACE INTO local_receipt VALUES(?,?)', [dir, body]),
      );
    },
    async refresh() {
      const rows = await access((db) =>
        db.select<{ path: string }>(
          'SELECT path FROM segment_delivery WHERE stream=? AND uploaded=0 ORDER BY checked,path LIMIT 32',
          [dir],
        ),
      );
      for (const row of rows) {
        check();
        const status = await p.uploadStatus?.(row.path);
        await access((db) =>
          db.execute('UPDATE segment_delivery SET checked=?,uploaded=? WHERE path=?', [
            Date.now(),
            Number(status === 'uploaded'),
            row.path,
          ]),
        );
      }
      const waiting = await access((db) =>
        db.select('SELECT 1 FROM segment_delivery WHERE stream=? AND peer IS NULL LIMIT 1', [dir]),
      );
      if (!waiting.length || !(await p.head(base))) return;
      const [device, seen] = await access(
        async (db, id) =>
          [
            id,
            new Set(
              (
                await db.select<{ name: string }>('SELECT name FROM peer_receipt WHERE stream=?', [
                  dir,
                ])
              ).map((r) => r.name),
            ),
          ] as const,
      );
      for (const e of await p.list(base)) {
        if (
          e.isDirectory ||
          seen.has(e.name) ||
          e.name.startsWith(device + '_') ||
          !/^[0-9a-f-]{36}_[0-9a-f]{64}\.json$/.test(e.name)
        )
          continue;
        check();
        const raw = await p.readText(base + '/' + e.name);
        if (!raw) continue;
        const row = receipt.parse(JSON.parse(raw));
        if (
          row.vault !== vault ||
          row.stream !== dir ||
          row.device + '_' + digest(raw) + '.json' !== e.name
        )
          throw new Error('Invalid iCloud application receipt');
        await access(async (db) => {
          for (const [actor, n] of Object.entries(row.cursor))
            await db.execute(
              'UPDATE segment_delivery SET peer=? WHERE stream=? AND actor=? AND seq<=? AND peer IS NULL',
              [row.device, dir, actor, n],
            );
          await db.execute('INSERT OR IGNORE INTO peer_receipt VALUES(?,?)', [dir, e.name]);
        });
      }
    },
  };
}
