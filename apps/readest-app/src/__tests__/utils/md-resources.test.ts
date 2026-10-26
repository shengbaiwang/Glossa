import { expect, it, vi } from 'vitest';
import { makeMarkdownBook } from '@/utils/md';
import {
  snapshotMarkdownFile,
  readMarkdownInput,
  resolveMarkdownResourcePath,
} from '@/utils/mdResources';
import { fingerprintFile } from '@/services/bookIdentity';
const source = () =>
  new File(
    [
      '# Original\n\n![Plot](figures/plot.png)\n\n![Lost](missing.png)\n\n![Remote](https://example.invalid/private.png)',
    ],
    'original.md',
  );
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
it('snapshots local images deterministically and keeps exact original bytes and resource identity', async () => {
  const read = vi.fn(async (path: string) =>
    path === 'figures/plot.png' ? new File([png], 'plot.png') : null,
  );
  const snapshot = await snapshotMarkdownFile(source(), read);
  const again = await snapshotMarkdownFile(source(), read);
  expect(await fingerprintFile(snapshot)).toBe(await fingerprintFile(again));
  expect((await readMarkdownInput(snapshot)).original).toEqual(
    new Uint8Array(await source().arrayBuffer()),
  );
  expect(read).not.toHaveBeenCalledWith('https://example.invalid/private.png');
  const changed = await snapshotMarkdownFile(
    source(),
    async () => new File([new Uint8Array([...png, 1])], 'plot.png'),
  );
  expect(await fingerprintFile(changed)).not.toBe(await fingerprintFile(snapshot));
  const book = await makeMarkdownBook(snapshot);
  const doc = await book.sections[0]!.createDocument();
  expect(doc.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  expect(doc.querySelectorAll('.md-missing-image')).toHaveLength(2);
  expect(doc.querySelector('img[src^="http"]')).toBeNull();
  book.destroy?.();
});
it('blocks escapes, absolute paths, encoded escapes and foreign schemes', () => {
  for (const path of [
    '../../private.png',
    '/private.png',
    'file:///private.png',
    'https://x/a.png',
    '%2e%2e/%2e%2e/x.png',
    'C:\\private.png',
  ])
    expect(resolveMarkdownResourcePath('/chosen', '/chosen/docs/original.md', path)).toBeNull();
  expect(
    resolveMarkdownResourcePath('/chosen', '/chosen/docs/original.md', '../assets/图.png'),
  ).toBe('/chosen/assets/图.png');
});
it('shows missing images without fetching them, rejects oversized assets and honors cancellation', async () => {
  const read = vi.fn(async () => new File([new Uint8Array(9 * 1024 * 1024)], 'large.png'));
  const snapshot = await snapshotMarkdownFile(source(), read);
  const book = await makeMarkdownBook(snapshot);
  const doc = await book.sections[0]!.createDocument();
  expect(doc.querySelector('img')).toBeNull();
  expect(doc.querySelectorAll('.md-missing-image')).toHaveLength(3);
  const controller = new AbortController();
  controller.abort();
  await expect(snapshotMarkdownFile(source(), read, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  book.destroy?.();
});
