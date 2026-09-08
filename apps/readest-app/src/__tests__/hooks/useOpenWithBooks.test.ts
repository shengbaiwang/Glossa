import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

const { loadSettings, navigateToLibrary, setCheckOpenWithBooks } = vi.hoisted(() => ({
  loadSettings: vi.fn().mockResolvedValue({ autoImportBooksOnOpen: true }),
  navigateToLibrary: vi.fn(),
  setCheckOpenWithBooks: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { loadSettings } }) }));
vi.mock('@/store/libraryStore', () => ({ useLibraryStore: () => ({ setCheckOpenWithBooks }) }));
vi.mock('@/utils/nav', () => ({
  navigateToLibrary,
  navigateToReader: vi.fn(),
  showLibraryWindow: vi.fn(),
}));
vi.mock('@/utils/md5', () => ({ partialMD5: vi.fn() }));

import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { eventDispatcher } from '@/utils/event';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.OPEN_WITH_FILES;
});

describe('Glossa app links and file import routing', () => {
  test.each([
    'glossa',
    'glossa-dev',
    'readest',
  ])('leaves %s app links for the reader link handler', async (scheme) => {
    renderHook(() => useOpenWithBooks());
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: [`${scheme}://book/abc/annotation/n1`],
    });
    expect(loadSettings).not.toHaveBeenCalled();
    expect(navigateToLibrary).not.toHaveBeenCalled();
    expect(window.OPEN_WITH_FILES).toBeUndefined();
  });

  test('still imports the file when it arrives alongside an app link', async () => {
    renderHook(() => useOpenWithBooks());
    await eventDispatcher.dispatch('app-incoming-url', {
      urls: ['glossa://book/abc', 'file:///tmp/sample%20book.epub'],
    });
    await Promise.resolve();
    expect(window.OPEN_WITH_FILES).toEqual(['/tmp/sample book.epub']);
    expect(setCheckOpenWithBooks).toHaveBeenCalledWith(true);
  });
});
