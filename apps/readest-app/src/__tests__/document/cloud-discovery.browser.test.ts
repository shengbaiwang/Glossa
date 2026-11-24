import { expect, it, vi } from 'vitest';
import { WebAppService } from '@/services/webAppService';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import { getLocalBookFilename } from '@/utils/book';
import { prepareFile } from '@glossa/sync-contracts/publisher';

vi.mock('@/services/constants', async (original) => ({
  ...(await original<typeof import('@/services/constants')>()),
  LOCAL_BOOKS_SUBDIR: 'fixtures/catalog/' + crypto.randomUUID(),
  DATA_SUBDIR: 'fixtures/catalog/' + crypto.randomUUID(),
}));

const auth = vi.hoisted(() => ({ subject: 'alice', origin: 'https://catalog.example.test' }));
vi.mock('@/utils/access', async (original) => ({
  ...(await original<typeof import('@/utils/access')>()),
  getUserID: async () => auth.subject,
}));
vi.mock('@/glossa/sync/config', () => ({
  syncOrigin: () => auth.origin,
  hasGlossaSyncConfig: () => true,
}));
vi.mock('@/glossa/sync/cloudBook', () => ({
  syncAccess: async () => auth.subject,
  syncDeviceId: async () => 'test-device',
}));

it('discovers a published book from an empty device and reopens the scoped shelf offline', async () => {
  const app = new WebAppService();
  const book = crypto.randomUUID(),
    manifest = crypto.randomUUID();
  const file = new File(['one edition'], 'sample.pdf');
  const plan = await prepareFile(file);
  const changes: object[] = [];
  function change(kind: string, fields: object, id = book) {
    const seq = changes.length + 1;
    changes.push({ server_seq: seq, lamport: seq, changes: [{ kind, id, rev: seq, ...fields }] });
  }
  const originalFetch = globalThis.fetch.bind(globalThis);
  const cloudPaths: string[] = [];
  let switchDuringAck = false;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin !== auth.origin) return originalFetch(input, options);
    cloudPaths.push(url.pathname);
    if (url.pathname.endsWith('/ack')) {
      if (switchDuringAck) auth.subject = 'bob';
      return Response.json({});
    }
    if (!url.pathname.endsWith('/pull')) throw Error('unexpected data access');
    const cursor = Number(url.searchParams.get('after'));
    return Response.json({
      until: changes.length,
      next_cursor: changes.length,
      has_more: false,
      events: changes.slice(cursor),
    });
  });
  const store = useLibraryStore.getState;
  try {
    const create = {
      format: 'pdf',
      file_hash: plan.file_blake3,
      title: 'Atlas',
      authors: ['A'],
      language: 'en',
      status: 'unread',
      deleted_at: null,
    };
    change('book.create', create);
    expect(await app.discoverCloudBooks(auth.subject)).toBe(0);
    change('manifest.published', { manifest_id: manifest, file_bytes: file.size });
    expect(await app.discoverCloudBooks(auth.subject)).toBe(1);
    const [first] = await app.loadLibraryBooks();
    expect(first).toMatchObject({
      title: 'Atlas',
      format: 'PDF',
      author: 'A',
      glossaCloud: { book_id: book, manifest_id: manifest },
    });
    expect(await app.getBookFileSize(first!)).toBeNull();
    expect(await app.discoverCloudBooks(auth.subject)).toBe(0);
    await app.saveLibraryBooks([
      { ...first!, title: 'Personal', metadataUpdatedAt: Date.now(), progress: [2, 3] },
    ]);
    change('book.patch', { title: 'Remote edit', authors: ['B'] });
    expect(await app.discoverCloudBooks(auth.subject)).toBe(1);
    let [updated] = await app.loadLibraryBooks();
    expect(updated).toMatchObject({
      hash: first!.hash,
      title: 'Personal',
      author: 'B',
      progress: [2, 3],
    });
    await app.saveLibraryBooks([first!]);
    expect((await app.loadLibraryBooks())[0]).toMatchObject({
      hash: first!.hash,
      author: 'B',
      title: 'Personal',
    });
    expect(cloudPaths.every((p) => p === '/v1/sync/pull' || p === '/v1/sync/ack')).toBe(true);
    store().setCloudSubject(auth.subject);
    store().setLibrary([updated!], true);
    auth.subject = 'bob';
    store().setCloudSubject(auth.subject);
    store().setLibrary([first!], true); // Late async load from the previous account.
    expect(store().library).toHaveLength(0);
    await expect(app.loadBookContent(first!)).rejects.toThrow('sync_account_changed');
    expect(await app.loadLibraryBooks()).toHaveLength(0);
    auth.subject = 'alice';
    expect((await new WebAppService().loadLibraryBooks())[0]?.hash).toBe(first!.hash);
    change('book.trash', { deleted_at: 100 });
    expect(await app.discoverCloudBooks(auth.subject)).toBe(1);
    expect(await app.loadLibraryBooks()).toHaveLength(0);
    change('book.restore', { deleted_at: null });
    expect(await app.discoverCloudBooks(auth.subject)).toBe(1);
    [updated] = await app.loadLibraryBooks();
    expect(updated).toMatchObject({ hash: first!.hash, title: 'Personal', progress: [2, 3] });

    const legacy: Book = {
      hash: crypto.randomUUID(),
      format: 'PDF',
      title: 'Atlas',
      author: 'Legacy',
      createdAt: 1,
      updatedAt: 1,
    };
    const legacyFile = new File(['same length'], 'legacy.pdf');
    const local = await prepareFile(legacyFile);
    await app.fs.createDir(legacy.hash, 'Books', true);
    await app.fs.writeFile(getLocalBookFilename(legacy), 'Books', legacyFile);
    await app.saveLibraryBooks([legacy]);
    const other = crypto.randomUUID();
    change('book.create', { ...create, file_hash: local.file_blake3 }, other);
    change(
      'manifest.published',
      { manifest_id: crypto.randomUUID(), file_bytes: legacyFile.size },
      other,
    );
    expect(await app.discoverCloudBooks(auth.subject)).toBe(0);
    const edition = crypto.randomUUID();
    change('book.create', { ...create, file_hash: 'e'.repeat(64) }, edition);
    change(
      'manifest.published',
      { manifest_id: crypto.randomUUID(), file_bytes: legacyFile.size },
      edition,
    );
    expect(await app.discoverCloudBooks(auth.subject)).toBe(1);
    const shelf = await app.loadLibraryBooks();
    expect(shelf).toHaveLength(3);
    expect(shelf.find((b) => b.hash === legacy.hash)?.glossaCloud).toBeUndefined();
    expect(shelf.some((b) => b.glossaCloud?.book_id === edition)).toBe(true);
    expect(shelf.some((b) => b.glossaCloud?.book_id === other)).toBe(false);
    change('book.patch', { title: 'Later edition' }, edition);
    switchDuringAck = true;
    await expect(app.discoverCloudBooks('alice')).rejects.toThrow('sync_context_changed');
    switchDuringAck = false;
    auth.subject = 'alice';
    expect(
      (await app.loadLibraryBooks()).find((b) => b.glossaCloud?.book_id === edition)?.title,
    ).toBe('Atlas');
    expect(await app.discoverCloudBooks(auth.subject)).toBe(1);
    expect(
      (await app.loadLibraryBooks()).find((b) => b.glossaCloud?.book_id === edition)?.title,
    ).toBe('Later edition');
  } finally {
    fetcher.mockRestore();
    store().setCloudSubject(null);
  }
}, 30000);
