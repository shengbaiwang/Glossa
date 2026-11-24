import type { Operation } from '@glossa/sync-contracts/sync';
import type { Bindings, Principal } from '../contracts';
import { statement, type Bind } from '../db/batch';
import { hash } from '../db/digest';

type Row = Record<string, Bind>;
export type Result = {
  status: 'applied' | 'conflict' | 'existing' | 'noop';
  code?: string;
  [key: string]: unknown;
};
export type Change = { kind: string; id: string; rev: number; [key: string]: unknown };
type Plan = { result: Result; writes: D1PreparedStatement[]; changes: Change[] };
function outcome(status: Result['status'], details: Record<string, unknown> = {}): Plan {
  return { result: { status, ...details }, writes: [], changes: [] };
}
const conflict = (code: string, details: Record<string, unknown> = {}) =>
  outcome('conflict', { code, ...details });
function applied(writes: D1PreparedStatement[], ...changes: Change[]): Plan {
  return { result: { status: 'applied', entity_rev: changes[0]!.rev }, writes, changes };
}
const nameKey = (s: string) => s.normalize('NFKC').trim().toLowerCase();
export const groupScope = async (db: D1Database, user: string, id: string, include: boolean) => {
  // Bounded preview and atomic edit. A subtree's member identities bind the owner's confirmation.
  const tree = `WITH RECURSIVE tree(id) AS (SELECT id FROM groups WHERE user_id=? AND id=? AND deleted_at IS NULL
    UNION ALL SELECT g.id FROM groups g JOIN tree ON g.parent_id=tree.id WHERE g.user_id=? AND g.deleted_at IS NULL)`;
  const sql = (body: string) => statement(db, tree + body, user, id, user, user);
  const [groups, books] = await db.batch<Row>([
    sql(
      ' SELECT id,parent_id,name_key,rev FROM groups WHERE user_id=? AND id IN tree ORDER BY id LIMIT 257',
    ),
    sql(
      ' SELECT id,group_id,rev,deleted_at FROM books WHERE user_id=? AND group_id IN tree ORDER BY id LIMIT 257',
    ),
  ]);
  if (!groups!.results.length) return null;
  if (groups!.results.length + books!.results.length > 256) return { large: true } as const;
  const members = { groups: groups!.results, books: books!.results };
  return { ...members, scope_digest: await hash([include, members]) };
};

