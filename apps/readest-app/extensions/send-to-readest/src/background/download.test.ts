import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from '../__test-utils__/chromeMock';

let chromeMock: ChromeMock;
let changed: (delta: chrome.downloads.DownloadDelta) => void;
beforeEach(() => {
  chromeMock = installChromeMock();
  Object.assign(chromeMock, {
    downloads: {
      download: vi.fn(async () => 42),
      search: vi.fn(async () => [{ id: 42, state: 'in_progress' }]),
      onChanged: {
        addListener: vi.fn((fn) => {
          changed = fn;
        }),
        removeListener: vi.fn(),
      },
    },
  });
});
afterEach(() => {
  uninstallChromeMock();
  vi.useRealTimers();
});

test('waits for download completion and releases the offscreen URL', async () => {
  const { downloadEpub } = await import('./download');
  const release = vi.fn(async () => undefined);
  const operation = downloadEpub(
    { url: 'blob:chrome-extension://test/id', filename: 'Article.epub' },
    release,
  );
  await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalled());
  expect(chrome.downloads.download).toHaveBeenCalledWith({
    url: 'blob:chrome-extension://test/id',
    filename: 'Article.epub',
    saveAs: true,
  });
  expect(release).not.toHaveBeenCalled();
  changed({ id: 42, state: { current: 'complete' } });
  await expect(operation).resolves.toBeUndefined();
  expect(release).toHaveBeenCalledOnce();
  expect(chrome.downloads.onChanged.removeListener).toHaveBeenCalled();
});

test('interrupted or rejected downloads report failure and release the URL', async () => {
  const { downloadEpub } = await import('./download');
  const release = vi.fn(async () => undefined);
  const operation = downloadEpub(
    { url: 'blob:chrome-extension://test/id', filename: 'Article.epub' },
    release,
  );
  await vi.waitFor(() => expect(chrome.downloads.download).toHaveBeenCalled());
  changed({ id: 42, state: { current: 'interrupted' } });
  await expect(operation).rejects.toThrow('Download was interrupted');
  expect(release).toHaveBeenCalledOnce();
});
