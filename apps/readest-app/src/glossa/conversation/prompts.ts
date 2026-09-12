import { z } from 'zod';
import { stubTranslation as _ } from '@/utils/misc';

export class PromptError extends Error {}

export const CONVERSATION_PROMPTS_EVENT = 'glossa-conversation-prompts-changed';
export const MAX_CONVERSATION_PROMPTS = 20;
const STORAGE_KEY = 'glossa.conversation-prompts.v1';

export const conversationPromptSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(60),
    content: z.string().trim().min(1).max(8000),
  })
  .strict();
export type ConversationPrompt = z.infer<typeof conversationPromptSchema>;

export interface ConversationPromptState {
  activeId: string | null;
  prompts: ConversationPrompt[];
}

const storedSchema = z
  .object({
    activeId: z.string().nullable(),
    prompts: z.array(conversationPromptSchema).max(MAX_CONVERSATION_PROMPTS),
  })
  .strict();

function read(): ConversationPromptState {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const stored = storedSchema.parse(raw);
    const ids = new Set(stored.prompts.map((prompt) => prompt.id));
    if (ids.size !== stored.prompts.length) throw new Error();
    return {
      activeId: stored.activeId && ids.has(stored.activeId) ? stored.activeId : null,
      prompts: stored.prompts,
    };
  } catch {
    return { activeId: null, prompts: [] };
  }
}

function write(state: ConversationPromptState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    throw new PromptError(_('Prompts could not be saved on this device.'));
  }
  window.dispatchEvent(new Event(CONVERSATION_PROMPTS_EVENT));
}

export function getConversationPromptState(): ConversationPromptState {
  return read();
}

export function getActiveConversationPrompt(): ConversationPrompt | null {
  const state = read();
  return state.prompts.find((prompt) => prompt.id === state.activeId) ?? null;
}

export function saveConversationPrompt(input: {
  id?: string;
  name: string;
  content: string;
}): ConversationPrompt {
  const name = input.name.trim();
  const content = input.content.trim();
  if (!name) throw new PromptError(_('Enter a prompt name.'));
  if (!content) throw new PromptError(_('Enter the prompt content.'));
  const state = read();
  const prompt = conversationPromptSchema.parse({
    id: input.id ?? crypto.randomUUID(),
    name,
    content,
  });
  const index = state.prompts.findIndex((item) => item.id === prompt.id);
  if (index < 0 && state.prompts.length >= MAX_CONVERSATION_PROMPTS)
    throw new PromptError(_('Delete a prompt before adding another.'));
  if (index < 0) state.prompts.push(prompt);
  else state.prompts[index] = prompt;
  write(state);
  return prompt;
}

export function deleteConversationPrompt(id: string): void {
  const state = read();
  state.prompts = state.prompts.filter((prompt) => prompt.id !== id);
  if (state.activeId === id) state.activeId = null;
  write(state);
}

export function selectConversationPrompt(id: string | null): void {
  const state = read();
  state.activeId = id && state.prompts.some((prompt) => prompt.id === id) ? id : null;
  write(state);
}
