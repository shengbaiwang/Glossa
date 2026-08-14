import { describe, expect, test } from 'vitest';

import {
  GLOSSA_CHAPTER_SUMMARY_CACHE_MAX_AGE_MS,
  readChapterSummaryCache,
  writeChapterSummaryCache,
} from '@/glossa/ai';
import { createReadSectionContextPack } from '@/glossa/context/contextPack';
import type { StructuredTextBlock } from '@/glossa/context/types';
import { createBookConfigChapterSummaryCache } from '@/glossa/ui/bookConfigChapterSummaryCache';
import type { Book, BookConfig } from '@/types/book';
import { transformBookConfigToDB } from '@/utils/transform';
import { buildRemotePayload } from '@/services/sync/file/wire';

const now = 1_700_000_000_000;

const blocks = (
  documentId = 'fixture-book',
  sectionId = 'chapter-1.xhtml',
): StructuredTextBlock[] => [
  {
    text: 'The chapter argues that amber marks preserve evidence.',
    kind: 'paragraph',
    order: 0,
    anchor: {
      version: 1,
      documentId,
      format: 'epub',
      sectionId,
      cfi: 'epubcfi(/6/2!/4/1:0)',
      quote: { exact: 'The chapter argues that amber marks preserve evidence.' },
    },
  },
];

const packFor = (documentId?: string, sectionId?: string) => {
  const pack = createReadSectionContextPack({ section: blocks(documentId, sectionId) });
  if (!pack) throw new Error('Fixture must have read evidence');
  return pack;
};

const summaryFor = (sourceId: string) => ({
  status: 'summarized' as const,
  corePoints: [{ text: 'Amber marks preserve evidence.', sourceIds: [sourceId] }],
  evidence: [{ text: 'The chapter directly states this.', sourceIds: [sourceId] }],
  concepts: [],
  openQuestions: [],
});

