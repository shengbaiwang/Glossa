import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

import DeleteConfirmAlert from '@/components/DeleteConfirmAlert';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// The wrapped <Alert> calls useKeyDownActions, which reads these.
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));

vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));

afterEach(() => cleanup());

const setup = (props?: Partial<React.ComponentProps<typeof DeleteConfirmAlert>>) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <DeleteConfirmAlert
      title='Confirm Deletion'
      message='Are you sure to delete the selected book?'
      showPurgeToggle
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
};

describe('DeleteConfirmAlert purge toggle', () => {
  it('renders the purge toggle OFF by default and confirms without purging', () => {
    const { onConfirm } = setup();

    const toggle = screen.getByRole('checkbox') as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    const confirm = screen.getByText('Delete').closest('button')!;
    expect(confirm.className).toContain('btn-contrast');

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('escalates to a destructive purge when the toggle is turned on', () => {
    const { onConfirm } = setup();

    const toggle = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);

    const confirm = screen.getByText('Purge & Delete').closest('button')!;
    expect(confirm.className).toContain('btn-error');

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('omits the toggle and always confirms without purging when showPurgeToggle is false', () => {
    const { onConfirm } = setup({ showPurgeToggle: false });

    expect(screen.queryByRole('checkbox')).toBeNull();

    fireEvent.click(screen.getByText('Delete').closest('button')!);
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('invokes onCancel from the Cancel button', () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByText('Cancel').closest('button')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('deletion keyboard safety', () => {
  it('does not offer a fake Stop action for an operation without cancellation', () => {
    const onConfirm = vi.fn(() => new Promise<void>(() => {}));
    const { onCancel } = setup({ onConfirm });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
  it('stops cancellable work without dismissing its pending result', () => {
    const onStop = vi.fn();
    const { onCancel } = setup({ onConfirm: () => new Promise<void>(() => {}), onStop });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });
  it('focuses Cancel and does not turn an unrelated Enter into deletion', () => {
    const { onConfirm } = setup();
    expect(document.activeElement).toBe(screen.getByText('Cancel').closest('button'));
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('accepts only one confirmation while work is pending', () => {
    const onConfirm = vi.fn(() => new Promise<void>(() => {}));
    setup({ onConfirm });
    const button = screen.getByText('Delete').closest('button')!;
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
