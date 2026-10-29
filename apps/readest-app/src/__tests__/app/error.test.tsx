import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ErrorPage from '@/app/error';
import { isChunkLoadError } from '@/utils/error';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/utils/ua', () => ({ parseWebViewInfo: () => '' }));
vi.mock('@/utils/error', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/error')>()),
  handleGlobalError: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([
  'Loading chunk 123 failed.',
  'Failed to load chunk /_next/static/chunks/ImportFromUrlDialog.js from module',
  'Failed to fetch dynamically imported module: https://example.com/dialog.js',
  'Importing a module script failed.',
])('reloads a failed module instead of reusing React.lazy rejection: %s', (message) => {
  const reload = vi.fn();
  vi.stubGlobal('window', { ...window, location: { reload } });
  const reset = vi.fn();
  render(<ErrorPage error={new Error(message)} reset={reset} />);
  fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
  expect(reload).toHaveBeenCalledOnce();
  expect(reset).not.toHaveBeenCalled();
});

it('keeps normal render-error recovery in the current page', () => {
  const reset = vi.fn();
  const error = new Error('A normal rendering error');
  expect(isChunkLoadError(error)).toBe(false);
  render(<ErrorPage error={error} reset={reset} />);
  fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
  expect(reset).toHaveBeenCalledOnce();
});
