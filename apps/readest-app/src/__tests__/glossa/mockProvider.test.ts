import { describe, expect, test, vi } from 'vitest';

import {
  type GlossaAnswer,
  MockProvider,
  collectProviderResponse,
  getContextPackId,
  validateGlossaAnswer,
} from '@/glossa/ai';
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

  test('keeps deterministic document and inference scenarios distinct', async () => {
    const documentAnswer = await collectProviderResponse(new MockProvider(), {
      action: 'explain',
      contextPack: pack(),
    });
    const inferenceAnswer = await collectProviderResponse(new MockProvider(), {
      action: 'relate',
      contextPack: pack(),
    });
    expect((documentAnswer.answer as GlossaAnswer).paragraphs[0]?.basis).toBe('document');
    expect((inferenceAnswer.answer as GlossaAnswer).paragraphs[0]).toMatchObject({
      basis: 'inference',
      sourceIds: expect.arrayContaining([pack().segments[0]!.sourceId]),
    });
  });

  test('answers a free question deterministically with the selected local evidence', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await collectProviderResponse(new MockProvider(), {
      question: '这句话是什么意思？',
      contextPack: pack(),
    });

    expect(response.text).toContain('这句话是什么意思？');
    expect(response.text).toContain('amber mark points to a passage');
    expect(validateGlossaAnswer(response.answer, pack()).ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('references the immediately preceding complete turn for a follow-up', async () => {
    const contextPack = pack();
    const first = await collectProviderResponse(new MockProvider(), {
      question: '这句话是什么意思？',
      contextPack,
    });
    const firstAnswer = validateGlossaAnswer(first.answer, contextPack);
    expect(firstAnswer.ok).toBe(true);
    if (!firstAnswer.ok) return;
    const second = await collectProviderResponse(new MockProvider(), {
      question: '请换一种更简单的方式说明。',
      contextPack,
      history: [
        {
          documentId: 'fixture-book',
          contextPackId: getContextPackId(contextPack),
          user: { role: 'user', text: '这句话是什么意思？' },
          assistant: {
            role: 'assistant',
            text: first.text,
            answer: firstAnswer.answer,
          },
        },
      ],
    });

    expect(second.text).toContain('上一问“这句话是什么意思？”');
  });

  test('returns insufficient evidence for a question outside the current ContextPack', async () => {
    const response = await collectProviderResponse(new MockProvider(), {
      question: '这本书的作者是谁？',
      contextPack: pack(),
    });
    expect(response.answer).toMatchObject({ status: 'insufficient_evidence', paragraphs: [] });
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
