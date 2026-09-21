import { expect, it } from 'vitest';
import { createReadingScope } from '@/glossa/harness/scope';
import {
  addAnswerVersion,
  currentAnswerVersion,
  selectAnswerVersion,
} from '@/glossa/conversation/schema';
import { validateHistory } from '@/glossa/conversation/store';
import { conversationMessages } from '@/glossa/conversation/generate';

const source = {
  sourceId: 's1',
  text: 'A condition limits a claim.',
  kind: 'paragraph' as const,
  anchor: {
    sectionIndex: 0,
    cfi: 'epubcfi(/6/2!/4/2)',
    quote: { exact: 'A condition limits a claim.', prefix: '', suffix: '' },
  },
};
const scope = () =>
  createReadingScope({ documentHash: 'book', kind: 'page', title: 'Page', sources: [source] });
const provider = { id: 'test', name: 'Test', baseUrl: 'http://localhost:1234/v1', model: 'test' };
const reading = () => ({ scope: scope(), sources: [source], mode: 'tools' as const });
const rawTurn = () => ({
  id: 'turn',
  question: 'Why?',
  blocks: [{ kind: 'background', text: 'Because of conditions. [1](#source-s1)', sourceIds: [] }],
  sources: [],
  createdAt: 1,
  provider,
  promptVersion: 'conversation-3',
  metadata: { bookTitle: 'Book', author: '', chapterTitle: '' },
  status: 'complete',
  reading: reading(),
});
const history = () => ({
  version: 1,
  bookId: 'book',
  activeId: 'session',
  sessions: [{ id: 'session', readingScope: scope(), turns: [rawTurn()] }],
});

it('persists an explicit reading scope and validated evidence without changing old chat records', () => {
  const saved = validateHistory(history());
  expect(saved.sessions[0]!.readingScope).toEqual(scope());
  expect(currentAnswerVersion(saved.sessions[0]!.turns[0]!).reading).toEqual(reading());
});
it('does not send reading-derived chat history after detaching the source', () => {
  const saved = validateHistory(history());
  expect(conversationMessages(saved.sessions[0]!.turns)).toEqual([]);
});
it('keeps each regenerated answer bound to its own scope and clears evidence for a plain version', () => {
  const original = validateHistory(history()).sessions[0]!.turns[0]!;
  const plain = {
    id: 'plain',
    question: 'General question',
    text: 'General answer',
    createdAt: 2,
    provider,
    status: 'complete' as const,
  };
  const changed = addAnswerVersion(original, plain);
  expect(currentAnswerVersion(changed).reading).toBeUndefined();
  expect('reading' in changed ? changed.reading : undefined).toBeUndefined();
  expect(currentAnswerVersion(selectAnswerVersion(changed, 'turn')).reading).toEqual(reading());
});
it('rejects cross-book scopes and source records that disagree with the authorized snapshot', () => {
  const otherBook = history();
  otherBook.bookId = 'another-book';
  expect(() => validateHistory(otherBook)).toThrow();
  const forged = history();
  forged.sessions[0]!.turns[0]!.reading.sources[0] = {
    ...source,
    text: 'Invented',
    anchor: { ...source.anchor, quote: { ...source.anchor.quote, exact: 'Invented' } },
  };
  expect(() => validateHistory(forged)).toThrow();
});
