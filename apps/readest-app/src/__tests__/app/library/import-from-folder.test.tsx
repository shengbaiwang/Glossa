import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ImportFromFolderDialog from '@/app/library/components/ImportFromFolderDialog';
type DialogProps = React.ComponentProps<typeof ImportFromFolderDialog>;

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, string | number>) =>
    key.replace(/{{(\w+)}}/g, (_match, name) => String(values?.[name] ?? '')),
}));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => ({ current: null }) }));
vi.mock('@/components/Dialog', () => ({
  default: ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
    <div role='dialog'>
      <button type='button' aria-label='Close' onClick={onClose} />
      {children}
    </div>
  ),
}));

const files = [
  { path: 'short.md', size: 10 },
  { path: 'notes.TXT', size: 50 },
  { path: 'book.PDF', size: 100 },
  { path: 'cover.png', size: 30_000 },
];
const setup = (overrides: Partial<React.ComponentProps<typeof ImportFromFolderDialog>> = {}) => {
  const props = {
    initialDirectory: '/Books',
    onPickDirectory: vi.fn().mockResolvedValue(undefined),
    onScanDirectory: vi.fn().mockResolvedValue(files),
    onCancel: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<ImportFromFolderDialog {...props} />), props };
};
afterEach(cleanup);

it('reopens a failed picker from its retry action', async () => {
  const pick = vi
    .fn()
    .mockRejectedValueOnce(new Error('picker unavailable'))
    .mockResolvedValueOnce('/New');
  const { props } = setup({ onPickDirectory: pick });
  await screen.findByRole('button', { name: 'Import 3 books' });
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  await screen.findByText('Couldn’t open the folder picker. Please try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByTitle('/New');
  expect(pick).toHaveBeenCalledTimes(2);
  expect(props.onConfirm).not.toHaveBeenCalled();
});

it('automatically includes every supported format and small files without extra controls', async () => {
  const { props } = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Import 3 books' }));
  await waitFor(() => expect(props.onConfirm).toHaveBeenCalledTimes(1));
  expect(vi.mocked(props.onConfirm).mock.calls[0]![0]).toEqual({
    directory: '/Books',
    files: files.slice(0, 3),
    flatten: true,
  });
  expect(screen.queryByText('File Formats')).toBeNull();
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.queryByText('Read books in place')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('only offers preserving groups when matching books are in subfolders', async () => {
  const { props } = setup({
    onScanDirectory: vi.fn().mockResolvedValue([
      { path: 'History/book.epub', size: 10 },
      { path: 'History\\Ancient\\book.pdf', size: 20 },
    ]),
  });
  const toggle = await screen.findByRole('checkbox', { name: 'Keep subfolder groups' });
  expect((toggle as HTMLInputElement).checked).toBe(true);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 books' }));
  await waitFor(() =>
    expect(props.onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ flatten: true }),
      expect.any(AbortSignal),
      expect.any(Function),
    ),
  );
});

it('does not confirm while scanning and ignores the previous folder after changing it', async () => {
  let resolveFirst!: (value: typeof files) => void;
  const scan = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce([{ path: 'new.epub', size: 1 }]);
  const { props } = setup({
    onScanDirectory: scan,
    onPickDirectory: vi.fn().mockResolvedValue('/New'),
  });
  expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  await screen.findByRole('button', { name: 'Import 1 books' });
  await act(async () => resolveFirst(files));
  fireEvent.click(screen.getByRole('button', { name: 'Import 1 books' }));
  await waitFor(() => expect(props.onConfirm).toHaveBeenCalledTimes(1));
  expect(vi.mocked(props.onConfirm).mock.calls[0]![0].directory).toBe('/New');
  expect(scan.mock.calls[0]![1].aborted).toBe(true);
});

it('shows empty and failed scans with an inline retry', async () => {
  const scan = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce([]);
  const { props } = setup({ onScanDirectory: scan });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('No books found in this folder.');
  expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
  expect(props.onConfirm).not.toHaveBeenCalled();
});

it('cancels a scan and never imports a late result', async () => {
  let resolve!: (value: typeof files) => void;
  const { props, unmount } = setup({
    onScanDirectory: vi.fn(
      () =>
        new Promise<typeof files>((done) => {
          resolve = done;
        }),
    ),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(props.onCancel).toHaveBeenCalledOnce();
  unmount();
  await act(async () => resolve(files));
  expect(vi.mocked(props.onScanDirectory).mock.calls[0]![1].aborted).toBe(true);
  expect(props.onConfirm).not.toHaveBeenCalled();
});

it('prevents repeated submits and waits for a safe import stop before closing', async () => {
  let finish!: () => void;
  const confirm = vi.fn<DialogProps['onConfirm']>(
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  const { props } = setup({ onConfirm: confirm });
  const button = await screen.findByRole('button', { name: 'Import 3 books' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(confirm).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(confirm.mock.calls[0]![1].aborted).toBe(true);
  expect(props.onCancel).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(props.onCancel).toHaveBeenCalledOnce();
});

it('keeps a save failure visible even if the user requested a stop', async () => {
  let fail!: (error: Error) => void;
  const confirm = vi.fn<DialogProps['onConfirm']>(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  const { props } = setup({ onConfirm: confirm });
  fireEvent.click(await screen.findByRole('button', { name: 'Import 3 books' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => fail(new Error('disk full')));
  await screen.findByRole('alert');
  expect(props.onCancel).not.toHaveBeenCalled();
  expect(
    (screen.getByRole('button', { name: 'Import 3 books' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it('does not submit or use the previous directory while the native picker is open', async () => {
  let finish!: (directory: string | undefined) => void;
  const pick = vi.fn(
    () =>
      new Promise<string | undefined>((resolve) => {
        finish = resolve;
      }),
  );
  const { props, container } = setup({ onPickDirectory: pick });
  await screen.findByRole('button', { name: 'Import 3 books' });
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  fireEvent.submit(container.querySelector('form')!);
  expect(props.onConfirm).not.toHaveBeenCalled();
  await act(async () => finish(undefined));
  expect(
    (screen.getByRole('button', { name: 'Import 3 books' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
