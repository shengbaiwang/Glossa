import { z } from 'zod';
import type { DatabaseService } from '@/types/database';
import type { ViewSettings } from '@/types/book';
import type { AppService } from '@/types/system';
import { withLibraryLock } from '@/services/libraryLock';
import type { SegmentLog } from './exchangeSegments';
import { GroupJournal } from './groups';
import { isVaultId } from './vault';

const shared = [
  'serifFont',
  'sansSerifFont',
  'defaultFont',
  'defaultCJKFont',
  'monospaceFont',
  'fontWeight',
  'fullJustification',
  'hyphenation',
  'writingMode',
] as const;
const adaptive = [
  'defaultFontSize',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'maxColumnCount',
  'marginTopPx',
  'marginBottomPx',
  'marginLeftPx',
  'marginRightPx',
] as const;
const keys = [...shared, ...adaptive] as const;
const integer = z.number().int().nonnegative().safe();
const operation = z
  .object({
    schema_version: z.literal(2),
    vault_id: z.string().uuid(),
    scope: z.string(),
    op_id: z.string().uuid(),
    actor_id: z.string().uuid(),
    seq: integer.positive(),
    hlc: integer,
    deps: z.record(z.string().uuid(), integer),
    key: z.enum(keys),
    profile: z.enum(['shared', 'phone', 'tablet', 'desktop']),
    value: z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]),
  })
  .strict();
