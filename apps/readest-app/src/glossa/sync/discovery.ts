import { httpTransport, SqliteReplica, type PublishedBook } from '@glossa/sync-contracts/replica';
import { prepareFile } from '@glossa/sync-contracts/publisher';
import { resolveBookContentSource } from '@/services/bookContent';
import { withLibraryLock } from '@/services/libraryLock';
import { loadLibraryRows, writeLibraryRows } from '@/services/libraryRepository';
import type { Book } from '@/types/book';
import type { AppService, FileSystem } from '@/types/system';
import { getUserID } from '@/utils/access';
import type { ClosableFile } from '@/utils/file';
import { notifyLibraryUpdated } from '@/utils/libraryEvents';
import { syncAccess, syncDeviceId } from './cloudBook';
import { syncOrigin } from './config';

type Scope = { origin: string; subject: string };
type Catalog = Awaited<ReturnType<SqliteReplica['publishedBooks']>>;

// A complete SHA-256 identifies immutable bytes across the two hash algorithms.
// Cache only pairs computed together. A cached pair can defer a duplicate card,
// but cannot authorize attaching a local file to a cloud book.
const verifiedHashes = new Map<string, string>();
function localSourceKey(row: Book) {
  return JSON.stringify([
    row.hash,
    row.format,
    row.sourceTitle ?? row.title,
    row.filePath,
    row.contentFingerprint,
    row.storedContentFingerprint,
  ]);
}

function project(book: PublishedBook, scope: Scope, previous?: Book): Book {
  const now = Date.now();
  const state = {
    seq: book.rev,
    available: true,
    title: book.title,
    author: book.authors.join(', '),
    language: book.language ?? undefined,
    status: book.status,
    finishedAt: book.finished_at ?? undefined,
  };
  const old = previous?.glossaDiscovery;
  // Adopt server edits only for fields that still equal the last projection.
  return {
    ...previous,
    hash: previous?.hash ?? crypto.randomUUID().replaceAll('-', ''),
    createdAt: previous?.createdAt ?? now,
    updatedAt: previous?.updatedAt ?? now,
    sourceTitle: previous?.sourceTitle ?? book.title,
    format: book.format === 'epub' ? 'EPUB' : 'PDF',
    title: previous && previous.title !== old?.title ? previous.title : state.title,
    author: previous && previous.author !== old?.author ? previous.author : state.author,
    primaryLanguage:
      previous && previous.primaryLanguage !== old?.language
        ? previous.primaryLanguage
        : state.language,
    readingStatus:
      previous && previous.readingStatus !== old?.status ? previous.readingStatus : state.status,
    uploadedAt: previous?.uploadedAt ?? now,
    glossaDiscovery: state,
    glossaCloud: {
      ...scope,
      book_id: book.id,
      manifest_id: book.manifest_id,
      file_blake3: book.file_hash,
    },
  };
}

export async function applyPublishedCatalog(
  fs: FileSystem,
  scope: Scope,
  catalog: Catalog,
  current: () => Promise<boolean>,
) {
  const check = async () => {
    if (!(await current())) throw new Error('sync_context_changed');
  };
  await check();
  const initial = await loadLibraryRows(fs, { strict: true });
  const ours = (r: Book) =>
    r.glossaCloud?.origin === scope.origin && r.glossaCloud.subject === scope.subject;
  const bound = new Set(initial.filter(ours).map((r) => r.glossaCloud!.book_id));
  const sizes = new Set(catalog.books.filter((b) => !bound.has(b.id)).map((b) => b.file_bytes));
  const checked = new Set<string>();
  const localFiles = new Set<string>();
  // Titles never identify an edition. Only read local candidate bytes when their size
  // matches a previously unseen publication. Run this I/O outside the library lock.
  for (const row of initial) {
    if (!sizes.size || row.glossaCloud || !['PDF', 'EPUB'].includes(row.format)) continue;
    const fingerprint = row.storedContentFingerprint ?? row.contentFingerprint;
    const known = fingerprint && verifiedHashes.get(fingerprint);
    if (known) {
      localFiles.add(known);
      checked.add(localSourceKey(row));
      continue;
    }
    const source = await resolveBookContentSource(fs, row);
    if (source.kind === 'external' || source.kind === 'managed') {
      const file = await fs.openFile(source.path, source.base);
      try {
        if (sizes.has(file.size)) {
          const identity = await prepareFile(file);
          localFiles.add(identity.file_blake3);
          if (identity.sha256 === fingerprint) {
            if (verifiedHashes.size >= 2048)
              verifiedHashes.delete(verifiedHashes.keys().next().value!);
            verifiedHashes.set(identity.sha256, identity.file_blake3);
          }
        }
      } finally {
        await (file as Partial<ClosableFile>).close?.();
      }
    }
    checked.add(localSourceKey(row));
  }
  const changed = await withLibraryLock(fs, async () => {
    await check();
    const rows = await loadLibraryRows(fs, { strict: true });
    const byId = new Map(rows.filter(ours).map((r) => [r.glossaCloud!.book_id, r]));
    const live = new Set(catalog.books.map((b) => b.id));
    const edits = new Map<string, Book>();
    // An import may have committed during verification. Recompute its identity on the next pull.
    const unchecked = new Set(
      rows.filter((r) => !r.glossaCloud && !checked.has(localSourceKey(r))).map((r) => r.format),
    );
    for (const book of catalog.books) {
      const prior = byId.get(book.id);
      if (prior) {
        if (!prior.glossaDiscovery || prior.glossaDiscovery.seq >= book.rev) continue;
        if (prior.glossaCloud!.file_blake3 !== book.file_hash)
          throw new Error('book_identity_mismatch');
      } else if (
        localFiles.has(book.file_hash) ||
        unchecked.has(book.format === 'epub' ? 'EPUB' : 'PDF')
      )
        continue;
      const next = project(book, scope, prior);
      edits.set(next.hash, next);
    }
    for (const row of byId.values()) {
      const s = row.glossaDiscovery;
      if (s?.available && !live.has(row.glossaCloud!.book_id) && s.seq < catalog.cursor) {
        edits.set(row.hash, {
          ...row,
          glossaDiscovery: { ...s, seq: catalog.cursor, available: false },
        });
      }
    }
    if (edits.size) {
      const all = new Map(rows.map((r) => [r.hash, r]));
      for (const [id, row] of edits) all.set(id, row);
      await check();
      await writeLibraryRows(fs, [...all.values()], rows);
    }
    return [...edits.keys()];
  });
  if (changed.length) notifyLibraryUpdated(changed);
  return changed.length;
}

export async function discoverCloudBooks(
  app: Pick<AppService, 'openDatabase'>,
  fs: FileSystem,
  subject: string,
) {
  const origin = syncOrigin();
  if (!origin) throw new Error('sync_origin_changed');
  const root = await fs.getPrefix('Books');
  const current = async () =>
    origin === syncOrigin() &&
    subject === (await getUserID()) &&
    root === (await fs.getPrefix('Books'));
  return withLibraryLock(
    fs,
    async () => {
      if (!(await current())) throw new Error('sync_context_changed');
      const db = await app.openDatabase('glossa-sync', 'glossa-sync.db', 'Data');
      try {
        const replica = await SqliteReplica.open(db, {
          issuer: origin,
          user: subject,
          device: await syncDeviceId(origin),
        });
        await replica.synchronize(httpTransport(origin, () => syncAccess(origin, subject)));
        return await applyPublishedCatalog(
          fs,
          { origin, subject },
          await replica.publishedBooks(),
          current,
        );
      } finally {
        await db.close();
      }
    },
    'sync-replica',
  );
}
