import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ImportFromUrlDialog from '@/app/library/components/ImportFromUrlDialog';
import type { WebImportFeedback } from '@/glossa/plugins/webImport';
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

it('recovers in the same dialog and shows resource warnings only after saving', async () => {
  const close = vi.fn();
  const submit = vi.fn(
    async (
      _url: string,
      signal: AbortSignal,
      _stage: (value: string) => void,
      feedback: WebImportFeedback,
    ) => {
      const open = await feedback.onRecovery?.(
        { code: 'login_wall', message: 'Sign-in required' },
        signal,
      );
      if (open) feedback.onWarnings?.([{ code: 'missing_assets', count: 2 }]);
    },
  );
  render(<ImportFromUrlDialog isOpen onClose={close} onSubmit={submit} />);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'https://example.com/article' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  const open = await screen.findByRole('button', { name: 'Open page and continue' });
  expect(screen.queryByRole('progressbar')).toBeNull();
  fireEvent.click(open);
  await screen.findByText('Imported. Some images could not be saved.');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(close).toHaveBeenCalledOnce();
});

it('resolves pending recovery when its plugin activation is cancelled', async () => {
  const task = new AbortController();
  let recovered: boolean | undefined;
  const submit = vi.fn(
    async (
      _url: string,
      _signal: AbortSignal,
      _stage: (value: string) => void,
      feedback: WebImportFeedback,
    ) => {
      recovered = await feedback.onRecovery?.(
        { code: 'parse_failed', message: 'No article' },
        task.signal,
      );
      task.signal.throwIfAborted();
    },
  );
  render(<ImportFromUrlDialog isOpen onClose={vi.fn()} onSubmit={submit} />);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'https://example.com/article' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await screen.findByRole('button', { name: 'Open page and continue' });
  await act(async () => task.abort());
  expect(recovered).toBe(false);
  expect(screen.queryByRole('button', { name: 'Open page and continue' })).toBeNull();
});

it('lets the user choose between an abstract and its linked full-text PDF', async () => {
  const choice = vi.fn();
  const submit = vi.fn(
    async (
      _url: string,
      signal: AbortSignal,
      _stage: (value: string) => void,
      feedback: WebImportFeedback,
    ) => {
      choice(await feedback.onFullText?.('https://example.org/paper.pdf', signal));
    },
  );
  render(<ImportFromUrlDialog isOpen onClose={vi.fn()} onSubmit={submit} />);
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'https://example.org/abstract' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import full-text PDF' }));
  await waitFor(() => expect(choice).toHaveBeenCalledWith(true));
});
