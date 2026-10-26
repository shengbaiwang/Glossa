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
  render(<FolderDeleteDialog path='Research/Books' onConfirm={onConfirm} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(onClose).not.toHaveBeenCalled();
});
it('starts on Cancel and does not confirm from a window-level Enter', () => {
  const onConfirm = vi.fn();
  render(<FolderDeleteDialog path='Research' onConfirm={onConfirm} onClose={vi.fn()} />);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(onConfirm).not.toHaveBeenCalled();
});
