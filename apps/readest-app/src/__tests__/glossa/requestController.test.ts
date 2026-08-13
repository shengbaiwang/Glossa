import { describe, expect, test } from 'vitest';

import type { AIProvider, AIProviderRequest, StructuralRepairReason } from '@/glossa/ai';
import { GlossaRequestController, MockProvider } from '@/glossa/ai';
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

const makePack = (text: string) => {
  const selected = segment(text, `epubcfi(/6/2!/4/${text.length}:0)`);
  return createContextPack({ selection: selected, selectionContext: [selected] });
};

describe('GlossaRequestController', () => {
  test('replaces an unfinished request so its remaining output cannot overwrite the newer answer', async () => {
    const controller = new GlossaRequestController(new MockProvider());
    const first = { text: '', completed: 0, cancelled: 0 };
    const second = { text: '', completed: 0 };
    const initial = controller.run(
      { action: 'explain', contextPack: makePack('first selection') },
      {
        onText: (text) => (first.text += text),
        onRepairing: () => {},
        onComplete: () => first.completed++,
        onCancelled: () => first.cancelled++,
        onError: () => {},
      },
    );
    await Promise.resolve();
    const replacement = controller.run(
      { action: 'translate', contextPack: makePack('second selection') },
      {
        onText: (text) => (second.text += text),
        onRepairing: () => {},
        onComplete: () => second.completed++,
        onCancelled: () => {},
        onError: () => {},
      },
    );

    await Promise.all([initial, replacement]);
    expect(first.completed).toBe(0);
    expect(first.cancelled).toBe(1);
    expect(second.completed).toBe(1);
    expect(second.text).toContain('second selection');
    expect(first.text).not.toContain('应结合原文理解。');
  });

  test.each([
    ['empty JSON', 'empty-json', 'error'],
    ['invalid JSON', 'invalid-json', 'error'],
    ['schema error', 'invalid-schema', 'complete'],
    ['unknown source', 'unknown-source-id', 'complete'],
    ['duplicate source', 'duplicate-source-id', 'complete'],
    ['external basis', 'external-basis', 'complete'],
  ] as const)('repairs %s at most once without changing the request boundary', async (_label, reason, kind) => {
    const pack = makePack('repairable selection');
    const requests: AIProviderRequest[] = [];
    const provider: AIProvider = {
      async *stream(request) {
        requests.push(request);
        if (requests.length === 1) {
          if (kind === 'error') {
            yield {
              type: 'error' as const,
              error: {
                code: 'invalid-response' as const,
                message: 'invalid',
                repairReason: reason,
              },
            };
            return;
          }
          const sourceId = pack.segments[0]!.sourceId;
          const invalid =
            reason === 'invalid-schema'
              ? { status: 'answered', paragraphs: [] }
              : reason === 'unknown-source-id'
                ? {
                    status: 'answered',
                    paragraphs: [{ text: 'bad', sourceIds: ['unknown'], basis: 'document' }],
                    followups: [],
                  }
                : reason === 'duplicate-source-id'
                  ? {
                      status: 'answered',
                      paragraphs: [
                        { text: 'bad', sourceIds: [sourceId, sourceId], basis: 'document' },
                      ],
                      followups: [],
                    }
                  : {
                      status: 'answered',
                      paragraphs: [{ text: 'bad', sourceIds: [sourceId], basis: 'external' }],
                      followups: [],
                    };
          yield { type: 'complete' as const, answer: invalid };
          return;
        }
        yield {
          type: 'complete' as const,
          answer: {
            status: 'answered',
            paragraphs: [
              { text: 'repaired', sourceIds: [pack.segments[0]!.sourceId], basis: 'document' },
            ],
            followups: [],
          },
        };
      },
    };
    const repairing: StructuralRepairReason[] = [];
    let completed = 0;
    await new GlossaRequestController(provider).run(
      { question: 'same question', contextPack: pack },
      {
        onText: () => {},
        onRepairing: () => repairing.push(reason),
        onComplete: () => completed++,
        onCancelled: () => {},
        onError: () => {},
      },
    );
    expect(completed).toBe(1);
    expect(repairing).toEqual([reason]);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ question: 'same question', repair: { reason } });
    expect(requests[1]!.contextPack).toBe(pack);
    expect(requests[1]!.contextPack.segments).toEqual(pack.segments);
  });

  test('stops after the repaired result is invalid and never enters a retry loop', async () => {
    const pack = makePack('second invalid');
    let calls = 0;
    const provider: AIProvider = {
      async *stream() {
        calls++;
        yield {
          type: 'error',
          error: { code: 'invalid-response', message: 'bad', repairReason: 'invalid-json' },
        };
      },
    };
    const errors: string[] = [];
    await new GlossaRequestController(provider).run(
      { action: 'explain', contextPack: pack },
      {
        onText: () => {},
        onRepairing: () => {},
        onComplete: () => {},
        onCancelled: () => {},
        onError: (error) => errors.push(error.message),
      },
    );
    expect(calls).toBe(2);
    expect(errors).toEqual(['Glossa could not verify the repaired answer.']);
  });

  test('does not automatically retry transport, authentication, cancellation, or request errors', async () => {
    const nonStructural = [
      'invalid-auth',
      'insufficient-balance',
      'invalid-request',
      'rate-limited',
      'server-error',
      'overloaded',
      'timeout',
      'network-error',
    ] as const;
    for (const code of nonStructural) {
      let calls = 0;
      const provider: AIProvider = {
        async *stream() {
          calls++;
          yield { type: 'error', error: { code, message: code } };
        },
      };
      await new GlossaRequestController(provider).run(
        { action: 'explain', contextPack: makePack(code) },
        {
          onText: () => {},
          onRepairing: () => {},
          onComplete: () => {},
          onCancelled: () => {},
          onError: () => {},
        },
      );
      expect(calls).toBe(1);
    }
  });

  test('cancels the in-flight repair request and lets no stale result write back', async () => {
    const pack = makePack('cancel repair');
    let calls = 0;
    let repairStarted!: () => void;
    const repairing = new Promise<void>((resolve) => (repairStarted = resolve));
    const provider: AIProvider = {
      async *stream(_request, signal) {
        calls++;
        if (calls === 1) {
          yield {
            type: 'error',
            error: { code: 'invalid-response', message: 'bad', repairReason: 'invalid-json' },
          };
          return;
        }
        repairStarted();
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            {
              once: true,
            },
          ),
        );
      },
    };
    const controller = new GlossaRequestController(provider);
    let cancelled = 0;
    const pending = controller.run(
      { action: 'explain', contextPack: pack },
      {
        onText: () => {},
        onRepairing: () => {},
        onComplete: () => {},
        onCancelled: () => cancelled++,
        onError: () => {},
      },
    );
    await repairing;
    controller.cancel();
    await pending;
    expect(calls).toBe(2);
    expect(cancelled).toBe(1);
  });
});
