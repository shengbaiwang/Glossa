import { describe, expect, test } from 'vitest';

import {
  createGlossaSourcedNoteStore,
  readGlossaSourcedNotes,
} from '@/glossa/notes/glossaSourcedNotes';
import {
  createGlossaSourcedNotesExport,
  serializeGlossaSourcedNotesJson,
  serializeGlossaSourcedNotesMarkdown,
} from '@/glossa/notes/glossaSourcedNotesExport';
import { createBookConfigGlossaSourcedNoteStore } from '@/glossa/ui/bookConfigGlossaSourcedNoteStore';
import { createContextPack } from '@/glossa/context/contextPack';
import { validateGlossaAnswer } from '@/glossa/ai';
import type { SelectedText } from '@/glossa/context/types';
import type { BookConfig } from '@/types/book';
import { buildRemotePayload } from '@/services/sync/file/wire';
import { transformBookConfigToDB } from '@/utils/transform';

const now = 1_700_000_000_000;

const source = (text: string, cfi: string): SelectedText => ({
  text,
  anchor: {
    version: 1,
    documentId: 'fixture-book',
    format: 'epub',
    sectionId: 'chapter-1.xhtml',
    cfi,
    quote: { exact: text },
  },
});

const answerFor = (sourceIds: string[]) => ({
  status: 'answered' as const,
  paragraphs: [{ text: 'A verified answer paragraph.', sourceIds, basis: 'document' as const }],
  followups: [],
});

const actionRequest = { action: 'explain' as const };
const questionRequest = { question: 'Why does the amber mark matter?' };

