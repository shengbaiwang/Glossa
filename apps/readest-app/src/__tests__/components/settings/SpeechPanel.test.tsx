import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SpeechPanel from '@/components/settings/SpeechPanel';
const fixture = vi.hoisted(() => ({ env: {}, save: vi.fn() }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: fixture.env }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: { ttsRate: 1.3 } } }),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: fixture.save }));
beforeEach(() => {
  fixture.save.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
it('loads preferences without starting speech or saving and only writes on an explicit change', async () => {
  render(<SpeechPanel />);
  expect(fixture.save).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('1.3')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
  expect(fixture.save).toHaveBeenCalledExactlyOnceWith(
    fixture.env,
    '',
    'ttsRate',
    1.4,
    false,
    false,
  );
});
it('retains a failed speed draft for retry', async () => {
  fixture.save.mockRejectedValueOnce(new Error('disk'));
  render(<SpeechPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
  await screen.findByRole('alert');
  expect(screen.getByDisplayValue('1.4')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(fixture.save).toHaveBeenLastCalledWith(fixture.env, '', 'ttsRate', 1.4, false, false);
});
