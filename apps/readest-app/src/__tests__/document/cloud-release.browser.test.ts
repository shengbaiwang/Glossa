import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '@noble/hashes/utils';
import { WebAppService } from '@/services/webAppService';
import { loadLibraryRows } from '@/services/libraryRepository';
import { saveLibraryBooks } from '@/services/libraryService';
import { removeAppBooks } from '@/services/appBookRemoval';
import { getLocalBookFilename } from '@/utils/book';
import { holdBookForReader } from '@/glossa/sync/bookUse';
import { releaseFinishedDownload } from '@/glossa/sync/releaseFinished';
import { setReleaseDays, setPinned } from '@/glossa/sync/releasePolicy';
import { SqliteReplica } from '@glossa/sync-contracts/replica';
import type { Book } from '@/types/book';

vi.mock('@/services/constants', async (original) => ({
  ...(await original<typeof import('@/services/constants')>()),
  LOCAL_BOOKS_SUBDIR: 'fixtures/release/' + crypto.randomUUID(),
  DATA_SUBDIR: 'fixtures/release/' + crypto.randomUUID(),
}));

const session = vi.hoisted(() => ({
  origin: 'https://release.invalid',
  subject: '',
  bytes: 'test original',
  device: '',
}));
vi.mock('@/utils/access', async (original) => ({
  ...(await original<typeof import('@/utils/access')>()),
  getUserID: async () => session.subject,
}));
vi.mock('@/glossa/sync/config', () => ({
  syncOrigin: () => session.origin,
  hasGlossaSyncConfig: () => true,
}));
vi.mock('@/glossa/sync/cloudBook', () => ({
  syncAccess: async () => 'test',
  syncDeviceId: async () => session.device,
  openCloudBook: async () =>
    Object.assign(new File([session.bytes], 'test.epub'), { close: async () => {} }),
}));

const app = new WebAppService();
const original = 'test original';
const hash = bytesToHex(blake3(new TextEncoder().encode(original)));
const old = Date.now() - 40 * 86400000;
let row: Book;
let finalHeader = () => {};
let revision = 2;
const current = async () => (await loadLibraryRows(app.fs, { hashes: [row.hash] }))[0]!;
const exists = () => app.exists(getLocalBookFilename(row), 'Books');
const clear = async () => removeAppBooks(app, [await current()], 'local');
beforeEach(async () => {
  session.subject = crypto.randomUUID();
  session.device = crypto.randomUUID();
  session.bytes = original;
  revision = 2;
  finalHeader = () => {};
  row = {
    hash: crypto.randomUUID(),
    title: 'Test',
    author: '',
    format: 'EPUB',
    createdAt: 1,
    updatedAt: 1,
    readingStatus: 'finished',
    readingStatusUpdatedAt: old,
    downloadedAt: old,
    uploadedAt: old,
    glossaCloud: {
      origin: session.origin,
      subject: session.subject,
      book_id: crypto.randomUUID(),
      manifest_id: crypto.randomUUID(),
      file_blake3: hash,
    },
  };
  await saveLibraryBooks(app.fs, [row]);
  await app.createDir(row.hash, 'Books', true);
  await app.writeFile(getLocalBookFilename(row), 'Books', new File([original], 'test.epub'));
  await app.writeFile(row.hash + '/config.json', 'Books', '{"notes":["overlay"]}');
  const fetchOriginal = window.fetch.bind(window);
  let reads = 0;
  vi.stubGlobal('fetch', (url: RequestInfo | URL, options?: RequestInit) => {
    if (!String(url).startsWith(session.origin)) return fetchOriginal(url, options);
    expect(String(url)).toContain('/manifest?manifest_id=' + row.glossaCloud!.manifest_id);
    if (++reads === 2) finalHeader();
    return Promise.resolve(
      Response.json({
        book_rev: revision,
        manifest_id: row.glossaCloud!.manifest_id,
        file_blake3: hash,
        file_bytes: original.length,
        manifest_digest: 'b'.repeat(64),
        status: 'finished',
        finished_at: old,
      }),
    );
  });
});
afterEach(() => vi.unstubAllGlobals());

it('releases only the managed original and can restore the same edition', async () => {
  expect((await clear()).completed).toEqual([row.hash]);
  expect(await exists()).toBe(false);
  expect(await app.readFile(row.hash + '/config.json', 'Books', 'text')).toBe(
    '{"notes":["overlay"]}',
  );
  expect(await current()).toMatchObject({
    glossaCloud: row.glossaCloud,
    downloadedAt: null,
    readingStatus: 'finished',
  });
  await app.downloadBook(await current());
  expect(await (await app.openFile(getLocalBookFilename(row), 'Books')).text()).toBe(original);
  expect((await current()).downloadedAt).toBeGreaterThan(old);
});

it('preserves corrupt-cloud, changed-local and actively read copies, then allows an explicit retry', async () => {
  session.bytes = 'corrupt';
  expect((await clear()).failed).toEqual([row.hash]);
  expect(await exists()).toBe(true);
  session.bytes = original;
  await app.writeFile(getLocalBookFilename(row), 'Books', new File(['different'], 'test.epub'));
  expect((await clear()).failed).toEqual([row.hash]);
  expect(await exists()).toBe(true);
  await app.writeFile(getLocalBookFilename(row), 'Books', new File([original], 'test.epub'));
  const controller = new AbortController();
  await holdBookForReader(row.hash, controller.signal);
  try {
    expect((await clear()).failed).toEqual([row.hash]);
    expect(await exists()).toBe(true);
  } finally {
    controller.abort();
  }
  expect((await clear()).completed).toEqual([row.hash]);
});

it('keeps the file when a local book edit is awaiting sync', async () => {
  const db = await app.openDatabase('glossa-sync', 'glossa-sync.db', 'Data');
  try {
    const replica = await SqliteReplica.open(db, {
      issuer: session.origin,
      user: session.subject,
      device: session.device,
    });
    await replica.edit(
      {
        op_id: crypto.randomUUID(),
        kind: 'book.patch',
        entity_id: row.glossaCloud!.book_id,
        base_rev: 2,
        data: { title: 'Pending rename' },
      },
      { title: 'Pending rename' },
    );
  } finally {
    await db.close();
  }
  expect((await clear()).failed).toEqual([row.hash]);
  expect(await exists()).toBe(true);
});

it('respects device opt-in, pins, and a policy withdrawal during verification', async () => {
  const p = row.glossaCloud!;
  await releaseFinishedDownload(app, session.subject);
  expect((await current()).localRemoval).toBeUndefined();
  setReleaseDays(p, 30);
  setPinned(p, true);
  await releaseFinishedDownload(app, session.subject);
  expect((await current()).localRemoval).toBeUndefined();
  setPinned(p, false);
  finalHeader = () => setReleaseDays(p, 0);
  await releaseFinishedDownload(app, session.subject);
  expect((await current()).localRemoval?.local).toBe('failed');
  expect(await exists()).toBe(true);
});

it('releases a finished, unpinned download after the selected period', async () => {
  setReleaseDays(row.glossaCloud!, 90);
  await releaseFinishedDownload(app, session.subject);
  expect(await exists()).toBe(true);
  setReleaseDays(row.glossaCloud!, 30);
  await releaseFinishedDownload(app, session.subject);
  expect(await exists()).toBe(false);
});

it.each([
  'account',
  'revision',
] as const)('preserves the download on a final %s change', async (reason) => {
  finalHeader = () => {
    if (reason === 'account') session.subject = crypto.randomUUID();
    else revision++;
  };
  expect((await clear()).failed).toEqual([row.hash]);
  expect(await exists()).toBe(true);
});
