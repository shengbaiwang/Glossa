import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ImportFromUrlDialog from '@/app/library/components/ImportFromUrlDialog';
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/components/Dialog', () => ({
  default: ({
    title,
    children,
    onClose,
  }: {
    title: string;
    children: React.ReactNode;
    onClose: () => void;
  }) => (
    <div role='dialog' aria-label={title}>
      <button onClick={onClose}>Close</button>
      {children}
    </div>
  ),
}));
afterEach(cleanup);
it('validates the address, keeps the draft on failure and supports retry', async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error('Page unavailable'))
    .mockResolvedValue(undefined);
  const close = vi.fn();
  render(<ImportFromUrlDialog isOpen onClose={close} onSubmit={submit} />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'ftp://example.com' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: 'https://example.com/article' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByRole('alert');
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'https://example.com/article',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
it('deduplicates Enter and aborts on close without letting a late result close a new dialog', async () => {
  let finish!: () => void;
  const submit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const close = vi.fn();
  const view = render(<ImportFromUrlDialog isOpen onClose={close} onSubmit={submit} />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'https://example.com/article' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(submit).toHaveBeenCalledOnce();
  expect(screen.getByRole('progressbar')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  const signal = (submit.mock.calls[0] as unknown as [string, AbortSignal])[1];
  expect(signal.aborted).toBe(true);
  expect(close).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
});

it('keeps the URL available for retry if persistence fails while stopping', async () => {
  let fail!: (error: Error) => void;
  const submit = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  const close = vi.fn();
  render(<ImportFromUrlDialog isOpen onClose={close} onSubmit={submit} />);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'https://example.com/article' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => fail(new Error('disk full')));
  expect(screen.getByRole('alert').textContent).toContain('disk full');
  expect(close).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
    'https://example.com/article',
  );
});
