import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService, BaseDir } from '@/types/system';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { cleanRemovedBook, removeAppBooks, bookRemovalIO } from '@/services/appBookRemoval';
import { runRemoval } from '@/services/bookRemovalService';
import { getLocalBookFilename } from '@/utils/book';

const transport = vi.hoisted(() => ({
  ready: vi.fn(() => ['webdav']),
  create: vi.fn(),
}));
vi.mock('@/services/sync/file/runLibrarySync', () => ({
  getReadyFileSyncBackends: transport.ready,
}));
vi.mock('@/services/sync/file/providerRegistry', () => ({
  createFileSyncProvider: transport.create,
}));

const book = (): Book => ({
  hash: 'selected',
  title: 'Original',
  format: 'EPUB',
  author: 'Author',
  createdAt: 1,
  updatedAt: 1,
  uploadedAt: 100,
  downloadedAt: 100,
});
function setup() {
  const selected = book();
  const files = new Map<string, File>([
    [`Books/${getLocalBookFilename(selected)}`, new File(['complete book'], 'Original.epub')],
  ]);
  const app = {
    exists: vi.fn(
      async (path: string, base: BaseDir) =>
        files.has(`${base}/${path}`) ||
        (base === 'Cache' && [...files.keys()].some((key) => key.startsWith(`${base}/${path}/`))),
    ),
    openFile: vi.fn(async (path: string, base: BaseDir) => {
      const file = files.get(`${base}/${path}`);
      if (!file) throw new Error('Missing');
      return file;
    }),
    readDirectory: vi.fn(async () => []),
    createDir: vi.fn(async () => {}),
    resolveFilePath: vi.fn(async (path: string, base: BaseDir) => `${base}/${path}`),
    deleteFile: vi.fn(async (path: string, base: BaseDir) => {
      files.delete(`${base}/${path}`);
    }),
    deleteDir: vi.fn(async (path: string, base: BaseDir) => {
      for (const key of files.keys()) if (key.startsWith(`${base}/${path}/`)) files.delete(key);
    }),
    deleteBook: vi.fn(async () => {
      files.delete(`Books/${getLocalBookFilename(selected)}`);
    }),
  };
  const provider = {
    rootPath: '/',
    list: vi.fn(async () => [
      {
        name: 'Old title.epub',
        path: '/Readest/books/selected/Old title.epub',
        isDirectory: false,
      },
    ]),
    readBinary: vi.fn(async () => new TextEncoder().encode('complete book').buffer),
  };
  transport.create.mockResolvedValue(provider);
  return { selected, files, app, provider, clean: cleanRemovedBook(app as unknown as AppService) };
}
beforeEach(() => {
  vi.clearAllMocks();
  transport.create.mockReset();
  transport.ready.mockReturnValue(['webdav']);
});
describe('local download removal verifies recoverability', () => {
  it('does not trust an old uploadedAt when the remote book is missing', async () => {
    const m = setup();
    m.provider.list.mockResolvedValue([]);
    await expect(m.clean(m.selected, 'local')).rejects.toThrow(/No verified recovery/);
    expect(m.app.deleteBook).not.toHaveBeenCalled();
    expect(m.files.has(`Books/${getLocalBookFilename(m.selected)}`)).toBe(true);
  });
  it('compares all bytes rather than accepting a same-sized remote file', async () => {
    const m = setup();
    m.provider.readBinary.mockResolvedValue(new TextEncoder().encode('different txt').buffer);
    await expect(m.clean(m.selected, 'local')).rejects.toThrow(/No verified recovery/);
    expect(m.app.deleteBook).not.toHaveBeenCalled();
  });
  it('accepts a verified remote copy under its old filename without an uploadedAt hint', async () => {
    const m = setup();
    m.selected.uploadedAt = null;
    await m.clean(m.selected, 'local');
    expect(m.provider.readBinary).toHaveBeenCalledWith('/Readest/books/selected/Old title.epub');
    expect(m.app.deleteBook).toHaveBeenCalledOnce();
  });
  it('does not read a provider-supplied path outside the fixed book directory', async () => {
    const m = setup();
    m.provider.list.mockResolvedValue([
      {
        name: 'Old title.epub',
        path: '/Readest/books/other/Old title.epub',
        isDirectory: false,
      },
    ]);
    await expect(m.clean(m.selected, 'local')).rejects.toThrow(/No verified recovery/);
    expect(m.provider.readBinary).not.toHaveBeenCalled();
    expect(m.app.deleteBook).not.toHaveBeenCalled();
  });
  it('tries another enabled provider after a failed verification', async () => {
    const m = setup();
    transport.ready.mockReturnValue(['webdav', 's3']);
    transport.create
      .mockResolvedValueOnce({
        ...m.provider,
        list: vi.fn().mockRejectedValue(new Error('Offline')),
      })
      .mockResolvedValueOnce(m.provider);
    await m.clean(m.selected, 'local');
    expect(m.app.deleteBook).toHaveBeenCalledOnce();
  });
  it('keeps the local file when the first downloadable mirror holds another edition', async () => {
    const m = setup();
    transport.ready.mockReturnValue(['webdav', 's3']);
    transport.create
      .mockResolvedValueOnce({
        ...m.provider,
        readBinary: async () => new TextEncoder().encode('wrong edition').buffer,
      })
      .mockResolvedValueOnce(m.provider);
    await expect(m.clean(m.selected, 'local')).rejects.toThrow(/No verified recovery/);
    expect(m.app.deleteBook).not.toHaveBeenCalled();
  });
  it('can retain an independently verified external original without a cloud connection', async () => {
    const m = setup();
    m.selected.filePath = '/chosen/original.epub';
    m.files.set('None//chosen/original.epub', new File(['complete book'], 'original.epub'));
    transport.ready.mockReturnValue([]);
    await m.clean(m.selected, 'local');
    expect(m.app.deleteBook).toHaveBeenCalledOnce();
    expect(m.files.has('None//chosen/original.epub')).toBe(true);
    expect(transport.create).not.toHaveBeenCalled();
  });
  it('does not mistake an external replacement edition for a recovery copy', async () => {
    const m = setup();
    m.selected.filePath = '/chosen/original.epub';
    m.files.set('None//chosen/original.epub', new File(['revised text'], 'original.epub'));
    transport.ready.mockReturnValue([]);
    await expect(m.clean(m.selected, 'local')).rejects.toThrow(/No verified recovery/);
    expect(m.app.deleteBook).not.toHaveBeenCalled();
  });
  it('is a safe no-op when an earlier attempt already removed the managed file', async () => {
    const m = setup();
    m.files.clear();
    await m.clean(m.selected, 'local');
    expect(m.app.deleteBook).not.toHaveBeenCalled();
    expect(transport.create).not.toHaveBeenCalled();
  });
  it('clears only this book’s interrupted verification downloads when retrying', async () => {
    const m = setup();
    m.files.clear();
    m.files.set('Cache/removal-checks/selected/old-attempt', new File(['temporary'], 'check'));
    m.files.set('Cache/removal-checks/other/old-attempt', new File(['other book'], 'check'));
    await m.clean(m.selected, 'local');
    expect([...m.files.keys()]).toEqual(['Cache/removal-checks/other/old-attempt']);
    expect(m.app.deleteBook).not.toHaveBeenCalled();
  });
  it('does not pass an external-only source to the file cleaner', async () => {
    const m = setup();
    m.files.clear();
    m.selected.filePath = '/chosen/original.epub';
    m.files.set('None//chosen/original.epub', new File(['complete book'], 'original.epub'));
    await m.clean(m.selected, 'local');
    expect(m.app.deleteBook).not.toHaveBeenCalled();
    expect(m.files.size).toBe(1);
  });
  it('rechecks managed bytes after the remote request before removing the file', async () => {
    const m = setup();
    m.provider.readBinary.mockImplementation(async () => {
      m.files.set(
        `Books/${getLocalBookFilename(m.selected)}`,
        new File(['new edition'], 'Original.epub'),
      );
      return new TextEncoder().encode('complete book').buffer;
    });
    await expect(m.clean(m.selected, 'local')).rejects.toThrow(/changed during verification/);
    expect(m.app.deleteBook).not.toHaveBeenCalled();
  });
  it('verifies the same deterministic filename that a later download will choose', async () => {
    const m = setup();
    m.provider.list.mockResolvedValue([
      { name: 'z.epub', path: '/Readest/books/selected/z.epub', isDirectory: false },
      { name: 'a.epub', path: '/Readest/books/selected/a.epub', isDirectory: false },
    ]);
    m.provider.readBinary.mockImplementation(
      async (path?: string) =>
        new TextEncoder().encode(path?.endsWith('/a.epub') ? 'wrong edition' : 'complete book')
          .buffer,
    );
    await expect(m.clean(m.selected, 'local')).rejects.toThrow(/No verified recovery/);
    expect(m.app.deleteBook).not.toHaveBeenCalled();
    expect(m.provider.readBinary).toHaveBeenCalledWith('/Readest/books/selected/a.epub');
  });
  it('persists a verification failure and retries that operation after restart', async () => {
    const m = setup();
    let library = JSON.stringify([m.selected]);
    const app = {
      ...m.app,
      readFile: async () => library,
      writeFile: async (_path: string, _base: BaseDir, content: string) => {
        library = content;
      },
    } as unknown as AppService;
    m.provider.list.mockResolvedValueOnce([]);
    const failed = await removeAppBooks(app, [m.selected], 'local');
    expect(failed.failed).toEqual(['selected']);
    expect(JSON.parse(library)[0]).toMatchObject({
      downloadedAt: 100,
      localRemoval: { local: 'failed', failure: 'unavailable-copy' },
    });
    expect(m.app.deleteBook).not.toHaveBeenCalled();
    const retried = await runRemoval(bookRemovalIO(app), failed.id, {
      clean: cleanRemovedBook(app),
    });
    expect(retried.completed).toEqual(['selected']);
    expect(retried.failed).toEqual([]);
    expect(retried.books[0]?.localRemoval?.failure).toBeUndefined();
    expect(JSON.parse(library)[0]).toMatchObject({
      downloadedAt: null,
      localRemoval: { id: failed.id, local: 'complete' },
    });
  });
  it('streams a native verification copy into isolated temporary storage and always removes it', async () => {
    const m = setup();
    const downloadStream = vi.fn(async (_remote: string, path: string) => {
      m.files.set(path, new File(['complete book'], 'check.epub'));
      return true;
    });
    transport.create.mockResolvedValue({
      ...m.provider,
      downloadStream,
    } satisfies Partial<FileSyncProvider>);
    await m.clean(m.selected, 'local');
    expect(downloadStream).toHaveBeenCalledOnce();
    expect(m.provider.readBinary).not.toHaveBeenCalled();
    expect(m.app.deleteFile).toHaveBeenCalledWith(
      expect.stringMatching(/^removal-checks\/selected\/[a-z0-9-]+$/),
      'Cache',
    );
    expect([...m.files.keys()]).toEqual([]);
  });
  it.each([
    'failed',
    'corrupt',
  ] as const)('removes a %s temporary streaming copy while preserving the reading file', async (outcome) => {
    const m = setup();
    const downloadStream = vi.fn(async (_remote: string, path: string) => {
      m.files.set(path, new File(['partial bytes'], 'check.epub'));
      return outcome === 'corrupt';
    });
    transport.create.mockResolvedValue({ ...m.provider, downloadStream });
    await expect(m.clean(m.selected, 'local')).rejects.toThrow(/No verified recovery/);
    expect(m.app.deleteBook).not.toHaveBeenCalled();
    expect(m.app.deleteFile).toHaveBeenCalledOnce();
    expect([...m.files.keys()]).toEqual([`Books/${getLocalBookFilename(m.selected)}`]);
  });
});
