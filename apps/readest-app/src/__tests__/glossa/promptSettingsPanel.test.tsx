import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  getActiveConversationPrompt,
  getConversationPromptState,
  saveConversationPrompt,
  selectConversationPrompt,
} from '@/glossa/conversation/prompts';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

import PromptSettingsPanel from '@/glossa/ui/PromptSettingsPanel';

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

it('creates, edits and deletes prompts', () => {
  render(<PromptSettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: '讲解' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
    target: { value: '逐句解释难点。' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(getConversationPromptState().prompts).toHaveLength(1);
  expect(screen.getByText('讲解')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), {
    target: { value: '换个讲法。' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(getConversationPromptState().prompts[0]!.content).toBe('换个讲法。');

  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(getConversationPromptState().prompts).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Delete?' }));
  expect(getConversationPromptState().prompts).toHaveLength(0);
});

it('shows validation errors and keeps the editor open', () => {
  render(<PromptSettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert').textContent).toBe('Enter a prompt name.');
  expect(getConversationPromptState().prompts).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('textbox', { name: 'Prompt' })).toBeNull();
});

it('keeps the picker selection in sync when the active prompt is deleted', () => {
  const prompt = saveConversationPrompt({ name: 'A', content: 'x' });
  selectConversationPrompt(prompt.id);
  expect(getActiveConversationPrompt()?.id).toBe(prompt.id);
  render(<PromptSettingsPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete?' }));
  expect(getActiveConversationPrompt()).toBeNull();
});