describe('Glossa chapter summary cache', () => {
  test('hits only after local schema, source whitelist, and live-anchor validation', () => {
    const pack = packFor();
    const entries = writeChapterSummaryCache({
      entries: [],
      contextPack: pack,
      modelVersion: 'test-model-v1',
      summary: summaryFor(pack.segments[0]!.sourceId),
      now,
    });
    if (!entries) throw new Error('Fixture summary must be cacheable');

    expect(
      readChapterSummaryCache({
        entries,
        contextPack: pack,
        modelVersion: 'test-model-v1',
        now: now + 1,
      }),
    ).toMatchObject({ ok: true, summary: { status: 'summarized' } });
    expect(JSON.stringify(entries)).not.toContain(blocks()[0]!.text);

    const brokenCurrentSource = structuredClone(pack);
    brokenCurrentSource.segments[0]!.text = 'Tampered local source';
    expect(
      readChapterSummaryCache({
        entries,
        contextPack: brokenCurrentSource,
        modelVersion: 'test-model-v1',
        now: now + 1,
      }),
    ).toBeNull();
  });

  test('misses when evidence, document, section, model, prompt, or expiry changes', () => {
    const pack = packFor();
    const entries = writeChapterSummaryCache({
      entries: [],
      contextPack: pack,
      modelVersion: 'test-model-v1',
      promptVersion: 'prompt-v1',
      summary: summaryFor(pack.segments[0]!.sourceId),
      now,
    });
    if (!entries) throw new Error('Fixture summary must be cacheable');
    const changedEvidence = packFor();
    changedEvidence.segments[0]!.anchor.quote.exact = 'Different verified evidence.';
    changedEvidence.segments[0]!.text = 'Different verified evidence.';

    for (const options of [
      { contextPack: changedEvidence, modelVersion: 'test-model-v1', promptVersion: 'prompt-v1' },
      {
        contextPack: packFor('another-book'),
        modelVersion: 'test-model-v1',
        promptVersion: 'prompt-v1',
      },
      {
        contextPack: packFor('fixture-book', 'chapter-2.xhtml'),
        modelVersion: 'test-model-v1',
        promptVersion: 'prompt-v1',
      },
      { contextPack: pack, modelVersion: 'test-model-v2', promptVersion: 'prompt-v1' },
      { contextPack: pack, modelVersion: 'test-model-v1', promptVersion: 'prompt-v2' },
    ]) {
      expect(readChapterSummaryCache({ entries, ...options, now: now + 1 })).toBeNull();
    }
    expect(
      readChapterSummaryCache({
        entries,
        contextPack: pack,
        modelVersion: 'test-model-v1',
        promptVersion: 'prompt-v1',
        now: now + GLOSSA_CHAPTER_SUMMARY_CACHE_MAX_AGE_MS,
      }),
    ).toBeNull();
  });

  test('misses when read coverage expands outside the F02 request budget', () => {
    const budgetedBlocks = Array.from({ length: 33 }, (_, order) => ({
      ...blocks()[0]!,
      text: `Verified read block ${order}.`,
      order,
      anchor: {
        ...blocks()[0]!.anchor,
        cfi: `epubcfi(/6/2!/4/${order + 1}:0)`,
        quote: { exact: `Verified read block ${order}.` },
      },
    }));
    const original = createReadSectionContextPack({ section: budgetedBlocks });
    const expanded = createReadSectionContextPack({
      section: [
        {
          ...budgetedBlocks[0]!,
          text: 'Newly read earlier block.',
          order: -1,
          anchor: {
            ...budgetedBlocks[0]!.anchor,
            cfi: 'epubcfi(/6/2!/4/0:0)',
            quote: { exact: 'Newly read earlier block.' },
          },
        },
        ...budgetedBlocks,
      ],
    });
    if (!original || !expanded) throw new Error('Fixture must have read evidence');
    expect(expanded.segments.map(({ sourceId }) => sourceId)).toEqual(
      original.segments.map(({ sourceId }) => sourceId),
    );
    const entries = writeChapterSummaryCache({
      entries: [],
      contextPack: original,
      modelVersion: 'test-model-v1',
      summary: summaryFor(original.segments[0]!.sourceId),
      now,
    });
    expect(
      readChapterSummaryCache({
        entries,
        contextPack: expanded,
        modelVersion: 'test-model-v1',
        now: now + 1,
      }),
    ).toBeNull();
  });

  test('treats damaged entries and cached unknown source IDs as misses', () => {
    const pack = packFor();
    const entries = writeChapterSummaryCache({
      entries: [],
      contextPack: pack,
      modelVersion: 'test-model-v1',
      summary: summaryFor(pack.segments[0]!.sourceId),
      now,
    });
    if (!entries) throw new Error('Fixture summary must be cacheable');
    const unknownSource = structuredClone(entries);
    unknownSource[0]!.summary.corePoints[0]!.sourceIds = ['not-in-current-pack'];

    expect(
      readChapterSummaryCache({
        entries: [{ nope: true }],
        contextPack: pack,
        modelVersion: 'test-model-v1',
        now,
      }),
    ).toBeNull();
    expect(
      readChapterSummaryCache({
        entries: unknownSource,
        contextPack: pack,
        modelVersion: 'test-model-v1',
        now,
      }),
    ).toBeNull();
  });

  test('writes through a per-book config bridge and remains absent from cloud serializers', () => {
    const pack = packFor();
    let config: BookConfig = { bookHash: 'fixture-book', updatedAt: now };
    const cache = createBookConfigChapterSummaryCache({
      documentHash: 'fixture-book',
      getConfig: () => config,
      writeEntries: (entries) => {
        config = { ...config, glossaChapterSummaryCache: entries };
      },
    });
    cache.write({
      contextPack: pack,
      modelVersion: 'test-model-v1',
      summary: summaryFor(pack.segments[0]!.sourceId),
    });
    expect(config.glossaChapterSummaryCache).toHaveLength(1);

    const book = { hash: 'fixture-book', metaHash: 'meta', updatedAt: now } as Book;
    expect(JSON.stringify(buildRemotePayload(book, config, 'device'))).not.toContain(
      'glossaChapterSummaryCache',
    );
    expect(JSON.stringify(transformBookConfigToDB(config, 'user'))).not.toContain(
      'glossaChapterSummaryCache',
    );
  });
});
