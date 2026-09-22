import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ConversationReadingScope from '@/glossa/ui/ConversationReadingScope';
import { validateHistory } from '@/glossa/conversation/store';
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
afterEach(cleanup);
it('exposes an icon-only citation switch with a short tooltip and accessible state', () => {
  const onChange = vi.fn();
  const { rerender } = render(<ConversationReadingScope enabled onChange={onChange} />);
  const toggle = screen.getByRole('switch', { name: 'Citations', checked: true });
  expect(toggle.textContent).toBe('');
  expect(toggle.getAttribute('title')).toBe('Citations');
  expect(toggle.getAttribute('type')).toBe('button');
  fireEvent.click(toggle);
  expect(onChange).toHaveBeenCalledWith(false);
  rerender(<ConversationReadingScope enabled={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Citations', checked: false }));
  expect(onChange).toHaveBeenLastCalledWith(true);
  rerender(<ConversationReadingScope enabled={false} disabled onChange={onChange} />);
  fireEvent.click(toggle);
  expect(onChange).toHaveBeenCalledTimes(2);
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
