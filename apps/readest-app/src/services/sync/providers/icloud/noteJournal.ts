// Each database belongs to one (vault, book record, full content identity).
// A note keeps the causal context of the version the reader actually saw.
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { TypographyJournal } from './typography';
import { PositionJournal } from './positionJournal';
import { z } from 'zod';
import type { DatabaseService } from '@/types/database';
import type { BookNote } from '@/types/book';

export const digest = (text: string) => bytesToHex(sha256(new TextEncoder().encode(text)));
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const json = (value: unknown) => quote(JSON.stringify(value));
const uuid = z.string().uuid();
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const deps = z.record(uuid, counter);
const patch = z
  .object({
    type: z.enum(['annotation', 'bookmark', 'excerpt']),
    cfi: z.string().min(1),
    bookHash: z.string(),
    metaHash: z.string(),
    pdfRanges: z.array(z.string()),
    xpointer0: z.string(),
    xpointer1: z.string(),
    page: counter,
    text: z.string(),
    note: z.string(),
    style: z.enum(['highlight', 'underline', 'squiggly']),
    color: z.string(),
    global: z.boolean(),
    createdAt: counter,
    updatedAt: counter,
    deletedAt: counter,
  })
  .partial()
  .strict();
const fieldNames = Object.keys(patch.shape);
const opSchema = z
  .object({
    schema_version: z.literal(2),
    vault_id: uuid,
    actor_id: uuid,
    op_id: uuid,
    seq: counter.positive(),
    book: z.string(),
    fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    entity_id: z.string().min(1),
    hlc: counter,
    deps,
    basis: deps,
    parents: z.record(z.string(), z.array(uuid)).optional(),
    patch,
    clear: z.array(z.enum(fieldNames as [string, ...string[]])),
  })
  .strict();
type Operation = z.infer<typeof opSchema>;
type Vector = Record<string, number>;
export interface NoteEditContext {
  vault: string;
  seen: Vector;
  hashes: Record<string, string>;
  parents: Record<string, string[]>;
  resolveBody?: boolean;
  bodies: { id: string; text: string }[];
}
type Version = { actor: string; seq: number; clock: number; id: string; value: unknown };
type State = { seen: Vector; fields: Record<string, Version[]> };
const empty = (): State => ({ seen: {}, fields: {} });
const scalarHash = (v: unknown) => digest(JSON.stringify(v ?? null));
function apply(state: State, op: Operation) {
  for (const [key, value] of [
    ...Object.entries(op.patch),
    ...op.clear.map((k) => [k, null] as const),
  ]) {
    const parents = new Set(op.parents?.[key]);
    const heads = (state.fields[key] ?? []).filter((v) =>
      op.parents ? !parents.has(v.id) : (op.basis[v.actor] ?? 0) < v.seq,
    );
    heads.push({ actor: op.actor_id, seq: op.seq, clock: op.hlc, id: op.op_id, value });
    heads.sort(
      (a, b) =>
        a.clock - b.clock || (a.actor < b.actor ? -1 : a.actor > b.actor ? 1 : a.seq - b.seq),
    );
    state.fields[key] = heads;
  }
  state.seen[op.actor_id] = op.seq;
}
function project(id: string, state: State, vault: string): BookNote {
  const values: Record<string, unknown> = { id };
  const hashes: Record<string, string> = {};
  const parents: Record<string, string[]> = {};
  for (const key of fieldNames) {
    const versions = state.fields[key] ?? [];
    // A concurrent deletion stays visible as a tombstone until explicitly restored.
    const winner =
      (key === 'deletedAt' && versions.findLast((v) => v.value != null)) || versions.at(-1);
    if (winner?.value != null) values[key] = winner.value;
    parents[key] = versions.map((v) => v.id);
    hashes[key] = scalarHash(winner?.value);
  }
  const bodies = (state.fields['note'] ?? []).map((v) => ({
    id: v.id,
    text: String(v.value ?? ''),
  }));
  return {
    ...values,
    icloudEdit: { vault, seen: { ...state.seen }, hashes, bodies, parents },
  } as BookNote;
}

