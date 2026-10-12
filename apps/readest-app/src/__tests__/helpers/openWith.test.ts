import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCurrent: vi.fn() }));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ getCurrent: mocks.getCurrent }));
vi.mock('@/services/environment', () => ({ isWebAppPlatform: () => false, hasCli: () => false }));

import { parseOpenWithFiles } from '@/helpers/openWith';

afterEach(() => {
  vi.restoreAllMocks();
  window.OPEN_WITH_FILES = null;
});

describe('cold-start file ingress', () => {
  it('ignores an authentication launch without logging credentials and preserves file parsing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.getCurrent.mockResolvedValue([
      'glossa://auth-callback#access_token=private&refresh_token=private',
      'file:///tmp/fixture%20book.epub',
      'content://fixture/book.epub',
    ]);
    expect(await parseOpenWithFiles(null)).toEqual([
      '/tmp/fixture book.epub',
      'content://fixture/book.epub',
    ]);
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});