type Op = z.infer<typeof operation>;
type Values = Partial<Record<Op['key'], Op['value']>>;
export type TypographyContext = { vault: string; values: Values };
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export function typographyProfile(app: AppService): Op['profile'] {
  if (!app.isIOSApp) return 'desktop';
  return Math.min(screen.width, screen.height) >= 600 ? 'tablet' : 'phone';
}
export function readingDevice(app: AppService) {
  if (!app.isIOSApp) return 'Mac';
  return typographyProfile(app) === 'tablet' ? 'iPad' : 'iPhone';
}
export class TypographyJournal implements SegmentLog {
  static schema =
    'CREATE TABLE IF NOT EXISTS typography_ops(actor TEXT, seq INTEGER, id TEXT UNIQUE,clock INTEGER,profile TEXT,key TEXT,body TEXT,published INTEGER,PRIMARY KEY(actor,seq))';
  constructor(
    private db: DatabaseService,
    private vault: string,
    private scope: string,
    private actor: string,
  ) {}
  get groups() {
    return new GroupJournal(this.db, this.vault, this.actor);
  }
  async cursor() {
    const rows = await this.db.select<{ actor: string; n: number }>(
      'SELECT actor,max(seq) AS n FROM typography_ops GROUP BY actor',
    );
    return Object.fromEntries(rows.map((r) => [r.actor, r.n]));
  }
  private insert(op: Op, published: boolean) {
    return (
      'INSERT INTO typography_ops VALUES(' +
      [
        quote(op.actor_id),
        op.seq,
        quote(op.op_id),
        op.hlc,
        quote(op.profile),
        quote(op.key),
        quote(JSON.stringify(op)),
        Number(published),
      ].join(',') +
      ')'
    );
  }
  private async values(profile: Op['profile']) {
    const rows = await this.db.select<{ body: string }>(
      'SELECT body FROM typography_ops WHERE profile IN (?,?) ORDER BY clock,actor,id',
      ['shared', profile],
    );
    const values: Values = {};
    for (const r of rows) {
      const op = operation.parse(JSON.parse(r.body));
      values[op.key] = op.value;
    }
    return values;
  }
  async project(
    view: Partial<ViewSettings>,
    profile: Op['profile'],
    defaults: Partial<ViewSettings> = {},
  ) {
    const values = await this.values(profile),
      result = { ...view };
    for (const key of keys) {
      if (key in values) Object.assign(result, { [key]: values[key] ?? defaults[key] });
    }
    return {
      view: result,
      context: {
        vault: this.vault,
        values: Object.fromEntries(keys.map((k) => [k, result[k] ?? null])),
      } as TypographyContext,
    };
  }
  async save(
    view: Partial<ViewSettings>,
    profile: Op['profile'],
    base?: TypographyContext,
    defaults: Partial<ViewSettings> = {},
  ) {
    if (base?.vault === this.vault && keys.every((key) => (view[key] ?? null) === base.values[key]))
      return base;
    const current = await this.values(profile),
      deps = await this.cursor();
    const [last] = await this.db.select<{ n: number }>(
      'SELECT coalesce(max(clock),0) AS n FROM typography_ops',
    );
    let clock = Math.max(Date.now() * 1024, last!.n + 1);
    const writes = [];
    for (const key of keys) {
      const v = view[key] ?? null;
      if (base?.vault === this.vault ? base.values[key] === v : key in current) continue;
      const value = v === defaults[key] ? null : v;
      if ((current[key] ?? null) === value) continue;
      const op = operation.parse({
        schema_version: 2,
        vault_id: this.vault,
        scope: this.scope,
        actor_id: this.actor,
        op_id: crypto.randomUUID(),
        seq: (deps[this.actor] ?? 0) + 1,
        hlc: clock++,
        deps: { ...deps },
        key,
        profile: (shared as readonly string[]).includes(key) ? 'shared' : profile,
        value,
      });
      deps[this.actor] = op.seq;
      writes.push(this.insert(op, false));
    }
    if (writes.length) await this.db.batch(writes);
    return {
      vault: this.vault,
      values: Object.fromEntries(keys.map((k) => [k, view[k] ?? null])),
    } as TypographyContext;
  }
  async receive(raw: string) {
    const op = operation.parse(JSON.parse(raw));
    const strings = [
      'serifFont',
      'sansSerifFont',
      'defaultFont',
      'defaultCJKFont',
      'monospaceFont',
    ];
    if (
      op.value !== null &&
      (op.key === 'writingMode'
        ? !['auto', 'horizontal-tb', 'horizontal-rl', 'vertical-rl'].includes(String(op.value))
        : strings.includes(op.key)
          ? typeof op.value !== 'string'
          : ['fullJustification', 'hyphenation'].includes(op.key)
            ? typeof op.value !== 'boolean'
            : typeof op.value !== 'number')
    )
      throw new Error('Invalid typography value');
    if (
      op.vault_id !== this.vault ||
      op.scope !== this.scope ||
      (shared as readonly string[]).includes(op.key) !== (op.profile === 'shared')
    )
      throw new Error('Invalid typography operation');
    const [old] = await this.db.select<{ body: string }>(
      'SELECT body FROM typography_ops WHERE actor=? AND seq=?',
      [op.actor_id, op.seq],
    );
    if (old) {
      if (old.body !== JSON.stringify(op)) throw new Error('Conflicting typography operation');
      return true;
    }
    const cursor = await this.cursor();
    if (
      op.seq !== (cursor[op.actor_id] ?? 0) + 1 ||
      Object.entries(op.deps).some(([actor, n]) => (cursor[actor] ?? 0) < n)
    )
      return false;
    await this.db.batch([this.insert(op, true)]);
    return true;
  }
  async pending() {
    return (
      await this.db.select<{ body: string }>(
        'SELECT body FROM typography_ops WHERE published=0 ORDER BY seq LIMIT 128',
      )
    ).map((r) => r.body);
  }
  async published(id: string) {
    await this.db.execute('UPDATE typography_ops SET published=1 WHERE id=? AND actor=?', [
      id,
      this.actor,
    ]);
  }
}
export async function withGlobalTypography<T>(
  app: AppService,
  vault: string,
  work: (log: TypographyJournal, db: DatabaseService, device: string) => Promise<T>,
) {
  if (!isVaultId(vault)) throw new Error('Invalid iCloud library identity');
  const path = await app.resolveFilePath('.icloud-settings-' + vault + '.db', 'Books');
  return withLibraryLock(
    { getPrefix: async () => path },
    async () => {
      await app.createDir('', 'Books', true);
      const db = await app.openDatabase('icloud-settings', path, 'None');
      try {
        await db.batch([
          'CREATE TABLE IF NOT EXISTS segment_delivery(path TEXT PRIMARY KEY,stream TEXT,actor TEXT,seq INTEGER,uploaded INTEGER DEFAULT 0,checked INTEGER DEFAULT 0,peer TEXT)',
          'CREATE INDEX IF NOT EXISTS segment_status ON segment_delivery(stream,uploaded,checked)',
          'CREATE TABLE IF NOT EXISTS local_receipt(stream TEXT PRIMARY KEY,body TEXT)',
          'CREATE TABLE IF NOT EXISTS peer_receipt(stream TEXT,name TEXT,PRIMARY KEY(stream,name))',
          GroupJournal.schema,
          TypographyJournal.schema,
          'CREATE TABLE IF NOT EXISTS identity(id INTEGER PRIMARY KEY,actor TEXT NOT NULL)',
          'INSERT OR IGNORE INTO identity VALUES(1,' + quote(crypto.randomUUID()) + ')',
        ]);
        const [row] = await db.select<{ actor: string }>('SELECT actor FROM identity WHERE id=1');
        return await work(new TypographyJournal(db, vault, 'global', row!.actor), db, row!.actor);
      } finally {
        await db.close();
      }
    },
    'sync-replica',
  );
}
