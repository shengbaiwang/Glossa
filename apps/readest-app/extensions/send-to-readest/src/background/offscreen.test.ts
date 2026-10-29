import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from '../__test-utils__/chromeMock';

let chromeMock: ChromeMock;
beforeEach(() => {
  vi.resetModules();
  chromeMock = installChromeMock();
  Object.assign(chromeMock.runtime, {
    getURL: (path: string) => `chrome-extension://test/${path}`,
  });
  Object.assign(chromeMock, { offscreen: { hasDocument: vi.fn(async () => true) } });
});
afterEach(uninstallChromeMock);

test('local conversion passes page base URI without resolving upload credentials or endpoint', async () => {
  chromeMock.runtime.sendMessage.mockImplementation(async (request) =>
    request.type === 'send-to-readest:ping'
      ? { ok: true }
      : {
          ok: true,
          url: 'blob:chrome-extension://test/epub',
          filename: 'Article.epub',
          missingAssets: 2,
        },
  );
  const { clipAndDownloadViaOffscreen } = await import('./offscreen');
  const result = await clipAndDownloadViaOffscreen({
    html: '<article>text</article>',
    url: 'https://example.org/current',
    baseUrl: 'https://cdn.example.org/base/',
    pageTitle: 'Article',
  });
  expect(result).toEqual({
    ok: true,
    result: {
      url: 'blob:chrome-extension://test/epub',
      filename: 'Article.epub',
      missingAssets: 2,
    },
  });
  expect(chromeMock.runtime.sendMessage).toHaveBeenLastCalledWith({
    type: 'send-to-readest:clip-and-download',
    html: '<article>text</article>',
    url: 'https://example.org/current',
    baseUrl: 'https://cdn.example.org/base/',
    pageTitle: 'Article',
  });
  expect(chromeMock.storage.local.get).not.toHaveBeenCalled();
});
