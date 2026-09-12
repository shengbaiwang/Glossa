import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  deleteConversationPrompt,
  getActiveConversationPrompt,
  getConversationPromptState,
  MAX_CONVERSATION_PROMPTS,
  saveConversationPrompt,
  selectConversationPrompt,
} from '@/glossa/conversation/prompts';

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  vi.stubGlobal('window', {
    dispatchEvent: () => true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('creates, updates, selects and deletes prompts', () => {
  expect(getConversationPromptState()).toEqual({ activeId: null, prompts: [] });
  expect(getActiveConversationPrompt()).toBeNull();

  const first = saveConversationPrompt({ name: 'Tutor', content: 'Teach me step by step.' });
  const second = saveConversationPrompt({ name: 'Brief', content: 'Answer briefly.' });
  expect(getConversationPromptState().prompts.map((p) => p.name)).toEqual(['Tutor', 'Brief']);
  expect(getActiveConversationPrompt()).toBeNull();

  selectConversationPrompt(second.id);
  expect(getActiveConversationPrompt()?.content).toBe('Answer briefly.');

  saveConversationPrompt({ id: first.id, name: 'Coach', content: 'Guide with questions.' });
  const state = getConversationPromptState();
  expect(state.prompts).toHaveLength(2);
  expect(state.prompts[0]).toMatchObject({ name: 'Coach', content: 'Guide with questions.' });
  expect(state.activeId).toBe(second.id);

  selectConversationPrompt(first.id);
  deleteConversationPrompt(first.id);
  const afterDelete = getConversationPromptState();
  expect(afterDelete.prompts.map((p) => p.name)).toEqual(['Brief']);
  expect(afterDelete.activeId).toBeNull();

  selectConversationPrompt('missing');
  expect(getConversationPromptState().activeId).toBeNull();
});

it('rejects empty fields, oversized content and too many prompts', () => {
  expect(() => saveConversationPrompt({ name: '  ', content: 'x' })).toThrow();
  expect(() => saveConversationPrompt({ name: 'x', content: ' ' })).toThrow();
  expect(() => saveConversationPrompt({ name: 'x', content: 'x'.repeat(8001) })).toThrow();
  for (let i = 0; i < MAX_CONVERSATION_PROMPTS; i++)
    saveConversationPrompt({ name: `p${i}`, content: 'x' });
  expect(() => saveConversationPrompt({ name: 'extra', content: 'x' })).toThrow();
  expect(getConversationPromptState().prompts).toHaveLength(MAX_CONVERSATION_PROMPTS);
});

it('ignores corrupted or inconsistent storage', () => {
  localStorage.setItem('glossa.conversation-prompts.v1', 'not json');
  expect(getConversationPromptState()).toEqual({ activeId: null, prompts: [] });
  localStorage.setItem(
    'glossa.conversation-prompts.v1',
    JSON.stringify({ activeId: 'gone', prompts: [{ id: 'a', name: 'A', content: 'x' }] }),
  );
  const state = getConversationPromptState();
  expect(state.prompts).toHaveLength(1);
  expect(state.activeId).toBeNull();
});
