import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Toast } from '@/components/Toast';
import { eventDispatcher } from '@/utils/event';
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({ safeAreaInsets: {} }) }));
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('gives repeated edits a fresh timeout even when their saved message is identical', async () => {
  render(<Toast />);
  await act(() => eventDispatcher.dispatch('toast', { message: 'Saved', timeout: 1000 }));
  act(() => vi.advanceTimersByTime(500));
  await act(() => eventDispatcher.dispatch('toast', { message: 'Saved', timeout: 1000 }));
  act(() => vi.advanceTimersByTime(900));
  expect(screen.getByText('Saved')).toBeTruthy();
});

it('keeps a failure raised by Undo visible after dismissing the original saved message', async () => {
  render(<Toast />);
  await act(() =>
    eventDispatcher.dispatch('toast', {
      message: 'Saved',
      action: {
        label: 'Undo',
        onClick: () => {
          void eventDispatcher.dispatch('toast', { message: 'Save failed', type: 'error' });
        },
      },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  act(() => vi.advanceTimersByTime(350));
  expect(screen.getByText('Save failed')).toBeTruthy();
});
