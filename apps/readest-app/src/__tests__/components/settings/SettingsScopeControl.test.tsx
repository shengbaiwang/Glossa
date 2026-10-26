import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettingsScopeControl from '@/components/settings/SettingsScopeControl';
const fixture = vi.hoisted(() => ({ env: {}, save: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: fixture.env }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/helpers/settings', () => ({ saveReadingDefaults: fixture.save }));
beforeEach(() => {
  fixture.save.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
});
it('keeps edits local and saves reading defaults only through the explicit action', async () => {
  render(<SettingsScopeControl bookKey='book-2' />);
  expect(screen.getByText('This Book Only')).toBeTruthy();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(fixture.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Set as Reading Defaults' }));
  await screen.findByRole('status');
  expect(fixture.save).toHaveBeenCalledExactlyOnceWith(fixture.env, 'book-2');
});
it('retains a failed save for explicit retry and suppresses duplicate writes', async () => {
  let reject: (reason: Error) => void = () => {};
  fixture.save.mockReturnValueOnce(
    new Promise((_resolve, rejectPromise) => {
      reject = rejectPromise;
    }),
  );
  render(<SettingsScopeControl bookKey='book-2' />);
  const button = screen.getByRole('button', { name: 'Set as Reading Defaults' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fixture.save).toHaveBeenCalledOnce();
  expect(button.hasAttribute('disabled')).toBe(true);
  reject(new Error('disk'));
  await screen.findByRole('alert');
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(fixture.save).toHaveBeenCalledTimes(2);
});