export async function plan(
  env: Bindings,
  p: Principal,
  op: Operation,
  seq: number,
  now: number,
): Promise<Plan> {
  const db = env.DB,
    u = p.user,
    id = op.entity_id;
  const table = op.kind.startsWith('book.')
    ? 'books'
    : op.kind.startsWith('group.')
      ? 'groups'
      : 'annotations';
  const row = await statement(
    db,
    `SELECT * FROM ${table} WHERE user_id=? AND id=?`,
    u,
    id,
  ).first<Row>();
  const change = (data: Record<string, unknown>): Change => ({
    kind: op.kind,
    id,
    rev: seq,
    ...data,
  });
  const put = (fields: Record<string, Bind>) =>
    statement(
      db,
      `UPDATE ${table} SET
    ${Object.keys(fields)
      .map((k) => k + '=?')
      .join(',')},rev=? WHERE user_id=? AND id=?`,
      ...Object.values(fields),
      seq,
      u,
      id,
    );
  const parentAlive = async (g: string | null) =>
    g === null ||
    !!(await statement(
      db,
      'SELECT 1 FROM groups WHERE user_id=? AND id=? AND deleted_at IS NULL',
      u,
      g,
    ).first());
  const taken = async (parent: Bind, key: string) =>
    !!(await statement(
      db,
      `SELECT 1 FROM groups WHERE user_id=?
    AND parent_id IS ? AND name_key=? AND deleted_at IS NULL AND id<>?`,
      u,
      parent,
      key,
      id,
    ).first());
  if (op.kind.endsWith('.create')) {
    if (
      await statement(
        db,
        'SELECT 1 FROM purge_fences WHERE user_id=? AND kind=? AND id=?',
        u,
        op.kind.split('.')[0]!,
        id,
      ).first()
    )
      return conflict('entity_purged');
    if (row && op.kind !== 'book.create')
      return conflict('entity_exists', { current_rev: row.rev });
  } else {
    if (!row) return conflict('entity_missing');
    if ('base_rev' in op && row.rev !== op.base_rev)
      return conflict('revision_conflict', { current_rev: row.rev });
    if (row.deleted_at !== null && !op.kind.endsWith('.restore'))
      return conflict('entity_trashed', { current_rev: row.rev });
    if (row.deleted_at === null && op.kind.endsWith('.restore'))
      return conflict('entity_is_live', { current_rev: row.rev });
  }
  if (table === 'annotations') {
    const book = op.kind === 'annotation.create' ? op.data.book_id : row!.book_id!;
    if (
      !(await statement(
        db,
        'SELECT 1 FROM books WHERE user_id=? AND id=? AND deleted_at IS NULL',
        u,
        book,
      ).first())
    )
      return conflict('book_unavailable');
  }
  switch (op.kind) {
    case 'book.create': {
      const d = op.data;
      if (row && row.file_hash !== d.file_hash) return conflict('entity_exists');
      const duplicate = await statement(
        db,
        'SELECT id,rev,deleted_at FROM books WHERE user_id=? AND file_hash=?',
        u,
        d.file_hash,
      ).first<Row>();
      if (duplicate)
        return outcome('existing', {
          existing_book_id: duplicate.id,
          current_rev: duplicate.rev,
          deleted_at: duplicate.deleted_at,
        });
      if (!(await parentAlive(d.group_id))) return conflict('group_unavailable');
      return applied(
        [
          statement(
            db,
            `INSERT INTO books(user_id,id,file_hash,title,authors_json,language,format,thumbhash,group_id,rev)
        VALUES(?,?,?,?,?,?,?,?,?,?)`,
            u,
            id,
            d.file_hash,
            d.title,
            JSON.stringify(d.authors),
            d.language,
            d.format,
            d.thumbhash,
            d.group_id,
            seq,
          ),
        ],
        change({
          ...d,
          status: 'unread',
          progress_bp: 0,
          furthest_bp: 0,
          anchor: null,
          position_epoch: 0,
          position_rev: 0,
          deleted_at: null,
          finished_at: null,
        }),
      );
    }
    case 'book.patch': {
      const { authors, ...rest } = op.data;
      const fields: Record<string, Bind> = { ...rest };
      if (authors) fields.authors_json = JSON.stringify(authors);
      if (rest.status && rest.status !== row!.status)
        fields.finished_at = rest.status === 'finished' ? now : null;
      return applied(
        [put(fields)],
        change({
          ...op.data,
          ...('finished_at' in fields ? { finished_at: fields.finished_at } : {}),
        }),
      );
    }
    case 'book.move':
      if (!(await parentAlive(op.data.group_id))) return conflict('group_unavailable');
      return applied([put(op.data)], change(op.data));
    case 'book.progress': {
      const { intent, anchor, progress_bp } = op.data;
      const cur = row!.position_rev as number,
        epoch = row!.position_epoch as number,
        bp = row!.progress_bp as number;
      if (
        op.epoch !== epoch ||
        op.base_position_rev > cur ||
        (intent === 'seek' && op.base_position_rev !== cur)
      )
        return conflict('position_conflict', { current_rev: cur, epoch, progress_bp: bp });
      if (
        intent === 'advance' &&
        (progress_bp < bp || (progress_bp === bp && op.base_position_rev < cur))
      )
        return outcome('noop', { current_rev: cur, epoch, progress_bp: bp });
      const fields = {
        progress_bp,
        furthest_bp: Math.max(progress_bp, Number(row!.furthest_bp)),
        position_rev: seq,
        position_epoch: epoch + (intent === 'seek' ? 1 : 0),
      };
      return applied(
        [put({ ...fields, anchor_json: JSON.stringify(anchor) })],
        change({ ...fields, anchor }),
      );
    }
    case 'book.trash':
    case 'book.restore':
    case 'annotation.trash':
    case 'annotation.restore': {
      const deleted_at = op.kind.endsWith('.trash') ? now : null;
      return applied([put({ deleted_at })], change({ deleted_at }));
    }
    case 'group.create': {
      const { name, parent_id, sort_key } = op.data,
        key = nameKey(name);
      if (!(await parentAlive(parent_id))) return conflict('group_unavailable');
      if (await taken(parent_id, key)) return conflict('sibling_name_conflict');
      return applied(
        [
          statement(
            db,
            'INSERT INTO groups VALUES(?,?,?,?,?,?,?,?,NULL)',
            u,
            id,
            parent_id,
            name,
            key,
            sort_key,
            seq,
            seq,
          ),
        ],
        change({ ...op.data, placement_rev: seq, deleted_at: null }),
      );
    }
    case 'group.rename':
      if (await taken(row!.parent_id!, nameKey(op.data.name)))
        return conflict('sibling_name_conflict');
      return applied(
        [put({ name: op.data.name, name_key: nameKey(op.data.name) })],
        change(op.data),
      );
    case 'group.move': {
      const { parent_id, sort_key } = op.data;
      const current = {
        current_rev: row!.rev,
        parent_id: row!.parent_id,
        sort_key: row!.sort_key,
        placement_rev: row!.placement_rev,
      };
      if (!(await parentAlive(parent_id))) return conflict('group_unavailable', current);
      if (
        parent_id &&
        (await statement(
          db,
          `WITH RECURSIVE ancestors(id,parent_id) AS
        (SELECT id,parent_id FROM groups WHERE user_id=? AND id=? UNION ALL SELECT g.id,g.parent_id
        FROM groups g JOIN ancestors a ON a.parent_id=g.id WHERE g.user_id=?) SELECT 1 FROM ancestors WHERE id=?`,
          u,
          parent_id,
          u,
          id,
        ).first())
      )
        return conflict('tree_cycle', current);
      if (op.base_placement_rev !== row!.placement_rev)
        return conflict('placement_conflict', current);
      if (await taken(parent_id, String(row!.name_key)))
        return conflict('sibling_name_conflict', current);
      return applied(
        [put({ parent_id, sort_key, placement_rev: seq })],
        change({ parent_id, sort_key, placement_rev: seq }),
      );
    }
    case 'group.dissolve': {
      const scope = await groupScope(db, u, id, op.data.include_books);
      if (!scope || 'large' in scope) return conflict('scope_too_large');
      if (scope.scope_digest !== op.data.scope_digest) return conflict('scope_changed');
      const parent = row!.parent_id!,
        children = scope.groups.filter((g) => g.parent_id === id);
      const collision = await statement(
        db,
        `SELECT 1 FROM groups child JOIN groups sibling
        ON sibling.user_id=child.user_id AND sibling.name_key=child.name_key
        WHERE child.user_id=? AND child.parent_id=? AND sibling.parent_id IS ? AND sibling.id<>?
        AND child.deleted_at IS NULL AND sibling.deleted_at IS NULL LIMIT 1`,
        u,
        id,
        parent,
        id,
      ).first();
      if (collision) return conflict('sibling_name_conflict');
      const writes = [
        put({ deleted_at: now }),
        statement(
          db,
          'UPDATE groups SET parent_id=?,placement_rev=?,rev=? WHERE user_id=? AND parent_id=? AND deleted_at IS NULL',
          parent,
          seq,
          seq,
          u,
          id,
        ),
      ];
      const changes: Change[] = [
        change({ deleted_at: now }),
        ...children.map((g) => ({
          kind: 'group.move',
          id: String(g.id),
          rev: seq,
          parent_id: parent,
          sort_key: g.sort_key,
          placement_rev: seq,
        })),
      ];
      for (const b of scope.books) {
        const move = b.group_id === id,
          trash = op.data.include_books && b.deleted_at === null;
        if (!move && !trash) continue;
        const group_id = move ? parent : b.group_id!,
          deleted_at = trash ? now : b.deleted_at!;
        writes.push(
          statement(
            db,
            'UPDATE books SET group_id=?,deleted_at=?,rev=? WHERE user_id=? AND id=?',
            group_id,
            deleted_at,
            seq,
            u,
            b.id!,
          ),
        );
        changes.push({
          kind: trash ? 'book.trash' : 'book.move',
          id: String(b.id),
          rev: seq,
          group_id,
          deleted_at,
        });
      }
      return applied(writes, ...changes);
    }
    case 'annotation.create': {
      const { kind, ...d } = op.data;
      return applied(
        [
          statement(
            db,
            `INSERT INTO annotations(user_id,id,book_id,kind,page_index,cfi,rects_json,
        text_fingerprint,anchor_version,note,style_json,rev) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
            u,
            id,
            d.book_id,
            kind,
            d.page_index,
            d.cfi,
            JSON.stringify(d.rects),
            d.text_fingerprint,
            d.anchor_version,
            d.note,
            JSON.stringify(d.style),
            seq,
          ),
        ],
        change({ ...d, annotation_kind: kind, deleted_at: null }),
      );
    }
    case 'annotation.patch': {
      const f: Record<string, Bind> = {};
      if (op.data.note !== undefined) f.note = op.data.note;
      if (op.data.style) f.style_json = JSON.stringify(op.data.style);
      return applied([put(f)], change(op.data));
    }
  }
}
