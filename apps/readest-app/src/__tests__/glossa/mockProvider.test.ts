import { describe, expect, test } from 'vitest';

import { MockProvider, collectProviderResponse, validateGlossaAnswer } from '@/glossa/ai';
import { createContextPack } from '@/glossa/context/contextPack';
import type { SourceSegment } from '@/glossa/context/types';

const segment = (text: string, cfi: string): SourceSegment => ({
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

const pack = () => {
  const previous = segment('The Aster Index records every amber mark.', 'epubcfi(/6/2!/4/1:0)');
  const selected = segment('amber mark points to a passage', 'epubcfi(/6/2!/4/3:8)');
  return createContextPack({ selection: selected, selectionContext: [previous, selected] });
};

describe('MockProvider and answer validation', () => {
  test.each([
    'explain',
    'translate',
    'relate',
  ] as const)('streams a deterministic %s answer using only the supplied source IDs', async (action) => {
    const response = await collectProviderResponse(new MockProvider(), {
      action,
      contextPack: pack(),
    });

    expect(response.text.length).toBeGreaterThan(0);
    expect(response.events.filter((event) => event.type === 'text-delta')).toHaveLength(2);
    expect((response.answer as { status?: string } | undefined)?.status).toBe('answered');
    expect(validateGlossaAnswer(response.answer, pack()).ok).toBe(true);
  });

  test('returns structured insufficient evidence instead of inventing previous context', async () => {
    const selected = segment('amber mark points to a passage', 'epubcfi(/6/2!/4/3:8)');
    const contextPack = createContextPack({ selection: selected, selectionContext: [selected] });
    const response = await collectProviderResponse(new MockProvider(), {
      action: 'relate',
      contextPack,
    });

    expect(response.answer as { status?: string; paragraphs?: unknown[] }).toMatchObject({
      status: 'insufficient_evidence',
      paragraphs: [],
    });
  });

  test('rejects unknown, duplicate, and malformed citations and derives previews locally', () => {
    const contextPack = pack();
    const selectedSourceId = contextPack.segments.find(
      ({ role }) => role === 'selection',
    )!.sourceId;
    expect(
      validateGlossaAnswer(
        {
          status: 'answered',
          paragraphs: [{ text: 'Unsupported', sourceIds: ['unknown'], basis: 'document' }],
          followups: [],
        },
        contextPack,
      ),
    ).toMatchObject({ ok: false, reason: 'unknown-source-id' });
    expect(
      validateGlossaAnswer(
        {
          status: 'answered',
          paragraphs: [
            {
              text: 'Repeated',
              sourceIds: [selectedSourceId, selectedSourceId],
              basis: 'document',
            },
          ],
          followups: [],
        },
        contextPack,
      ),
    ).toMatchObject({ ok: false, reason: 'duplicate-source-id' });
    expect(validateGlossaAnswer({ status: 'answered', paragraphs: [] }, contextPack)).toMatchObject(
      {
        ok: false,
        reason: 'invalid-schema',
      },
    );
    const valid = validateGlossaAnswer(
      {
        status: 'answered',
        paragraphs: [{ text: 'Supported', sourceIds: [selectedSourceId], basis: 'document' }],
        followups: [],
      },
      contextPack,
    );
    expect(valid).toMatchObject({ ok: true });
    if (valid.ok) expect(valid.citations[0]?.text).toBe('amber mark points to a passage');
  });

  test('honours AbortSignal without a timer-dependent stream', async () => {
    const controller = new AbortController();
    const stream = new MockProvider().stream(
      { action: 'explain', contextPack: pack() },
      controller.signal,
    );
    const iterator = stream[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: 'text-delta' });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
