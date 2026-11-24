import { z } from 'zod';
import { v5 as uuidv5 } from 'uuid';
import type { DatabaseService } from '@/types/database';
import type { BookConfig } from '@/types/book';
import type { SegmentLog } from './exchangeSegments';
import type { RemoteBookConfig } from '../../file/wire';

const uuid = z.string().uuid();
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const position = z
  .object({
    schema_version: z.literal(2),
    vault_id: uuid,
    book: z.string(),
    fingerprint: z.string(),
    actor_id: uuid,
    seq: integer.positive(),
    op_id: uuid,
    hlc: integer,
    epoch_id: z.union([z.literal('initial'), uuid]),
    parent: uuid.nullable(),
    restart: z.boolean(),
    location: z.string().min(1),
    progress: z.tuple([integer, integer.positive()]).optional(),
    xpointer: z.string().optional(),
    device: z.string().max(100),
    deps: z.record(uuid, integer),
  })
  .strict();
type Position = z.infer<typeof position>;
export type ProgressContext = { vault: string; id: string; epoch: string };
export type ProgressCandidate = { id: string; device: string; location: string; page?: number };
const same = (config: BookConfig, p: Position) =>
  config.location === p.location &&
  JSON.stringify(config.progress) === JSON.stringify(p.progress) &&
  config.xpointer === p.xpointer;
const bp = (p: Position) =>
  p.progress ? Math.min(10000, Math.round((10000 * p.progress[0]) / p.progress[1])) : 0;
