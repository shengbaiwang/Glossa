import { z } from 'zod';

import { glossaAnswerSchema, validateGlossaAnswer, type GlossaAnswer } from '../ai/answer';
import type { GlossaAction } from '../ai/provider';
import { sourceAnchorSchema, type SourceAnchor } from '../citations/sourceAnchor';
import type { ContextPack } from '../context/contextPack';

export const GLOSSA_SOURCED_NOTE_VERSION = 3;
export const GLOSSA_SOURCED_NOTE_V2_VERSION = 2;
export const GLOSSA_SOURCED_NOTE_LEGACY_VERSION = 1;

const nonEmptyText = z.string().trim().min(1);
const userNoteSchema = z.string().max(20_000);
const savedActionSchema = z.enum(['explain', 'translate', 'relate']);

const glossaSourcedNoteSourceSchema = z
  .object({
    sourceId: nonEmptyText,
    text: nonEmptyText,
    anchor: sourceAnchorSchema,
  })
  .strict()
  .superRefine((source, context) => {
    if (source.text !== source.anchor.quote.exact) {
      context.addIssue({ code: 'custom', message: 'Saved source text must match its TextQuote' });
    }
  });

const glossaSourcedNoteSelectionSchema = z
  .object({ text: nonEmptyText, anchor: sourceAnchorSchema })
  .strict()
  .superRefine((selection, context) => {
    if (selection.text !== selection.anchor.quote.exact) {
      context.addIssue({
        code: 'custom',
        message: 'Saved selection text must match its TextQuote',
      });
    }
  });

const glossaSourcedNoteRequestSchema = z.union([
  z.object({ action: savedActionSchema }).strict(),
  z.object({ question: nonEmptyText }).strict(),
]);

const sourceIdsMustBeUnique = (
  note: { documentId: string; sources: Array<{ sourceId: string; anchor: SourceAnchor }> },
  context: z.RefinementCtx,
) => {
  const sourceIds = new Set<string>();
  for (const source of note.sources) {
    if (source.anchor.documentId !== note.documentId) {
      context.addIssue({
        code: 'custom',
        message: 'Saved source document does not match its note',
      });
    }
    if (sourceIds.has(source.sourceId)) {
      context.addIssue({ code: 'custom', message: 'Saved note source IDs must be unique' });
    }
    sourceIds.add(source.sourceId);
  }
};

