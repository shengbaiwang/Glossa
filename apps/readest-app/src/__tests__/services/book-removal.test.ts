import { describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { getLibraryFilename } from '@/utils/book';
import { saveLibraryBooks } from '@/services/libraryService';
import {
  prepareRemoval,
  runRemoval,
  restoreRemovedBooks,
  removalResult,
} from '@/services/bookRemovalService';

const book = (hash: string): Book => ({
  hash,
  title: hash,
  author: 'Author',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
});
function memory(books: Book[]) {
  const files = new Map([[getLibraryFilename(), JSON.stringify(books)]]);
  const fs = {
    getPrefix: async () => '',
    readFile: async (path: string) => {
      if (!files.has(path)) throw new Error('Missing');
      return files.get(path)!;
    },
    writeFile: vi.fn(async (path: string, _base: string, data: string) => {
      files.set(path, data);
    }),
  };
  const rows = () => JSON.parse(files.get(getLibraryFilename())!) as Book[];
  return { fs: fs as unknown as FileSystem, rows, files };
}

describe('recoverable book removal', () => {
  it('persists all targets first; trash preserves files and personal fields across restart', async () => {
    const m = memory([{ ...book('one'), groupName: 'Research', progress: [3, 10] }]);
    const job = await prepareRemoval(m.fs, ['one'], 'trash', { cloud: true });
    expect(m.rows()[0]?.removal?.local).toBe('pending');
    const clean = vi.fn();
    const result = await runRemoval(m.fs, job.id, { clean });
    expect(result.completed).toEqual(['one']);
    expect(clean).not.toHaveBeenCalled();
    expect(m.rows()[0]?.deletedAt).toBeTruthy();
    await restoreRemovedBooks(m.fs, ['one']);
    expect(m.rows()[0]).toMatchObject({
      hash: 'one',
      deletedAt: null,
      groupName: 'Research',
      progress: [3, 10],
    });
  });

  it('cancel stops only unstarted targets and a fresh job is independent', async () => {
    const m = memory([book('one'), book('two')]);
    const job = await prepareRemoval(m.fs, ['one', 'two'], 'local');
    const controller = new AbortController();
    const clean = vi.fn(async () => {
      controller.abort();
    });
    const result = await runRemoval(m.fs, job.id, { clean, signal: controller.signal });
    expect(result.completed).toEqual(['one']);
    expect(result.pending).toEqual(['two']);
    const next = await prepareRemoval(m.fs, ['one'], 'local');
    expect((await runRemoval(m.fs, next.id, { clean })).completed).toEqual(['one']);
    expect(clean).toHaveBeenCalledTimes(2);
    expect(await removalResult(m.fs, job.id)).toMatchObject({
      completed: ['one'],
      pending: ['two'],
    });
  });

  it('retains a failed cleanup for retry and never repeats successful targets', async () => {
    const m = memory([book('one'), book('two')]);
    const job = await prepareRemoval(m.fs, ['one', 'two'], 'purge');
    const clean = vi.fn(async (b: Book) => {
      if (b.hash === 'two') throw new Error('Disk');
    });
    const first = await runRemoval(m.fs, job.id, { clean });
    expect(first.failed).toEqual(['two']);
    expect(m.rows()[1]?.removal?.local).toBe('failed');
    clean.mockResolvedValue(undefined);
    const second = await runRemoval(m.fs, job.id, { clean });
    expect(second.completed).toEqual(['one', 'two']);
    expect(clean.mock.calls.filter(([b]) => b.hash === 'one')).toHaveLength(1);
  });

  it('a stale window save cannot revive a removed book or erase its operation', async () => {
    const m = memory([book('one')]);
    const old = m.rows();
    const job = await prepareRemoval(m.fs, ['one'], 'trash');
    await runRemoval(m.fs, job.id, { clean: async () => {} });
    await saveLibraryBooks(m.fs, old);
    expect(m.rows()[0]?.deletedAt).toBeTruthy();
    expect(m.rows()[0]?.removal?.mode).toBe('trash');
  });

  it('restore patches only removal fields and preserves newer personal edits', async () => {
    const m = memory([book('one')]);
    const job = await prepareRemoval(m.fs, ['one'], 'trash');
    await runRemoval(m.fs, job.id, { clean: async () => {} });
    const updated = m.rows()[0]!;
    await saveLibraryBooks(m.fs, [
      { ...updated, title: 'Personal title', progress: [9, 10], updatedAt: Date.now() + 1000 },
    ]);
    await restoreRemovedBooks(m.fs, ['one']);
    expect(m.rows()[0]).toMatchObject({
      title: 'Personal title',
      progress: [9, 10],
      deletedAt: null,
    });
  });

  it('a failed operation-record write never starts physical cleanup', async () => {
    const m = memory([book('one')]);
    m.fs.writeFile = vi.fn().mockRejectedValue(new Error('Disk full'));
    await expect(prepareRemoval(m.fs, ['one'], 'purge')).rejects.toThrow();
    expect(m.rows()[0]?.removal).toBeUndefined();
  });

  it('refuses overlapping pending operations and restores neither purged data nor a stale request', async () => {
    const m = memory([book('one')]);
    const job = await prepareRemoval(m.fs, ['one'], 'purge');
    await expect(prepareRemoval(m.fs, ['one'], 'trash')).rejects.toThrow();
    await runRemoval(m.fs, job.id, { clean: async () => {} });
    await expect(restoreRemovedBooks(m.fs, ['one'])).rejects.toThrow();
  });
});

describe('device cleanup does not change the shared book lifecycle', () => {
  it('keeps a recoverable deletion and its cloud targets while freeing a local copy', async () => {
    const m = memory([book('one')]);
    const trash = await prepareRemoval(m.fs, ['one'], 'trash', { cloudTargets: ['webdav', 's3'] });
    await runRemoval(m.fs, trash.id, { clean: async () => {} });
    const lifecycle = m.rows()[0]?.removal;
    const local = await prepareRemoval(m.fs, ['one'], 'local');
    await runRemoval(m.fs, local.id, { clean: async () => {} });
    expect(m.rows()[0]?.removal).toEqual(lifecycle);
    expect(m.rows()[0]?.localRemoval).toMatchObject({
      mode: 'local',
      local: 'complete',
      cloud: 'none',
    });
    await restoreRemovedBooks(m.fs, ['one']);
    expect(m.rows()[0]?.deletedAt).toBeNull();
  });
  it('does not let a stale window reset completed device cleanup', async () => {
    const m = memory([{ ...book('one'), downloadedAt: 10 }]);
    const before = m.rows();
    const local = await prepareRemoval(m.fs, ['one'], 'local');
    await runRemoval(m.fs, local.id, { clean: async () => {} });
    await saveLibraryBooks(m.fs, before);
    expect(m.rows()[0]?.downloadedAt).toBeNull();
    expect(m.rows()[0]?.localRemoval?.local).toBe('complete');
  });
});

describe('cloud completion is independent of local cleanup', () => {
  it('waits for every targeted backend and ignores stale receipts after restore', async () => {
    const { acknowledgeRemoval } = await import('@/services/bookRemovalService');
    const m = memory([book('one')]);
    const job = await prepareRemoval(m.fs, ['one'], 'trash', { cloudTargets: ['webdav', 's3'] });
    await runRemoval(m.fs, job.id, { clean: async () => {} });
    const snapshot = m.rows()[0]!;
    await acknowledgeRemoval(m.fs, snapshot, 'webdav', 'complete');
    expect(m.rows()[0]?.removal).toMatchObject({
      local: 'complete',
      cloud: 'pending',
      cloudTargets: { webdav: 'complete', s3: 'pending' },
    });
    await acknowledgeRemoval(m.fs, snapshot, 's3', 'failed');
    expect(m.rows()[0]?.removal?.cloud).toBe('failed');
    await acknowledgeRemoval(m.fs, snapshot, 's3', 'complete');
    expect(m.rows()[0]?.removal?.cloud).toBe('complete');
    await restoreRemovedBooks(m.fs, ['one']);
    await acknowledgeRemoval(m.fs, snapshot, 'webdav', 'complete');
    expect(m.rows()[0]?.removal?.cloud).toBe('pending');
  });
  it('preserves an edit saved while a peer purge was in flight and makes it restorable', async () => {
    const { applyPeerRemoval } = await import('@/services/bookRemovalService');
    const m = memory([{ ...book('one'), updatedAt: 500, title: 'Later edit' }]);
    const clean = vi.fn();
    const peer = {
      ...book('one'),
      deletedAt: 200,
      removal: {
        version: 1 as const,
        id: 'peer',
        revision: 200,
        requestedAt: 200,
        mode: 'purge' as const,
        local: 'complete' as const,
        cloud: 'none' as const,
      },
    };
    await applyPeerRemoval(m.fs, peer, clean);
    expect(clean).not.toHaveBeenCalled();
    expect(m.rows()[0]).toMatchObject({ title: 'Later edit', removal: { conflict: true } });
    await restoreRemovedBooks(m.fs, ['one']);
    expect(m.rows()[0]).toMatchObject({ title: 'Later edit', deletedAt: null });
  });
  it('lets the user explicitly resolve a preserved purge conflict by deleting it', async () => {
    const m = memory([
      {
        ...book('one'),
        deletedAt: 200,
        removal: {
          version: 1,
          id: 'conflict',
          revision: 200,
          requestedAt: 200,
          mode: 'purge',
          local: 'pending',
          cloud: 'none',
          conflict: true,
        },
      },
    ]);
    const job = await prepareRemoval(m.fs, ['one'], 'purge', { allowConflict: true });
    expect((await runRemoval(m.fs, job.id, { clean: async () => {} })).completed).toEqual(['one']);
  });
});

describe('visible state follows the persisted lifecycle', () => {
  it('keeps a stale window hidden after it saves a later personal edit', async () => {
    const { useLibraryStore } = await import('@/store/libraryStore');
    const m = memory([book('one')]);
    const stale = m.rows()[0]!;
    useLibraryStore.getState().setLibrary([stale]);
    const job = await prepareRemoval(m.fs, ['one'], 'trash');
    await runRemoval(m.fs, job.id, { clean: async () => {} });
    const env = {
      getAppService: async () => ({
        saveLibraryBooks: (rows: Book[]) => saveLibraryBooks(m.fs, rows),
      }),
    };
    await useLibraryStore
      .getState()
      .updateBook(env as unknown as import('@/services/environment').EnvConfigType, {
        ...stale,
        title: 'Saved after deletion',
        updatedAt: Date.now() + 100,
      });
    expect(useLibraryStore.getState().library[0]?.deletedAt).toBeTruthy();
    expect(useLibraryStore.getState().visibleLibrary).toEqual([]);
    expect(m.rows()[0]?.title).toBe('Saved after deletion');
  });
});
