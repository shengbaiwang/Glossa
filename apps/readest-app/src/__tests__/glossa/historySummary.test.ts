import { describe, expect, test } from 'vitest';

import { createContextPack } from '@/glossa/context/contextPack';
import { createGlossaHistorySummary } from '@/glossa/ai/historySummary';
import { getHistorySummary } from '@/glossa/ai/provider';
import type { SelectedText } from '@/glossa/context/types';

const selection: SelectedText = {
  text: 'amber mark',
  anchor: {
    version: 1,
    documentId: 'fixture-book',
    format: 'epub',
    sectionId: 'chapter-1.xhtml',
    cfi: 'epubcfi(/6/2!/4/1:0)',
    quote: { exact: 'amber mark' },
  },
};

describe('Glossa history summary', () => {
  test('keeps bounded prior questions and statuses without prior answer text or source IDs', () => {
    const summary = createGlossaHistorySummary('fixture-book', [
      { documentId: 'fixture-book', question: 'What is amber?', status: 'answered' },
      { documentId: 'fixture-book', question: 'Does it recur?', status: 'insufficient_evidence' },
    ]);

    expect(summary).toEqual({
      documentId: 'fixture-book',
      text: '先前问题：What is amber?（已回答）\n先前问题：Does it recur?（证据不足）',
      turnCount: 2,
    });
    expect(summary?.text).not.toContain('source_');
    expect(summary?.text).not.toContain('assistant answer');
  });

  test('does not pass a summary from another document to a provider', () => {
    const contextPack = createContextPack({ selection, selectionContext: [selection] });
    expect(
      getHistorySummary({
        question: 'follow up',
        contextPack,
        historySummary: { documentId: 'other-book', text: '先前问题：x（已回答）', turnCount: 1 },
      }),
    ).toBeNull();
  });
});
