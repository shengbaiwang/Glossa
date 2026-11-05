import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FolderDeleteDialog from '@/app/library/components/FolderDeleteDialog';
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
afterEach(cleanup);
it('keeps a failed group dissolution open for retry', async () => {
  const onClose = vi.fn(),
    onConfirm = vi.fn().mockResolvedValue(false);
  render(<FolderDeleteDialog paths={['Research/Books']} onConfirm={onConfirm} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(onClose).not.toHaveBeenCalled();
});
it('starts on Cancel and does not confirm from a window-level Enter', () => {
  const onConfirm = vi.fn();
  render(<FolderDeleteDialog paths={['Research']} onConfirm={onConfirm} onClose={vi.fn()} />);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(onConfirm).not.toHaveBeenCalled();
});

it('only includes group files after an explicit choice, and keeps that choice after a failure', async () => {
  const onConfirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const onClose = vi.fn();
  render(
    <FolderDeleteDialog
      paths={['Research', 'History']}
      containedBookCount={3}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  const checkbox = screen.getByRole('checkbox');
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText('Files and subgroups move up one level.')).toBeTruthy();
  fireEvent.click(checkbox);
  expect(screen.getByText('Files move to Recently Deleted and can be restored.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Delete groups and files' }));
  await screen.findByRole('alert');
  expect(onConfirm).toHaveBeenLastCalledWith(true);
  expect((checkbox as HTMLInputElement).checked).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete groups and files' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
it('keeps files by default and locks the choice while saving', async () => {
  let complete!: (value: boolean) => void;
  const onConfirm = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        complete = resolve;
      }),
  );
  render(
    <FolderDeleteDialog
      paths={['Research']}
      containedBookCount={2}
      onConfirm={onConfirm}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));
  expect(onConfirm).toHaveBeenCalledWith(false);
  expect(screen.getByRole('checkbox').closest('fieldset')?.disabled).toBe(true);
  complete(true);
  await waitFor(() =>
    expect(screen.getByRole('alertdialog').getAttribute('aria-busy')).toBe('false'),
  );
});

it('distinguishes selected files from the optional remaining group files', async () => {
  const onConfirm = vi.fn().mockResolvedValue(true);
  render(
    <FolderDeleteDialog
      paths={['Research']}
      books={[{ hash: 'selected', title: 'Selected file' }]}
      containedBookCount={2}
      onConfirm={onConfirm}
      onClose={vi.fn()}
    />,
  );
  expect(
    screen.getByText(
      'Selected files move to Recently Deleted. Other files and subgroups move up one level.',
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole('checkbox', {
      name: 'Also delete remaining group files (including subgroups, {{count}} total)',
    }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Delete group and files' }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(false));
});