describe('Glossa sourced notes', () => {
  test('persists a completed answer paragraph with every source resolved from its ContextPack', async () => {
    const first = source('First verified source.', 'epubcfi(/6/2!/4/1:0)');
    const second = source('Second verified source.', 'epubcfi(/6/2!/4/3:0)');
    const contextPack = createContextPack({ selection: second, selectionContext: [first, second] });
    const validated = validateGlossaAnswer(answerFor([contextPack.selectionSourceId]), contextPack);
    if (!validated.ok) throw new Error('Fixture answer must validate');

    let config: BookConfig = { bookHash: 'fixture-book', updatedAt: now };
    const store = createBookConfigGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getConfig: () => config,
      writeEntries: async (entries) => {
        config = { ...config, glossaSourcedNotes: entries };
      },
    });

    await expect(
      store.save({
        contextPack,
        answer: validated.answer,
        paragraphIndex: 0,
        request: actionRequest,
      }),
    ).resolves.toMatchObject({ status: 'saved' });
    const [note] = store.list();
    expect(note).toMatchObject({
      version: 3,
      documentId: 'fixture-book',
      original: {
        version: 2,
        answer: { text: 'A verified answer paragraph.', basis: 'document' },
        context: {
          selection: { text: 'Second verified source.', anchor: second.anchor },
          request: actionRequest,
        },
      },
    });
    expect(note?.sources).toEqual([
      expect.objectContaining({ text: 'Second verified source.', anchor: second.anchor }),
    ]);

    // A config.json round trip retains the local source payload and anchor.
    config = JSON.parse(JSON.stringify(config)) as BookConfig;
    expect(readGlossaSourcedNotes(config.glossaSourcedNotes)).toEqual([note]);
    expect(JSON.stringify(config.glossaSourcedNotes)).not.toContain('First verified source.');
    expect(JSON.stringify(config.glossaSourcedNotes)).toContain('Second verified source.');
    expect(JSON.stringify(config.glossaSourcedNotes)).not.toContain('scopeLabel');
    expect(JSON.stringify(config.glossaSourcedNotes)).not.toContain('retrieval');

    const book = { hash: 'fixture-book', metaHash: 'meta', updatedAt: now } as never;
    expect(JSON.stringify(buildRemotePayload(book, config, 'device'))).not.toContain(
      'glossaSourcedNotes',
    );
    expect(JSON.stringify(transformBookConfigToDB(config, 'user'))).not.toContain(
      'glossaSourcedNotes',
    );
  });

  test('reports duplicate saves and never silently removes a source', async () => {
    const first = source('First verified source.', 'epubcfi(/6/2!/4/1:0)');
    const second = source('Second verified source.', 'epubcfi(/6/2!/4/3:0)');
    const contextPack = createContextPack({ selection: second, selectionContext: [first, second] });
    const validated = validateGlossaAnswer(
      answerFor(contextPack.segments.map(({ sourceId }) => sourceId)),
      contextPack,
    );
    if (!validated.ok) throw new Error('Fixture answer must validate');
    let entries: BookConfig['glossaSourcedNotes'];
    const writeEntries = async (next: NonNullable<BookConfig['glossaSourcedNotes']>) => {
      entries = next;
    };
    const store = createGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getEntries: () => entries,
      writeEntries,
    });

    await store.save({
      contextPack,
      answer: validated.answer,
      paragraphIndex: 0,
      request: questionRequest,
    });
    await expect(
      store.save({
        contextPack,
        answer: validated.answer,
        paragraphIndex: 0,
        request: questionRequest,
      }),
    ).resolves.toMatchObject({ status: 'duplicate' });
    expect(entries?.[0]).toMatchObject({
      version: 3,
      original: {
        version: 2,
        context: { request: questionRequest, selection: { text: 'Second verified source.' } },
      },
    });
    expect(entries?.[0]?.sources).toHaveLength(2);
  });

  test('rejects incomplete, insufficient, invalid, or write-failed saves without changing config', async () => {
    const selected = source('Verified source.', 'epubcfi(/6/2!/4/1:0)');
    const contextPack = createContextPack({ selection: selected, selectionContext: [selected] });
    const store = createGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getEntries: () => [],
      writeEntries: async () => {
        throw new Error('disk unavailable');
      },
    });

    await expect(
      store.save({
        contextPack,
        answer: { status: 'insufficient_evidence', paragraphs: [], followups: [] },
        paragraphIndex: 0,
        request: actionRequest,
      }),
    ).resolves.toMatchObject({ status: 'failed', reason: 'not-a-complete-answer' });
    await expect(
      store.save({
        contextPack,
        answer: answerFor(['unknown']),
        paragraphIndex: 0,
        request: actionRequest,
      }),
    ).resolves.toMatchObject({ status: 'failed', reason: 'invalid-answer' });
    await expect(
      store.save({
        contextPack,
        answer: answerFor([contextPack.segments[0]!.sourceId]),
        paragraphIndex: 0,
        request: actionRequest,
      }),
    ).resolves.toMatchObject({ status: 'failed', reason: 'write-failed' });
  });

  test('edits only an independent user note while retaining immutable V2 evidence and a stable ID', async () => {
    const selected = source('Verified source.', 'epubcfi(/6/2!/4/1:0)');
    const contextPack = createContextPack({ selection: selected, selectionContext: [selected] });
    let entries: BookConfig['glossaSourcedNotes'];
    const store = createGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getEntries: () => entries,
      writeEntries: async (next) => {
        entries = next;
      },
      now: () => now + 1,
    });
    const saved = await store.save({
      contextPack,
      answer: answerFor([contextPack.selectionSourceId]),
      paragraphIndex: 0,
      request: actionRequest,
    });
    if (saved.status !== 'saved') throw new Error('Fixture note must save');
    const original = JSON.parse(JSON.stringify(saved.note.original));

    const edited = await store.edit({ id: saved.note.id, userNote: 'My reading note.' });

    expect(edited).toMatchObject({ status: 'edited' });
    if (edited.status !== 'edited') throw new Error('Fixture note must edit');
    expect(edited.note.id).toBe(saved.note.id);
    expect(edited.note.userNote).toBe('My reading note.');
    expect(edited.note.updatedAt).toBe(now + 1);
    expect(edited.note.original).toEqual(original);
    expect(JSON.parse(JSON.stringify(entries))).toEqual([edited.note]);
    expect(readGlossaSourcedNotes(JSON.parse(JSON.stringify(entries)), 'fixture-book')).toEqual([
      edited.note,
    ]);
  });

  test('keeps persisted notes unchanged when deletion fails or is not requested', async () => {
    const legacy = {
      version: 1,
      id: 'legacy-note',
      documentId: 'fixture-book',
      answer: 'A legacy answer.',
      sources: [
        {
          sourceId: 'source_legacy',
          text: 'Verified source.',
          anchor: source('Verified source.', 'epubcfi(/6/2!/4/1:0)').anchor,
        },
      ],
      createdAt: now,
    } satisfies NonNullable<BookConfig['glossaSourcedNotes']>[number];
    const entries: BookConfig['glossaSourcedNotes'] = [legacy];
    const store = createGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getEntries: () => entries,
      writeEntries: async () => {
        throw new Error('disk unavailable');
      },
    });

    await expect(store.remove({ id: legacy.id })).resolves.toMatchObject({
      status: 'failed',
      reason: 'write-failed',
    });
    expect(entries).toEqual([legacy]);
  });

  test('keeps V1/V2 originals readable and upgrades either version without changing its evidence', async () => {
    const savedSource = {
      sourceId: 'source_legacy',
      text: 'Verified source.',
      anchor: source('Verified source.', 'epubcfi(/6/2!/4/1:0)').anchor,
    };
    const v1 = {
      version: 1,
      id: 'v1-note',
      documentId: 'fixture-book',
      answer: 'A legacy answer.',
      sources: [savedSource],
      createdAt: now,
    } satisfies NonNullable<BookConfig['glossaSourcedNotes']>[number];
    const v2 = {
      version: 2,
      id: 'v2-note',
      documentId: 'fixture-book',
      context: {
        selection: { text: 'Verified source.', anchor: savedSource.anchor },
        request: actionRequest,
      },
      answer: { text: 'A V2 answer.', basis: 'document' },
      sources: [savedSource],
      createdAt: now,
    } satisfies NonNullable<BookConfig['glossaSourcedNotes']>[number];
    let entries: BookConfig['glossaSourcedNotes'] = [v1, v2];
    const store = createGlossaSourcedNoteStore({
      documentId: 'fixture-book',
      getEntries: () => entries,
      writeEntries: async (next) => {
        entries = next;
      },
      now: () => now + 1,
    });

    expect(store.list()).toEqual([v1, v2]);
    const editedV2 = await store.edit({ id: v2.id, userNote: 'A separate note.' });
    if (editedV2.status !== 'edited') throw new Error('V2 note must upgrade for editing');
    expect(editedV2.note).toMatchObject({
      version: 3,
      id: v2.id,
      original: v2,
      userNote: 'A separate note.',
      updatedAt: now + 1,
    });
    expect(editedV2.note.sources).toEqual(v2.sources);
    const editedV1 = await store.edit({ id: v1.id, userNote: 'Legacy personal note.' });
    if (editedV1.status !== 'edited') throw new Error('V1 note must upgrade for editing');
    expect(editedV1.note).toMatchObject({
      version: 3,
      id: v1.id,
      original: v1,
      userNote: 'Legacy personal note.',
      updatedAt: now + 1,
    });
    expect(store.list()).toHaveLength(2);
  });

  test('reads V1 safely while hiding malformed, cross-document, and stale-source records', () => {
    const validLegacy = {
      version: 1,
      id: 'legacy-note',
      documentId: 'fixture-book',
      answer: 'A legacy answer.',
      sources: [
        {
          sourceId: 'source_legacy',
          text: 'Verified source.',
          anchor: source('Verified source.', 'epubcfi(/6/2!/4/1:0)').anchor,
        },
      ],
      createdAt: now,
    };
    const crossDocument = {
      ...validLegacy,
      id: 'wrong-book',
      documentId: 'other-book',
      sources: validLegacy.sources.map((saved) => ({
        ...saved,
        anchor: { ...saved.anchor, documentId: 'other-book' },
      })),
    };
    const staleSource = {
      ...validLegacy,
      id: 'stale-source',
      sources: [{ ...validLegacy.sources[0], text: 'Different text.' }],
    };

    expect(
      readGlossaSourcedNotes([validLegacy, crossDocument, staleSource], 'fixture-book'),
    ).toEqual([validLegacy]);
  });

  test('exports only validated current-document V1–V3 notes with ordered, lossless anchors', () => {
    const first = {
      sourceId: 'source_first',
      text: 'First verified source.',
      anchor: {
        ...source('First verified source.', 'epubcfi(/6/2!/4/1:0)').anchor,
        quote: { exact: 'First verified source.', prefix: 'Before ', suffix: ' After' },
      },
    };
    const second = {
      sourceId: 'source_second',
      text: 'Second verified source.',
      anchor: source('Second verified source.', 'epubcfi(/6/2!/4/3:0)').anchor,
    };
    const v1 = {
      version: 1,
      id: 'v1-note',
      documentId: 'fixture-book',
      answer: 'A V1 answer.',
      sources: [first],
      createdAt: now,
    };
    const v2 = {
      version: 2,
      id: 'v2-note',
      documentId: 'fixture-book',
      context: {
        selection: { text: second.text, anchor: second.anchor },
        request: questionRequest,
      },
      answer: { text: 'A V2 answer.', basis: 'document' },
      sources: [first, second],
      createdAt: now,
    };
    const v3 = {
      version: 3,
      id: 'v3-note',
      documentId: 'fixture-book',
      original: { ...v2, id: 'v3-note' },
      sources: [first, second],
      userNote: 'My private reading reminder.',
      updatedAt: now + 1,
    };
    const crossDocument = {
      ...v1,
      id: 'other-document',
      documentId: 'other-book',
      sources: [
        {
          ...first,
          anchor: { ...first.anchor, documentId: 'other-book' },
        },
      ],
    };
    const withConversationHistory = { ...v1, id: 'has-history', history: ['do not export me'] };

    const entries = [crossDocument, withConversationHistory, v3, v2, v1];
    const exported = createGlossaSourcedNotesExport(entries, 'fixture-book');
    expect(exported).toMatchObject({ version: 1, documentId: 'fixture-book' });
    expect(exported.notes.map((note) => note.id)).toEqual(['v3-note', 'v2-note', 'v1-note']);
    expect(exported.notes[0]?.sources).toEqual([first, second]);

    const json = serializeGlossaSourcedNotesJson(entries, 'fixture-book');
    expect(JSON.parse(json)).toEqual(exported);
    expect(json).not.toContain('has-history');
    expect(json).not.toContain('other-book');
    expect(json).not.toContain('do not export me');

    const markdown = serializeGlossaSourcedNotesMarkdown(entries, 'fixture-book');
    expect(markdown).toContain('Second verified source.');
    expect(markdown).toContain('Why does the amber mark matter?');
    expect(markdown).toContain('A V2 answer.');
    expect(markdown).toContain('My private reading reminder.');
    expect(markdown.indexOf('source_first')).toBeLessThan(markdown.indexOf('source_second'));
    expect(markdown).toContain('epubcfi(/6/2!/4/1:0)');
    expect(markdown).toContain('This V1 note has no saved selection or request context.');
  });
});
