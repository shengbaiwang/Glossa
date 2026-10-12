import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SettingsScopeControl from '@/components/settings/SettingsScopeControl';
const fixture = vi.hoisted(() => ({
  view: { isGlobal: true },
  env: {},
  save: vi.fn(),
  setView: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: fixture.env }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: fixture.save }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => fixture.view, setViewSettings: fixture.setView }),
}));
beforeEach(() => {
  fixture.view = { isGlobal: true };
  fixture.save.mockImplementation(
    async (_env: unknown, _book: string, _key: string, value: boolean) => {
      fixture.view.isGlobal = value;
    },
  );
  fixture.setView.mockImplementation((_book: string, view: { isGlobal: boolean }) => {
    fixture.view = view;
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('shows, persists and restores both scope choices for the menu book', async () => {
  render(<SettingsScopeControl bookKey='book-2' />);
  const only = screen.getByRole('radio', { name: 'This Book Only' });
  const all = screen.getByRole('radio', { name: 'All Books Default' });
  expect(all.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(only);
  await waitFor(() => expect(only.getAttribute('aria-checked')).toBe('true'));
  expect(fixture.save).toHaveBeenCalledWith(
    fixture.env,
    'book-2',
    'isGlobal',
    false,
    true,
    false,
    true,
  );
  fireEvent.keyDown(only, { key: 'ArrowRight' });
  await waitFor(() => expect(all.getAttribute('aria-checked')).toBe('true'));
  expect(fixture.save).toHaveBeenLastCalledWith(
    fixture.env,
    'book-2',
    'isGlobal',
    true,
    true,
    false,
    true,
  );
});
it('rolls back a failed scope save and allows retry', async () => {
  fixture.save.mockImplementationOnce(async () => {
    fixture.view.isGlobal = false;
    throw new Error('disk');
  });
  render(<SettingsScopeControl bookKey='book-2' />);
  fireEvent.click(screen.getByRole('radio', { name: 'This Book Only' }));
  await screen.findByRole('alert');
  expect(
    screen.getByRole('radio', { name: 'All Books Default' }).getAttribute('aria-checked'),
  ).toBe('true');
  fireEvent.click(screen.getByRole('radio', { name: 'This Book Only' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
