import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ConversationReadingScope from '@/glossa/ui/ConversationReadingScope';
import { validateHistory } from '@/glossa/conversation/store';
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
afterEach(cleanup);
it('has only a reference switch and never asks for a passage', () => {
  const onChange = vi.fn();
  render(<ConversationReadingScope enabled onChange={onChange} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Citations on' }));
  expect(onChange).toHaveBeenCalledWith(false);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Choose reading range' })).toBeNull();
});
it('persists an explicit off state without invalidating old sessions', () => {
  const history = {
    version: 1,
    bookId: 'fixture',
    activeId: 's',
    sessions: [{ id: 's', turns: [], citationsEnabled: false }],
  };
  expect(validateHistory(history).sessions[0]?.citationsEnabled).toBe(false);
  expect(validateHistory({ ...history, sessions: [{ id: 's', turns: [] }] }).sessions).toHaveLength(
    1,
  );
});
