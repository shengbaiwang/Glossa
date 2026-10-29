import { afterEach, expect, it, vi } from 'vitest';
import { handleGlobalError, isChunkLoadError } from '@/utils/error';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it('recognizes a named chunk rejection even when its message is not standardized', () => {
  const error = new Error('Request failed');
  error.name = 'ChunkLoadError';
  expect(isChunkLoadError(error)).toBe(true);
});

it('does not automatically reload into an unavailable development server', () => {
  const reload = vi.fn();
  vi.stubGlobal('window', { location: { reload } });
  handleGlobalError(new Error('Failed to load chunk /_next/static/chunks/dialog.js'));
  expect(reload).not.toHaveBeenCalled();
  expect(sessionStorage.getItem('lastErrorReload')).toBeNull();
});

it('retains the existing bounded recovery for other application errors', () => {
  const reload = vi.fn();
  vi.stubGlobal('window', { location: { reload } });
  handleGlobalError(new Error('Render error'));
  handleGlobalError(new Error('Render error'));
  expect(reload).toHaveBeenCalledOnce();
});
