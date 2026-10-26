import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import DeleteConfirmAlert from '@/components/DeleteConfirmAlert';
import '@/styles/globals.css';
import '@/styles/glossa.css';
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (key: string, values: Record<string, unknown> = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? name)),
}));
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
});
test('starts on Cancel, traps keyboard focus, and submits only the explicitly activated action', async () => {
  const confirm = vi.fn(),
    cancel = vi.fn();
  render(
    <DeleteConfirmAlert
      title='Remove selected books'
      message='Files are retained.'
      books={[{ hash: 'one', title: 'Original Book' }]}
      scope='This device only.'
      onCancel={cancel}
      onConfirm={confirm}
    />,
  );
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  await userEvent.keyboard('{Enter}');
  expect(cancel).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
  await userEvent.keyboard('{Enter}');
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.queryByText('Selected 1')).toBeNull();
  expect(screen.getByText('Original Book')).toBeTruthy();
});
test('retains distinct controls with 44px targets in electronic ink mode', async () => {
  document.documentElement.setAttribute('data-eink', 'true');
  render(
    <DeleteConfirmAlert
      title='Remove selected books'
      message='Files are retained.'
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );
  const dialog = screen.getByRole('alertdialog');
  expect(parseFloat(getComputedStyle(dialog).borderTopWidth)).toBeGreaterThanOrEqual(1);
  for (const button of screen.getAllByRole('button'))
    await expect
      .poll(() => button.getBoundingClientRect().height, {
        message: JSON.stringify({
          minHeight: getComputedStyle(button).minHeight,
          transform: getComputedStyle(button).transform,
          dialogTransform: getComputedStyle(dialog).transform,
        }),
      })
      .toBeGreaterThanOrEqual(44);
});
