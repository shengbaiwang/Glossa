import { expect, it, vi } from 'vitest';
import { ZoteroClient, attachmentPath } from '@/glossa/plugins/zotero/client';
it('uses only fixed local GET endpoints with pagination and no redirects', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify([{ key: 'ABCD1234', data: { name: 'Research', parentCollection: false } }]),
      ),
  );
  const client = new ZoteroClient(fetcher);
  expect((await client.collections(0, new AbortController().signal))[0]?.data.name).toBe(
    'Research',
  );
  expect(fetcher).toHaveBeenCalledWith(
    'http://127.0.0.1:23119/api/users/0/collections?limit=100&start=0',
    expect.objectContaining({ method: 'GET', redirect: 'error' }),
  );
  await expect(client.items('../escape', 0, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects malformed external data and explains a disabled local API', async () => {
  const signal = new AbortController().signal;
  await expect(
    new ZoteroClient(async () => new Response('{}')).items('', 0, signal),
  ).rejects.toThrow();
  await expect(
    new ZoteroClient(async () => new Response('', { status: 403 })).collections(0, signal),
  ).rejects.toThrow('Zotero');
});
it('only resolves local PDF/EPUB attachments, never remote files or scripts', () => {
  expect(attachmentPath('file:///Users/test/A%20B.pdf')).toBe('/Users/test/A B.pdf');
  for (const path of [
    'https://example.org/a.pdf',
    'file://server/a.pdf',
    'file:///tmp/a.js',
    'file:///tmp/a.pdf?x=y',
  ])
    expect(() => attachmentPath(path)).toThrow();
});
it('honours cancellation before and after a late response', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async () => {
    controller.abort();
    return new Response('[]');
  });
  await expect(new ZoteroClient(fetcher).items('', 0, controller.signal)).rejects.toThrow();
});