export const glossaSourcedNoteV1Schema = z
  .object({
    version: z.literal(GLOSSA_SOURCED_NOTE_LEGACY_VERSION),
    id: nonEmptyText,
    documentId: nonEmptyText,
    answer: nonEmptyText,
    sources: z.array(glossaSourcedNoteSourceSchema).min(1),
    createdAt: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine(sourceIdsMustBeUnique);

export const glossaSourcedNoteV2Schema = z
  .object({
    version: z.literal(GLOSSA_SOURCED_NOTE_V2_VERSION),
    id: nonEmptyText,
    documentId: nonEmptyText,
    context: z
      .object({
        selection: glossaSourcedNoteSelectionSchema,
        request: glossaSourcedNoteRequestSchema,
      })
      .strict(),
    answer: z.object({ text: nonEmptyText, basis: z.enum(['document', 'inference']) }).strict(),
    sources: z.array(glossaSourcedNoteSourceSchema).min(1),
    createdAt: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((note, context) => {
    sourceIdsMustBeUnique(note, context);
    if (note.context.selection.anchor.documentId !== note.documentId) {
      context.addIssue({
        code: 'custom',
        message: 'Saved selection document does not match its note',
      });
    }
  });

/**
 * V3 keeps the complete V1/V2 model result as provenance and adds a separate
 * user-owned field. Editing therefore cannot be mistaken for a change to the
 * original selection, request, answer, or verified citations.
 */
export const glossaSourcedNoteV3Schema = z
  .object({
    version: z.literal(GLOSSA_SOURCED_NOTE_VERSION),
    id: nonEmptyText,
    documentId: nonEmptyText,
    original: z.union([glossaSourcedNoteV1Schema, glossaSourcedNoteV2Schema]),
    sources: z.array(glossaSourcedNoteSourceSchema).min(1),
    userNote: userNoteSchema,
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((note, context) => {
    if (note.id !== note.original.id) {
      context.addIssue({
        code: 'custom',
        message: 'Saved note ID must match its immutable original',
      });
    }
    if (note.documentId !== note.original.documentId) {
      context.addIssue({
        code: 'custom',
        message: 'Saved note document must match its immutable original',
      });
    }
    sourceIdsMustBeUnique(note, context);
    if (JSON.stringify(note.sources) !== JSON.stringify(note.original.sources)) {
      context.addIssue({
        code: 'custom',
        message: 'Saved note sources must match its immutable original',
      });
    }
  });

/** V1/V2 remain readable; all new writes use a V3 wrapper with immutable provenance. */
export const glossaSourcedNoteSchema = z.union([
  glossaSourcedNoteV1Schema,
  glossaSourcedNoteV2Schema,
  glossaSourcedNoteV3Schema,
]);

export type GlossaSourcedNoteV1 = z.infer<typeof glossaSourcedNoteV1Schema>;
export type GlossaSourcedNoteV2 = z.infer<typeof glossaSourcedNoteV2Schema>;
export type GlossaSourcedNoteV3 = z.infer<typeof glossaSourcedNoteV3Schema>;
export type GlossaSourcedNote = z.infer<typeof glossaSourcedNoteSchema>;

export const getGlossaSourcedNoteOriginal = (
  note: GlossaSourcedNote,
): GlossaSourcedNoteV1 | GlossaSourcedNoteV2 => (note.version === 3 ? note.original : note);

export const getGlossaSourcedNoteUserNote = (note: GlossaSourcedNote): string =>
  note.version === 3 ? note.userNote : '';

export type GlossaSourcedNoteStore = {
  list(): GlossaSourcedNote[];
  save(options: {
    contextPack: ContextPack;
    answer: GlossaAnswer;
    paragraphIndex: number;
    request: Pick<{ action?: GlossaAction; question?: string }, 'action' | 'question'>;
  }): Promise<GlossaSourcedNoteSaveResult>;
  edit(options: { id: string; userNote: string }): Promise<GlossaSourcedNoteEditResult>;
  remove(options: { id: string }): Promise<GlossaSourcedNoteRemoveResult>;
};

export type GlossaSourcedNoteSaveResult =
  | { status: 'saved'; note: GlossaSourcedNoteV3; notes: GlossaSourcedNote[] }
  | { status: 'duplicate'; note: GlossaSourcedNote; notes: GlossaSourcedNote[] }
  | {
      status: 'failed';
      reason:
        | 'not-a-complete-answer'
        | 'invalid-answer'
        | 'invalid-request-context'
        | 'invalid-existing-notes'
        | 'write-failed';
    };

export type GlossaSourcedNoteEditResult =
  | { status: 'edited'; note: GlossaSourcedNoteV3; notes: GlossaSourcedNote[] }
  | { status: 'unchanged'; note: GlossaSourcedNote; notes: GlossaSourcedNote[] }
  | {
      status: 'failed';
      reason:
        | 'invalid-id'
        | 'invalid-user-note'
        | 'not-found'
        | 'invalid-existing-notes'
        | 'write-failed';
    };

export type GlossaSourcedNoteRemoveResult =
  | { status: 'removed'; note: GlossaSourcedNote; notes: GlossaSourcedNote[] }
  | {
      status: 'failed';
      reason: 'invalid-id' | 'not-found' | 'invalid-existing-notes' | 'write-failed';
    };

const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const sourceIdentity = (source: { sourceId: string; anchor: SourceAnchor }): string =>
  [
    source.sourceId,
    source.anchor.documentId,
    source.anchor.sectionId ?? '',
    source.anchor.cfi ?? '',
    source.anchor.quote.exact,
    source.anchor.quote.prefix ?? '',
    source.anchor.quote.suffix ?? '',
  ].join('\u001f');

/** Ignore corrupted, stale-document, and cross-document records before UI use. */
export const readGlossaSourcedNotes = (
  entries: unknown,
  documentId?: string,
): GlossaSourcedNote[] => {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const parsed = glossaSourcedNoteSchema.safeParse(entry);
    return parsed.success && (!documentId || parsed.data.documentId === documentId)
      ? [parsed.data]
      : [];
  });
};

const createNote = (options: {
  contextPack: ContextPack;
  answer: GlossaAnswer;
  paragraphIndex: number;
  request: Pick<{ action?: GlossaAction; question?: string }, 'action' | 'question'>;
  now: number;
}): GlossaSourcedNoteV3 | null => {
  if (options.answer.status !== 'answered') return null;
  const paragraph = options.answer.paragraphs[options.paragraphIndex];
  if (!paragraph) return null;
  const request = glossaSourcedNoteRequestSchema.safeParse(options.request);
  if (!request.success) return null;
  const validated = validateGlossaAnswer(options.answer, options.contextPack);
  if (!validated.ok) return null;
  const sources = new Map(
    options.contextPack.segments.map((segment) => [segment.sourceId, segment]),
  );
  const selection = sources.get(options.contextPack.selectionSourceId);
  if (!selection) return null;
  const selectionAnchor = sourceAnchorSchema.safeParse(selection.anchor);
  if (!selectionAnchor.success || selection.text !== selectionAnchor.data.quote.exact) return null;
  const savedSources = paragraph.sourceIds.flatMap((sourceId) => {
    const source = sources.get(sourceId);
    if (!source) return [];
    const anchor = sourceAnchorSchema.safeParse(source.anchor);
    if (!anchor.success || anchor.data.documentId !== selectionAnchor.data.documentId) return [];
    if (source.text !== anchor.data.quote.exact) return [];
    return [{ sourceId: source.sourceId, text: source.text, anchor: anchor.data }];
  });
  if (savedSources.length !== paragraph.sourceIds.length || savedSources.length === 0) return null;
  const documentId = selectionAnchor.data.documentId;
  if (savedSources.some((source) => source.anchor.documentId !== documentId)) return null;
  const context = {
    selection: { text: selection.text, anchor: selectionAnchor.data },
    request: request.data,
  };
  const id = `glossa-note_${stableHash(
    [
      documentId,
      paragraph.text,
      paragraph.basis,
      JSON.stringify(context),
      ...savedSources.map(sourceIdentity),
    ].join('\u001e'),
  )}`;
  const original = {
    version: GLOSSA_SOURCED_NOTE_V2_VERSION,
    id,
    documentId,
    context,
    answer: { text: paragraph.text, basis: paragraph.basis },
    sources: savedSources,
    createdAt: options.now,
  };
  const parsedOriginal = glossaSourcedNoteV2Schema.safeParse(original);
  if (!parsedOriginal.success) return null;
  const note = {
    version: GLOSSA_SOURCED_NOTE_VERSION,
    id: parsedOriginal.data.id,
    documentId: parsedOriginal.data.documentId,
    original: parsedOriginal.data,
    sources: parsedOriginal.data.sources,
    userNote: '',
    updatedAt: options.now,
  };
  const parsed = glossaSourcedNoteV3Schema.safeParse(note);
  return parsed.success ? parsed.data : null;
};

const isValidExistingCollection = (entries: unknown, documentId: string): entries is unknown[] => {
  if (entries !== undefined && !Array.isArray(entries)) return false;
  const existing = readGlossaSourcedNotes(entries, documentId);
  return existing.length === (entries?.length ?? 0);
};

const makeEditedNote = (
  note: GlossaSourcedNote,
  userNote: string,
  updatedAt: number,
): GlossaSourcedNoteV3 | null => {
  const original = getGlossaSourcedNoteOriginal(note);
  const parsed = glossaSourcedNoteV3Schema.safeParse({
    version: GLOSSA_SOURCED_NOTE_VERSION,
    id: original.id,
    documentId: original.documentId,
    original,
    sources: original.sources,
    userNote,
    updatedAt,
  });
  return parsed.success ? parsed.data : null;
};

/**
 * The Glossa protocol owns answer text and every local source anchor. The UI
 * adapter supplies config.json I/O, keeping Readest stores out of this domain.
 */
export const createGlossaSourcedNoteStore = (options: {
  documentId: string;
  getEntries(): unknown;
  writeEntries(entries: GlossaSourcedNote[]): Promise<void>;
  now?: () => number;
}): GlossaSourcedNoteStore => ({
  list: () => readGlossaSourcedNotes(options.getEntries(), options.documentId),
  save: async ({ contextPack, answer, paragraphIndex, request }) => {
    if (answer.status !== 'answered') return { status: 'failed', reason: 'not-a-complete-answer' };
    if (!glossaAnswerSchema.safeParse(answer).success)
      return { status: 'failed', reason: 'invalid-answer' };
    if (!glossaSourcedNoteRequestSchema.safeParse(request).success) {
      return { status: 'failed', reason: 'invalid-request-context' };
    }
    const entries = options.getEntries();
    if (!isValidExistingCollection(entries, options.documentId)) {
      return { status: 'failed', reason: 'invalid-existing-notes' };
    }
    const existing = readGlossaSourcedNotes(entries, options.documentId);
    const note = createNote({
      contextPack,
      answer,
      paragraphIndex,
      request,
      now: options.now?.() ?? Date.now(),
    });
    if (!note || note.documentId !== options.documentId) {
      return { status: 'failed', reason: 'invalid-answer' };
    }
    const duplicate = existing.find((entry) => entry.id === note.id);
    if (duplicate) return { status: 'duplicate', note: duplicate, notes: existing };
    const notes = [note, ...existing];
    try {
      await options.writeEntries(notes);
      return { status: 'saved', note, notes };
    } catch {
      return { status: 'failed', reason: 'write-failed' };
    }
  },
  edit: async ({ id, userNote }) => {
    if (!nonEmptyText.safeParse(id).success) return { status: 'failed', reason: 'invalid-id' };
    if (!userNoteSchema.safeParse(userNote).success) {
      return { status: 'failed', reason: 'invalid-user-note' };
    }
    const entries = options.getEntries();
    if (!isValidExistingCollection(entries, options.documentId)) {
      return { status: 'failed', reason: 'invalid-existing-notes' };
    }
    const existing = readGlossaSourcedNotes(entries, options.documentId);
    const index = existing.findIndex((note) => note.id === id);
    if (index < 0) return { status: 'failed', reason: 'not-found' };
    const current = existing[index]!;
    if (getGlossaSourcedNoteUserNote(current) === userNote) {
      return { status: 'unchanged', note: current, notes: existing };
    }
    const note = makeEditedNote(current, userNote, options.now?.() ?? Date.now());
    if (!note) return { status: 'failed', reason: 'invalid-existing-notes' };
    const notes = existing.map((entry, entryIndex) => (entryIndex === index ? note : entry));
    try {
      await options.writeEntries(notes);
      return { status: 'edited', note, notes };
    } catch {
      return { status: 'failed', reason: 'write-failed' };
    }
  },
  remove: async ({ id }) => {
    if (!nonEmptyText.safeParse(id).success) return { status: 'failed', reason: 'invalid-id' };
    const entries = options.getEntries();
    if (!isValidExistingCollection(entries, options.documentId)) {
      return { status: 'failed', reason: 'invalid-existing-notes' };
    }
    const existing = readGlossaSourcedNotes(entries, options.documentId);
    const note = existing.find((entry) => entry.id === id);
    if (!note) return { status: 'failed', reason: 'not-found' };
    const notes = existing.filter((entry) => entry.id !== id);
    try {
      await options.writeEntries(notes);
      return { status: 'removed', note, notes };
    } catch {
      return { status: 'failed', reason: 'write-failed' };
    }
  },
});
