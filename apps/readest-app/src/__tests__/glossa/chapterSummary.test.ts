import { describe, expect, test } from 'vitest';

import { MockProvider, collectProviderResponse, validateGlossaChapterSummary } from '@/glossa/ai';
import { createReadSectionContextPack } from '@/glossa/context/contextPack';
import type { StructuredTextBlock } from '@/glossa/context/types';

const blocks: StructuredTextBlock[] = [
  {
    text: 'The chapter argues that amber marks preserve evidence.',
    kind: 'paragraph',
    order: 0,
    anchor: {
      version: 1,
      documentId: 'fixture-book',
      format: 'epub',
      sectionId: 'chapter-1.xhtml',
      cfi: 'epubcfi(/6/2!/4/1:0)',
      quote: { exact: 'The chapter argues that amber marks preserve evidence.' },
    },
  },
];

const blocksWithIndependentCorePointSources: StructuredTextBlock[] = [
  ...blocks,
  {
    text: 'A second verified chapter claim has its own source.',
    kind: 'paragraph',
    order: 1,
    anchor: {
      version: 1,
      documentId: 'fixture-book',
      format: 'epub',
      sectionId: 'chapter-1.xhtml',
      cfi: 'epubcfi(/6/2!/4/3:0)',
      quote: { exact: 'A second verified chapter claim has its own source.' },
    },
  },
];

describe('Glossa chapter summary protocol', () => {
  test('validates all structured fields against the request ContextPack whitelist', () => {
    const pack = createReadSectionContextPack({ section: blocks });
    if (!pack) throw new Error('Fixture must have read evidence');
    const sourceId = pack.segments[0]!.sourceId;
    const summary = {
      status: 'summarized',
      corePoints: [{ text: 'Amber marks preserve evidence.', sourceIds: [sourceId] }],
      evidence: [{ text: 'The chapter states this directly.', sourceIds: [sourceId] }],
      concepts: [{ term: 'amber mark', explanation: 'A source marker.', sourceIds: [sourceId] }],
      openQuestions: [{ text: 'How should marks be compared?', sourceIds: [sourceId] }],
    };

    expect(validateGlossaChapterSummary(summary, pack)).toMatchObject({ ok: true });
    expect(
      validateGlossaChapterSummary(
        { ...summary, evidence: [{ text: 'Unsupported.', sourceIds: ['not-in-pack'] }] },
        pack,
      ),
    ).toMatchObject({ ok: false, reason: 'unknown-source-id' });
    expect(
      validateGlossaChapterSummary(
        {
          ...summary,
          corePoints: [{ text: 'Unsupported core point.', sourceIds: ['not-in-pack'] }],
        },
        pack,
      ),
    ).toMatchObject({ ok: false, reason: 'unknown-source-id' });
    expect(
      validateGlossaChapterSummary(
        { ...summary, corePoints: [{ text: 'Unsourced core point.', sourceIds: [] }] },
        pack,
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-schema' });
    expect(
      validateGlossaChapterSummary(
        {
          status: 'insufficient_evidence',
          corePoints: [{ text: 'Must be empty.', sourceIds: [sourceId] }],
          evidence: [],
          concepts: [],
          openQuestions: [],
        },
        pack,
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-schema' });
  });

  test('resolves each core point only to its own local ContextPack sources', () => {
    const pack = createReadSectionContextPack({ section: blocksWithIndependentCorePointSources });
    if (!pack) throw new Error('Fixture must have read evidence');
    const [firstSource, secondSource] = pack.segments.map(({ sourceId }) => sourceId);
    const validation = validateGlossaChapterSummary(
      {
        status: 'summarized',
        corePoints: [
          { text: 'First core point.', sourceIds: [firstSource!] },
          { text: 'Second core point.', sourceIds: [secondSource!] },
        ],
        evidence: [{ text: 'Supporting evidence.', sourceIds: [secondSource!] }],
        concepts: [],
        openQuestions: [],
      },
      pack,
    );

    expect(validation).toMatchObject({ ok: true });
    if (!validation.ok) return;
    expect(
      validation.corePointCitations.map((citations) => citations.map(({ sourceId }) => sourceId)),
    ).toEqual([[firstSource], [secondSource]]);
  });

  test('Mock returns a deterministic, locally verifiable summary without a network request', async () => {
    const pack = createReadSectionContextPack({ section: blocks });
    if (!pack) throw new Error('Fixture must have read evidence');
    const response = await collectProviderResponse(new MockProvider(), {
      action: 'summarize-read-section',
      contextPack: pack,
    });

    expect(response.answer).toMatchObject({ status: 'summarized' });
    expect(validateGlossaChapterSummary(response.answer, pack)).toMatchObject({ ok: true });
  });
});
