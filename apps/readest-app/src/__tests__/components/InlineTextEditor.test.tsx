import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import InlineTextEditor from '@/components/InlineTextEditor';
afterEach(cleanup);
it('cancels without a blur save and keeps IME Enter inside the edit', () => {
  const save = vi.fn(async () => true);
  render(<InlineTextEditor value='Before' label='Title' onSave={save} />);
  fireEvent.doubleClick(screen.getByRole('button'));
  const input = screen.getByRole('textbox');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '中文' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(save).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull();
});
it('retains failed edits for retry and does not submit Enter and blur twice', async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<InlineTextEditor value='Before' label='Title' onSave={save} />);
  fireEvent.keyDown(screen.getByRole('button'), { key: 'F2' });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'After' } });
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() =>
    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true'),
  );
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  fireEvent.blur(screen.getByRole('textbox'));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(save).toHaveBeenCalledTimes(2);
});
