import { z } from 'zod';

const uuid = z.uuid(),
  seq = z
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1);
const common = { op_id: uuid, entity_id: uuid, lamport: seq.min(1) };
const name = z.string().trim().min(1).max(512);
const order = z.string().min(1).max(128);
const fieldStatus = z.enum(['unread', 'reading', 'finished']);
const fields = {
  title: name,
  authors: z.array(name).max(64),
  language: z.string().max(80).nullable(),
  thumbhash: z.string().max(200).nullable(),
  status: fieldStatus,
};
const patch = z
  .strictObject(fields)
  .partial()
  .refine((o) => Object.keys(o).length > 0);
const life = <T extends 'book.trash' | 'book.restore' | 'annotation.trash' | 'annotation.restore'>(
  kind: T,
) => z.strictObject({ ...common, kind: z.literal(kind), base_rev: seq });
const position = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('pdf'),
    page_index: seq,
    y: z.number().min(0).max(1).optional(),
  }),
  z.strictObject({ type: z.literal('epub'), cfi: z.string().min(1).max(4096) }),
]);
const unit = z.number().min(0).max(1);
const rect = z.strictObject({
  page_index: seq,
  xywh: z
    .tuple([unit, unit, unit, unit])
    .refine(([x, y, w, h]) => w > 0 && h > 0 && x + w <= 1 && y + h <= 1),
});
const note = z.string().max(16000),
  style = z.strictObject({ color: z.string().max(80).optional() });
export const operation = z.discriminatedUnion('kind', [
  z.strictObject({
    ...common,
    kind: z.literal('book.create'),
    data: z.strictObject({
      file_hash: z.string().regex(/^[a-f0-9]{64}$/),
      format: z.string().regex(/^[a-z0-9]{1,12}$/),
      title: name,
      authors: fields.authors.default([]),
      language: fields.language.default(null),
      thumbhash: fields.thumbhash.default(null),
      group_id: uuid.nullable().default(null),
    }),
  }),
  z.strictObject({ ...common, kind: z.literal('book.patch'), base_rev: seq, data: patch }),
  z.strictObject({
    ...common,
    kind: z.literal('book.move'),
    base_rev: seq,
    data: z.strictObject({ group_id: uuid.nullable() }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('book.progress'),
    base_position_rev: seq,
    epoch: seq,
    data: z.strictObject({
      intent: z.enum(['advance', 'seek']),
      progress_bp: z.int().min(0).max(10000),
      anchor: position,
    }),
  }),
  life('book.trash'),
  life('book.restore'),
  life('annotation.trash'),
  life('annotation.restore'),
  z.strictObject({
    ...common,
    kind: z.literal('group.create'),
    data: z.strictObject({ name, parent_id: uuid.nullable(), sort_key: order }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('group.rename'),
    base_rev: seq,
    data: z.strictObject({ name }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('group.move'),
    base_placement_rev: seq,
    data: z.strictObject({ parent_id: uuid.nullable(), sort_key: order }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('group.dissolve'),
    base_rev: seq,
    data: z.strictObject({
      include_books: z.boolean(),
      scope_digest: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('annotation.create'),
    data: z
      .strictObject({
        book_id: uuid,
        kind: z.enum(['highlight', 'note']),
        page_index: seq.nullable(),
        cfi: z.string().min(1).max(4096).nullable(),
        rects: z.array(rect).max(128),
        anchor_version: seq.min(1),
        text_fingerprint: z.string().max(256).nullable(),
        note,
        style,
      })
      .refine((a) => a.page_index !== null || a.cfi !== null),
  }),
  z.strictObject({
    ...common,
    kind: z.literal('annotation.patch'),
    base_rev: seq,
    data: z
      .strictObject({
        note: note.optional(),
        style: style.optional(),
      })
      .refine((o) => Object.keys(o).length > 0),
  }),
]);
export type Operation = z.infer<typeof operation>;
export const pushInput = z.strictObject({ ops: z.array(operation).min(1).max(64) });
export const ackInput = z.strictObject({ cursor: seq });
