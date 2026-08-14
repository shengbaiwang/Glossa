import { describe, expect, test } from 'vitest';

import { getFreeQuestion, getHistorySummary, validateGlossaAnswer } from '@/glossa/ai';
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
  const selected = segment('amber mark points to a passage', 'epubcfi(/6/2!/4/3:8)');
  return createContextPack({ selection: selected, selectionContext: [selected] });
};

describe('AIProvider conversation protocol', () => {
  test('supports free questions and keeps shortcut actions compatible', () => {
    const contextPack = pack();
    expect(getFreeQuestion({ question: '  What does this mean?  ', contextPack })).toBe(
      'What does this mean?',
    );
    expect(getFreeQuestion({ action: 'explain', contextPack })).toBeNull();
  });

  test('accepts only a bounded, document-scoped question/status summary', () => {
    const contextPack = pack();
    expect(
      getHistorySummary({
        question: 'follow up',
        contextPack,
        historySummary: {
          documentId: 'fixture-book',
          text: '先前问题：What is an amber mark?（已回答）',
          turnCount: 1,
        },
      }),
    ).toMatchObject({ turnCount: 1 });
    expect(
      getHistorySummary({
        question: 'follow up',
        contextPack,
        historySummary: {
          documentId: 'fixture-book',
          text: 'assistant answer with source_current',
          turnCount: 1,
        },
      }),
    ).toBeNull();
  });

  test('does not let summary text become a source for the current ContextPack', () => {
    const contextPack = pack();
    expect(
      validateGlossaAnswer(
        {
          status: 'answered',
          paragraphs: [
            {
              text: 'Attempted historical citation',
              sourceIds: ['source_from_old_context'],
              basis: 'document',
            },
          ],
          followups: [],
        },
        contextPack,
      ),
    ).toMatchObject({ ok: false, reason: 'unknown-source-id' });
  });
});
