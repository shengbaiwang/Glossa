import { z } from 'zod';
import type { DatabaseService } from '@/types/database';
import type { SegmentLog } from './exchangeSegments';
import { md5Fingerprint } from '@/utils/md5';
import { collectFolderPaths, folderLabel, folderParent } from '@/app/library/utils/libraryFolders';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const number = z.number().int().nonnegative().safe();
const move = z
  .object({
    id,
    parent: id.nullable(),
    label: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[^/\\]+$/),
    order: number,
    deleted: z.boolean(),
    fields: z.array(z.enum(['parent', 'label', 'order'])).optional(),
  })
  .strict();
const operation = z
  .object({
    schema_version: z.literal(2),
    vault_id: z.string().uuid(),
    actor_id: z.string().uuid(),
    op_id: z.string().uuid(),
    seq: number.positive(),
    hlc: number,
    deps: z.record(z.string().uuid(), number),
    patch: z.array(move),
  })
  .strict();
type Row = z.infer<typeof move>;
type Op = z.infer<typeof operation>;
export type FolderContext = { vault: string; paths: Record<string, string>; order: string[] };
/** Replay in causal clock order so opposite delivery orders reject the same cycle. */
function tree(ops: Op[]) {
  const nodes = new Map<string, Row>(),
    rejected = new Set<string>();
  for (const op of ops)
    for (const delta of op.patch) {
      const before = nodes.get(delta.id);
      const row = before && delta.fields ? { ...before } : delta;
      if (before && delta.fields) {
        // Reordering siblings must not undo a concurrent move to another parent.
        if (delta.fields.includes('parent')) row.parent = delta.parent;
        if (delta.fields.includes('label')) row.label = delta.label;
        if (delta.fields.includes('order') && row.parent === delta.parent) row.order = delta.order;
        row.deleted = delta.deleted;
      }
      // A move may arrive after a concurrent deletion. IDs remain retired.
      if (nodes.get(row.id)?.deleted && !row.deleted) {
        rejected.add(op.op_id);
        continue;
      }
      let parent = row.parent;
      const visited = new Set([row.id]);
      while (parent && !visited.has(parent)) {
        visited.add(parent);
        parent = nodes.get(parent)?.parent ?? null;
      }
      if (parent) {
        rejected.add(op.op_id);
        continue;
      }
      nodes.set(row.id, row);
    }
  const paths: Record<string, string> = Object.create(null),
    order: string[] = [];
  function visit(parent: string | null, prefix: string) {
    const children = [...nodes.values()]
      .filter((row) => row.parent === parent && !row.deleted)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    for (const row of children) {
      let name = prefix + row.label;
      for (let suffix = 2; Object.hasOwn(paths, name); suffix++)
        name = prefix + row.label + ' ' + suffix;
      paths[name] = row.id;
      order.push(name);
      visit(row.id, name + '/');
    }
  }
  visit(null, '');
  return { paths, order, rejected };
}
export class GroupJournal implements SegmentLog {
  static schema =
    'CREATE TABLE IF NOT EXISTS group_ops(actor TEXT,seq INTEGER,id TEXT UNIQUE,clock INTEGER,body TEXT,published INTEGER,PRIMARY KEY(actor,seq))';
  constructor(
    private db: DatabaseService,
    private vault: string,
    private actor: string,
  ) {}
  async cursor() {
    const rows = await this.db.select<{ actor: string; n: number }>(
      'SELECT actor,max(seq) AS n FROM group_ops GROUP BY actor',
    );
    return Object.fromEntries(rows.map((r) => [r.actor, r.n]));
  }
  private async insert(op: Op, published: boolean) {
    await this.db.execute('INSERT INTO group_ops VALUES(?,?,?,?,?,?)', [
      op.actor_id,
      op.seq,
      op.op_id,
      op.hlc,
      JSON.stringify(op),
      Number(published),
    ]);
  }
  async project() {
    const records = await this.db.select<{ body: string }>(
      'SELECT body FROM group_ops ORDER BY clock,actor,id',
    );
    const t = tree(records.map((r) => operation.parse(JSON.parse(r.body))));
    return { vault: this.vault, paths: t.paths, order: t.order, rejected: [...t.rejected] };
  }
  async save(input: string[], base?: FolderContext, replacements?: Map<string, string>) {
    const next = collectFolderPaths([], input);
    if (base?.vault === this.vault && JSON.stringify(next) === JSON.stringify(base.order))
      return base;
    const current = await this.project();
    const previous = base?.vault === this.vault ? base : current;
    // A first import may add local folders. Only an edit with an observed base can delete one.
    const ids: Record<string, string> = Object.create(null);
    if (replacements)
      for (const [from, to] of replacements)
        if (to && previous.paths[from] && (!previous.paths[to] || from === to))
          ids[to] = previous.paths[from]!;
    next.forEach((path) => {
      ids[path] ??=
        previous.paths[path] ??
        current.paths[path] ??
        (base?.vault === this.vault ? crypto.randomUUID() : md5Fingerprint(path));
    });
    const patch: Row[] = [];
    const alive = new Set(Object.values(ids));
    if (base?.vault === this.vault)
      for (const [path, id] of Object.entries(previous.paths))
        if (!alive.has(id))
          patch.push({
            id,
            parent: previous.paths[folderParent(path)] ?? null,
            label: folderLabel(path),
            order: 0,
            deleted: true,
          });
    const oldPaths = new Map(Object.entries(previous.paths).map(([p, id]) => [id, p]));
    const indices = (paths: string[]) => {
      const counts = new Map<string, number>();
      return new Map(
        paths.map((p) => {
          const parent = folderParent(p),
            n = counts.get(parent) ?? 0;
          counts.set(parent, n + 1);
          return [p, n];
        }),
      );
    };
    const before = indices(previous.order),
      after = indices(next);
    for (const path of next) {
      const id = ids[path]!,
        parent = ids[folderParent(path)] ?? null,
        old = oldPaths.get(id),
        order = after.get(path)!;
      if (
        old &&
        folderLabel(old) === folderLabel(path) &&
        (previous.paths[folderParent(old)] ?? null) === parent &&
        before.get(old) === order
      )
        continue;
      const fields: Row['fields'] = [];
      if (!old || parent !== (previous.paths[folderParent(old)] ?? null)) fields.push('parent');
      if (!old || folderLabel(old) !== folderLabel(path)) fields.push('label');
      if (!old || before.get(old) !== order || fields.includes('parent')) fields.push('order');
      patch.push({ id, parent, label: folderLabel(path), order, deleted: false, fields });
    }
    if (patch.length) {
      const deps = await this.cursor();
      const [last] = await this.db.select<{ n: number }>(
        'SELECT coalesce(max(clock),0) AS n FROM group_ops',
      );
      const op = operation.parse({
        schema_version: 2,
        vault_id: this.vault,
        actor_id: this.actor,
        op_id: crypto.randomUUID(),
        seq: (deps[this.actor] ?? 0) + 1,
        hlc: Math.max(Date.now() * 1024, last!.n + 1),
        deps,
        patch,
      });
      await this.insert(op, false);
    }
    return this.project();
  }
  async receive(raw: string) {
    const op = operation.parse(JSON.parse(raw));
    if (op.vault_id !== this.vault) throw new Error('Invalid iCloud folder identity');
    const [prior] = await this.db.select<{ body: string }>(
      'SELECT body FROM group_ops WHERE actor=? AND seq=?',
      [op.actor_id, op.seq],
    );
    if (prior) {
      if (prior.body !== JSON.stringify(op)) throw new Error('Conflicting folder operation');
      return true;
    }
    const cursor = await this.cursor();
    if (
      (cursor[op.actor_id] ?? 0) + 1 !== op.seq ||
      Object.entries(op.deps).some(([actor, n]) => (cursor[actor] ?? 0) < n)
    )
      return false;
    await this.insert(op, true);
    return true;
  }
  async pending() {
    return (
      await this.db.select<{ body: string }>(
        'SELECT body FROM group_ops WHERE published=0 ORDER BY seq LIMIT 128',
      )
    ).map((r) => r.body);
  }
  async published(id: string) {
    await this.db.execute('UPDATE group_ops SET published=1 WHERE id=? AND actor=?', [
      id,
      this.actor,
    ]);
  }
}
export const folderMoves = new WeakMap<object, Map<string, string>>();
