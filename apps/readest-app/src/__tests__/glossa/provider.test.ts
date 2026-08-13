import { describe, expect, test } from 'vitest';

import {
  getBoundedHistory,
  getContextPackId,
  getFreeQuestion,
  validateGlossaAnswer,
  type GlossaConversationTurn,
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
  const selected = segment('amber mark points to a passage', 'epubcfi(/6/2!/4/3:8)');
  return createContextPack({ selection: selected, selectionContext: [selected] });
};

const turn = (number: number, contextPackId: string): GlossaConversationTurn => ({
  documentId: 'fixture-book',
  contextPackId,
  user: { role: 'user', text: `question ${number}` },
  assistant: {
    role: 'assistant',
    text: `answer ${number}`,
    answer: {
      status: 'answered',
      paragraphs: [{ text: `answer ${number}`, sourceIds: ['source_current'], basis: 'document' }],
      followups: [],
    },
  },
});

describe('AIProvider conversation protocol', () => {
  test('supports free questions and keeps shortcut actions compatible', () => {
    const contextPack = pack();
    expect(getFreeQuestion({ question: '  What does this mean?  ', contextPack })).toBe(
      'What does this mean?',
    );
    expect(getFreeQuestion({ action: 'explain', contextPack })).toBeNull();
  });

  test('binds history to the current document and ContextPack, truncating whole turns', () => {
    const contextPack = pack();
    const contextPackId = getContextPackId(contextPack);
    const retained = getBoundedHistory({
      question: 'follow up',
      contextPack,
      history: [
        turn(1, contextPackId),
        turn(2, contextPackId),
        turn(3, contextPackId),
        turn(4, contextPackId),
        { ...turn(5, contextPackId), documentId: 'another-book' },
        turn(6, 'another-context'),
      ],
    });

    expect(retained.map((item) => item.user.text)).toEqual([
      'question 2',
      'question 3',
      'question 4',
    ]);
    expect(retained.every((item) => item.user && item.assistant)).toBe(true);
  });

  test('does not let an old history source ID pass the current ContextPack whitelist', () => {
    const contextPack = pack();
    const historical = turn(1, 'old-context');
    historical.assistant.answer.paragraphs[0]!.sourceIds = ['source_from_old_context'];
    expect(
      getBoundedHistory({ question: 'follow up', contextPack, history: [historical] }),
    ).toEqual([]);
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