const spine = (cfi: string) => /^epubcfi\(([^!]+)!/.exec(cfi)?.[1];
export class PositionJournal implements SegmentLog {
  constructor(
    private db: DatabaseService,
    private vault: string,
    private book: string,
    private fingerprint: string,
    private actor: string,
  ) {}
  static schema =
    'CREATE TABLE IF NOT EXISTS positions (actor TEXT,seq INTEGER,id TEXT UNIQUE,epoch TEXT,clock INTEGER,epoch_clock INTEGER,epoch_actor TEXT,bp INTEGER,body TEXT NOT NULL,published INTEGER NOT NULL,PRIMARY KEY(actor,seq))';
  private async find(where: string, params: unknown[] = []) {
    const [row] = await this.db.select<{ body: string }>(
      'SELECT body FROM positions ' + where + ' LIMIT 1',
      params,
    );
    return row ? position.parse(JSON.parse(row.body)) : undefined;
  }
  private byId(id: string) {
    return this.find('WHERE id=?', [id]);
  }
  private async append(op: Position, published: boolean) {
    const epoch =
      op.epoch_id === 'initial' ? undefined : op.restart ? op : await this.byId(op.epoch_id);
    if (op.epoch_id !== 'initial' && (!epoch?.restart || epoch.op_id !== op.epoch_id))
      throw new Error('Invalid reading epoch');
    // The position row is both the materialized snapshot and its durable outbox entry.
    await this.db.execute('INSERT INTO positions VALUES(?,?,?,?,?,?,?,?,?,?)', [
      op.actor_id,
      op.seq,
      op.op_id,
      op.epoch_id,
      op.hlc,
      epoch?.hlc ?? 0,
      epoch?.actor_id ?? '',
      bp(op),
      JSON.stringify(op),
      Number(published),
    ]);
  }
  async save(config: BookConfig, device: string, restart = false) {
    if (!config.location) return;
    const context = config.icloudPosition?.vault === this.vault ? config.icloudPosition : undefined;
    const base = context ? await this.byId(context.id) : undefined;
    const own = await this.find('WHERE actor=? ORDER BY seq DESC', [this.actor]);
    if (!restart && base && same(config, base)) return;
    if (!restart && own && (!base || own.epoch_id === base.epoch_id) && same(config, own)) return;
    const parent = base ?? own;
    const id = crypto.randomUUID();
    const deps = await this.cursor();
    // Legacy snapshots have no sequence or causal history. Only an actual
    // resume from a snapshot introduces a dependency on that snapshot.
    for (const actor of Object.keys(deps)) {
      if (actor[14] === '5' && actor !== parent?.actor_id) delete deps[actor];
    }
    const [last] = await this.db.select<{ clock: number }>(
      'SELECT coalesce(max(clock),0) AS clock FROM positions',
    );
    const op = position.parse({
      schema_version: 2,
      vault_id: this.vault,
      book: this.book,
      fingerprint: this.fingerprint,
      op_id: id,
      actor_id: this.actor,
      seq: (deps[this.actor] ?? 0) + 1,
      hlc: Math.max(Date.now() * 1024, last!.clock + 1),
      parent: parent?.op_id ?? null,
      epoch_id: restart ? id : (parent?.epoch_id ?? 'initial'),
      restart,
      device,
      location: config.location,
      progress: config.progress,
      xpointer: config.xpointer,
      deps,
    });
    await this.append(op, false);
    config.icloudPosition = { vault: this.vault, id, epoch: op.epoch_id };
  }
  async importLegacy(row: RemoteBookConfig) {
    const c = row.config;
    if (!c?.location) return;
    const timestamp = c.updatedAt ?? row.updatedAt;
    const source = [
      this.book,
      this.fingerprint,
      row.writerDeviceId,
      timestamp,
      c.location,
      c.progress,
      c.xpointer,
    ];
    // v1 exposes just its latest snapshot. Two importers may see different
    // revisions or orders, so each observed revision forms an immutable segment.
    const id = uuidv5(JSON.stringify(source), this.vault);
    if (await this.byId(id)) return;
    const op = position.parse({
      schema_version: 2,
      vault_id: this.vault,
      book: this.book,
      fingerprint: this.fingerprint,
      actor_id: id,
      seq: 1,
      op_id: id,
      hlc: timestamp * 1024,
      epoch_id: 'initial',
      restart: false,
      parent: null,
      deps: {},
      location: c.location,
      progress: c.progress,
      xpointer: c.xpointer,
      device: row.writerDeviceId,
    });
    await this.append(op, false);
  }
  async project(config: BookConfig, format: string) {
    const order =
      ' ORDER BY epoch_clock DESC,epoch_actor DESC,epoch DESC,clock DESC,actor DESC,id DESC';
    const shared = await this.find(order);
    if (!shared) return { config };
    const applied = (p: Position): BookConfig => ({
      ...config,
      location: p.location,
      progress: p.progress,
      xpointer: p.xpointer,
      icloudPosition: { vault: this.vault, id: p.op_id, epoch: p.epoch_id },
    });
    const own = await this.find('WHERE actor=? AND epoch=? ORDER BY seq DESC', [
      this.actor,
      shared.epoch_id,
    ]);
    const peer = await this.find('WHERE actor<>? AND epoch=?' + order, [
      this.actor,
      shared.epoch_id,
    ]);
    if (
      own &&
      peer &&
      (peer.actor_id[14] !== '5' || peer.hlc > own.hlc) &&
      (own.deps[peer.actor_id] ?? 0) < peer.seq &&
      (peer.deps[this.actor] ?? 0) < own.seq &&
      own.location !== peer.location
    ) {
      const far =
        Math.abs(bp(own) - bp(peer)) >= 500 ||
        (format === 'PDF' &&
          !!own.progress &&
          !!peer.progress &&
          Math.abs(own.progress[0] - peer.progress[0]) >= 5) ||
        (format === 'EPUB' &&
          !!spine(own.location) &&
          !!spine(peer.location) &&
          spine(own.location) !== spine(peer.location));
      if (far)
        return {
          config: applied(own),
          candidate: {
            id: peer.op_id,
            location: peer.location,
            device: peer.device,
            page: peer.progress?.[0],
          },
        };
    }
    return { config: applied(shared) };
  }
  async furthest() {
    return (
      await this.db.select<{ n: number }>('SELECT coalesce(max(bp),0) AS n FROM positions')
    )[0]!.n;
  }
  async cursor() {
    const rows = await this.db.select<{ actor: string; seq: number }>(
      'SELECT actor,max(seq) AS seq FROM positions GROUP BY actor',
    );
    return Object.fromEntries(rows.map((r) => [r.actor, r.seq]));
  }
  async pending() {
    return (
      await this.db.select<{ body: string }>(
        'SELECT body FROM positions WHERE published=0 ORDER BY seq LIMIT 128',
      )
    ).map((r) => r.body);
  }
  async published(id: string) {
    await this.db.execute('UPDATE positions SET published=1 WHERE id=? AND published=0', [id]);
  }
  async receive(raw: string) {
    const op = position.parse(JSON.parse(raw));
    if (
      op.vault_id !== this.vault ||
      op.book !== this.book ||
      op.fingerprint !== this.fingerprint ||
      (op.restart && op.epoch_id !== op.op_id)
    )
      throw new Error('Invalid iCloud position identity');
    const existing = await this.find('WHERE actor=? AND seq=?', [op.actor_id, op.seq]);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(op))
        throw new Error('Conflicting iCloud position');
      return true;
    }
    const cursor = await this.cursor();
    if (
      op.seq !== (cursor[op.actor_id] ?? 0) + 1 ||
      Object.entries(op.deps).some(([actor, n]) => (cursor[actor] ?? 0) < n)
    )
      return false;
    if (op.parent && !(await this.byId(op.parent))) return false;
    await this.append(op, true);
    return true;
  }
}