export class NoteJournal {
  private actor = '';
  constructor(
    private db: DatabaseService,
    readonly vault: string,
    readonly book: string,
    readonly fingerprint: string,
  ) {}
  get positions() {
    return new PositionJournal(this.db, this.vault, this.book, this.fingerprint, this.actor);
  }
  get typography() {
    return new TypographyJournal(
      this.db,
      this.vault,
      this.book + '/' + this.fingerprint,
      this.actor,
    );
  }
  async init() {
    await this.db.batch([
      PositionJournal.schema,
      TypographyJournal.schema,
      'CREATE TABLE IF NOT EXISTS legacy_notes (id TEXT PRIMARY KEY,hash TEXT NOT NULL,context TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS annotation_events (event_id TEXT PRIMARY KEY,annotation_id TEXT NOT NULL,kind TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS identity (slot INTEGER PRIMARY KEY, actor TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS operations (actor TEXT,seq INTEGER,id TEXT UNIQUE,clock INTEGER,body TEXT NOT NULL,published INTEGER NOT NULL,PRIMARY KEY(actor,seq))',
      'CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY,state TEXT NOT NULL)',
      'INSERT OR IGNORE INTO identity VALUES(1,' + quote(crypto.randomUUID()) + ')',
    ]);
    this.actor = (
      await this.db.select<{ actor: string }>('SELECT actor FROM identity WHERE slot=1')
    )[0]!.actor;
  }
  async cursor(): Promise<Vector> {
    const rows = await this.db.select<{ actor: string; seq: number }>(
      'SELECT actor,MAX(seq) AS seq FROM operations GROUP BY actor',
    );
    return Object.fromEntries(rows.map((r) => [r.actor, r.seq]));
  }
  async notes() {
    const rows = await this.db.select<{ id: string; state: string }>(
      'SELECT id,state FROM annotations ORDER BY id',
    );
    return rows.map((r) => project(r.id, JSON.parse(r.state), this.vault));
  }
  private async state(id: string): Promise<State> {
    const [row] = await this.db.select<{ state: string }>(
      'SELECT state FROM annotations WHERE id=?',
      [id],
    );
    return row ? JSON.parse(row.state) : empty();
  }
  private statements(op: Operation, state: State, received: boolean) {
    const kind =
      op.patch.deletedAt != null
        ? 'annotation.deleted'
        : Object.keys(state.fields).length
          ? 'annotation.updated'
          : 'annotation.created';
    apply(state, op);
    return [
      'INSERT INTO annotation_events VALUES(' +
        [op.op_id, op.entity_id, kind].map(quote).join(',') +
        ')',
      'INSERT INTO operations VALUES(' +
        [quote(op.actor_id), op.seq, quote(op.op_id), op.hlc, json(op), Number(received)].join(
          ',',
        ) +
        ')',
      'INSERT OR REPLACE INTO annotations VALUES(' + quote(op.entity_id) + ',' + json(state) + ')',
    ];
  }
  // The legacy reader may keep changing a sidecar after the new vault was bound.
  // Compare against that importer's own last version, so new-device edits stay independent.
  async importLegacy(notes: BookNote[]) {
    const fresh: BookNote[] = [];
    for (const note of notes) {
      const hash = scalarHash(
        fieldNames.map((k) => (note as unknown as Record<string, unknown>)[k]),
      );
      const [row] = await this.db.select<{ hash: string; context: string }>(
        'SELECT hash,context FROM legacy_notes WHERE id=?',
        [note.id],
      );
      if (row?.hash !== hash)
        fresh.push({ ...note, icloudEdit: row ? JSON.parse(row.context) : undefined });
    }
    await this.save(fresh, true);
  }
  async eventsAfter(cursor: number, limit = 100) {
    return this.db.select<{
      cursor: number;
      event_id: string;
      annotation_id: string;
      kind: string;
      body: string;
    }>(
      'SELECT e.rowid AS cursor,e.event_id,e.annotation_id,e.kind,o.body FROM annotation_events e JOIN operations o ON o.id=e.event_id WHERE e.rowid>? ORDER BY e.rowid LIMIT ?',
      [cursor, Math.max(1, Math.min(limit, 500))],
    );
  }
  async save(notes: BookNote[], legacy = false) {
    const vector = await this.cursor();
    const [last] = await this.db.select<{ clock: number }>(
      'SELECT coalesce(max(clock),0) AS clock FROM operations',
    );
    let clock = Math.max(Date.now() * 1024, last!.clock + 1);
    const writes: string[] = [];
    const contexts: [BookNote, NoteEditContext][] = [];
    for (const note of notes) {
      const base = note.icloudEdit?.vault === this.vault ? note.icloudEdit : undefined;
      const values = note as unknown as Record<string, unknown>;
      let changes = fieldNames.filter((k) =>
        base ? scalarHash(values[k]) !== base.hashes[k] : values[k] != null,
      );
      if (base?.resolveBody && !changes.includes('note')) changes.push('note');
      if (!changes.length) continue;
      const state = await this.state(note.id);
      const current = project(note.id, state, this.vault).icloudEdit!;
      if (!base) changes = changes.filter((k) => current.hashes[k] !== scalarHash(values[k]));
      if (!changes.length) {
        contexts.push([note, current]);
        continue;
      }
      const op = opSchema.parse({
        schema_version: 2,
        vault_id: this.vault,
        book: this.book,
        fingerprint: this.fingerprint,
        actor_id: this.actor,
        op_id: crypto.randomUUID(),
        seq: (vector[this.actor] ?? 0) + 1,
        hlc: clock++,
        deps: { ...vector },
        basis: base?.seen ?? {},
        entity_id: note.id,
        parents: Object.fromEntries(changes.map((k) => [k, base?.parents?.[k] ?? []])),
        patch: Object.fromEntries(
          changes.filter((k) => values[k] != null).map((k) => [k, values[k]]),
        ),
        clear: changes.filter((k) => values[k] == null),
      });
      writes.push(...this.statements(op, state, false));
      vector[this.actor] = op.seq;
      // Keep the input's own visible values as its next comparison baseline:
      // a stale window saving again must not claim it displayed a concurrent body.
      const context = project(note.id, state, this.vault).icloudEdit!;
      context.seen = { ...op.basis, [this.actor]: op.seq };
      context.hashes = Object.fromEntries(fieldNames.map((k) => [k, scalarHash(values[k])]));
      context.parents = {
        ...base?.parents,
        ...Object.fromEntries(changes.map((k) => [k, [op.op_id]])),
      };
      contexts.push([note, context]);
    }
    if (legacy)
      for (const [note, context] of contexts) {
        const hash = scalarHash(
          fieldNames.map((k) => (note as unknown as Record<string, unknown>)[k]),
        );
        writes.push(
          'INSERT OR REPLACE INTO legacy_notes VALUES(' +
            quote(note.id) +
            ',' +
            quote(hash) +
            ',' +
            json(context) +
            ')',
        );
      }
    if (writes.length) await this.db.batch(writes);
    for (const [note, context] of contexts) note.icloudEdit = context;
  }
  async receive(raw: string) {
    const op = opSchema.parse(JSON.parse(raw));
    if (op.vault_id !== this.vault || op.book !== this.book || op.fingerprint !== this.fingerprint)
      throw new Error('iCloud book identity mismatch');
    const [prior] = await this.db.select<{ body: string }>(
      'SELECT body FROM operations WHERE actor=? AND seq=?',
      [op.actor_id, op.seq],
    );
    if (prior) {
      if (prior.body !== JSON.stringify(op)) throw new Error('Conflicting iCloud log segment');
      return true;
    }
    const vector = await this.cursor();
    if (
      (vector[op.actor_id] ?? 0) + 1 !== op.seq ||
      Object.entries(op.deps).some(([id, n]) => (vector[id] ?? 0) < n)
    )
      return false;
    if (Object.entries(op.basis).some(([id, n]) => (op.deps[id] ?? 0) < n))
      throw new Error('Invalid iCloud operation context');
    await this.db.batch(this.statements(op, await this.state(op.entity_id), true));
    return true;
  }
  async pending() {
    return (
      await this.db.select<{ body: string }>(
        'SELECT body FROM operations WHERE published=0 ORDER BY seq LIMIT 128',
      )
    ).map((r) => r.body);
  }
  async published(id: string) {
    await this.db.execute('UPDATE operations SET published=1 WHERE actor=? AND id=?', [
      this.actor,
      id,
    ]);
  }
}
