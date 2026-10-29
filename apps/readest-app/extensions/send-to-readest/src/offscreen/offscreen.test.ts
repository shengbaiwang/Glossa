import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installChromeMock, uninstallChromeMock } from '../__test-utils__/chromeMock';

const { convert, upload } = vi.hoisted(() => ({ convert: vi.fn(), upload: vi.fn() }));
vi.mock('../../../../src/utils/zip', () => ({ configureZip: async () => undefined }));
vi.mock('../../../../src/services/send/conversion/convertToEpub', () => ({
  convertToEpub: convert,
}));
vi.mock('../background/upload', () => ({ uploadEpub: upload }));
let handler: (message: unknown, sender: object, response: (value: unknown) => void) => boolean;
beforeEach(async () => {
  vi.resetModules();
  convert.mockReset();
  upload.mockReset();
  const mock = installChromeMock();
  mock.runtime.onMessage.addListener.mockImplementation((listener) => {
    handler = listener;
  });
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => 'blob:chrome-extension://test/local'),
      revokeObjectURL: vi.fn(),
    }),
  );
  await import('./offscreen');
});
afterEach(() => {
  uninstallChromeMock();
  vi.unstubAllGlobals();
});

test('local output uses a temporary EPUB URL and never uploads the captured page', async () => {
  const file = new File(['epub-bytes'], 'epub');
  convert.mockResolvedValue({
    file,
    title: 'A / title',
    author: 'Author',
    warnings: [{ code: 'missing_assets', count: 2 }],
  });
  const response = vi.fn();
  handler(
    {
      type: 'send-to-readest:clip-and-download',
      html: 'rendered',
      url: 'https://example.org/page',
      baseUrl: 'https://cdn.example.org/',
      pageTitle: 'fallback',
    },
    {},
    response,
  );
  await vi.waitFor(() => expect(response).toHaveBeenCalled());
  expect(response).toHaveBeenCalledWith({
    ok: true,
    url: 'blob:chrome-extension://test/local',
    filename: 'A _ title.epub',
    missingAssets: 2,
  });
  expect(convert).toHaveBeenCalledWith({
    kind: 'page',
    captureMethod: 'browser',
    html: 'rendered',
    url: 'https://example.org/page',
    baseUrl: 'https://cdn.example.org/',
  });
  expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  expect(upload).not.toHaveBeenCalled();
  handler(
    { type: 'send-to-readest:release-download', url: 'blob:chrome-extension://test/local' },
    {},
    response,
  );
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  handler({ type: 'send-to-readest:release-download', url: 'blob:foreign' }, {}, response);
  expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
});

test('explicit cloud delivery still uploads EPUB bytes with its supplied endpoint and token', async () => {
  const file = new File(['epub-bytes'], 'epub');
  convert.mockResolvedValue({ file, title: 'Cloud', author: 'Author' });
  upload.mockResolvedValue({ ok: true, id: 'inbox-id' });
  const response = vi.fn();
  handler(
    {
      type: 'send-to-readest:clip-and-upload',
      html: 'rendered',
      url: 'https://example.org/page',
      token: 'test-token',
      endpoint: 'https://web.readest.com/api/send/inbox/file',
      pageTitle: 'Cloud',
    },
    {},
    response,
  );
  await vi.waitFor(() => expect(response).toHaveBeenCalled());
  expect(upload).toHaveBeenCalledWith(
    expect.objectContaining({
      token: 'test-token',
      epub: file,
      endpoint: 'https://web.readest.com/api/send/inbox/file',
    }),
  );
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
