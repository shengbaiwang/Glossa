import type { FileSyncProvider } from '@/services/sync/file/provider';
import { ancestorsOf } from '@/services/sync/file/layout';
import { digest } from './noteJournal';

export interface SegmentLog {
  pending(): Promise<string[]>;
  published(id: string): Promise<void>;
  cursor(): Promise<Record<string, number>>;
  receive(raw: string): Promise<boolean>;
}

export async function exchangeSegments(
  provider: FileSyncProvider,
  dir: string,
  direction: 'pull' | 'push',
  log: SegmentLog,
  check: () => void,
  delivery?: ReturnType<typeof import('./delivery').segmentDelivery>,
) {
  if (direction === 'push') {
    // Only committed SQLite records may leave the device.
    for (;;) {
      const pending = await log.pending();
      if (!pending.length) break;
      await provider.ensureDir(ancestorsOf(dir + '/segment'));
      for (const raw of pending) {
        check();
        const op = JSON.parse(raw);
        const path = dir + '/' + op.actor_id + '_' + op.seq + '_' + digest(raw) + '.json';
        const previous = await provider.readText(path);
        if (previous !== null && previous !== raw) throw new Error('iCloud log checksum mismatch');
        if (previous === null) {
          check();
          await provider.writeText(path, raw);
        }
        await delivery?.published(path, op.actor_id, op.seq);
        await log.published(op.op_id);
      }
    }
    await delivery?.refresh();
    return;
  }
  const cursor = await log.cursor();
  if (await provider.head(dir)) {
    const entries = await provider.list(dir);
    const hashes = new Map<string, string>();
    const segments = entries
      .flatMap((e) => {
        const match = /^([0-9a-f-]{36})_([1-9][0-9]*)_([0-9a-f]{64})\.json$/.exec(e.name);
        if (!match || e.isDirectory) return [];
        const [, actor, seq, hash] = match;
        const key = actor + '_' + seq;
        if (hashes.has(key) && hashes.get(key) !== hash)
          throw new Error('Conflicting iCloud log segment');
        hashes.set(key, hash!);
        return Number(seq) > (cursor[actor!] ?? 0)
          ? [{ name: e.name, actor: actor!, seq: Number(seq), hash }]
          : [];
      })
      .sort((a, b) => a.seq - b.seq);
    let advanced = true;
    while (advanced && segments.length) {
      advanced = false;
      for (const entry of [...segments]) {
        if (entry.seq !== (cursor[entry.actor] ?? 0) + 1) continue;
        check();
        const raw = await provider.readText(dir + '/' + entry.name);
        if (raw === null) continue;
        if (digest(raw) !== entry.hash) throw new Error('Invalid iCloud log digest');
        const op = JSON.parse(raw);
        if (op.actor_id !== entry.actor || op.seq !== entry.seq)
          throw new Error('Invalid iCloud log identity');
        if (await log.receive(raw)) {
          cursor[entry.actor] = entry.seq;
          segments.splice(segments.indexOf(entry), 1);
          advanced = true;
        }
      }
    }
    await delivery?.report(cursor);
  }
}
