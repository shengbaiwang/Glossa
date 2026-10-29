import { describe, expect, it, vi } from 'vitest';
import { getBookNavSource, loadBookNav, saveBookNav } from '@/services/bookService';
import { getBookNavFilename, getLocalBookFilename } from '@/utils/book';
import type { Book } from '@/types/book';
import type { BaseDir, FileInfo, FileSystem } from '@/types/system';
import type { BookNav } from '@/services/nav';

const fingerprint = `sha256:${'a'.repeat(64)}`;
const nav: BookNav = { version: 4, toc: [], sections: {} };

function fixture(external = false) {
  const book = {
    hash: 'nav-source-book',
    format: 'EPUB',
    title: 'Original source fixture',
    author: 'Original author',
    createdAt: 1,
    updatedAt: 1,
    contentFingerprint: fingerprint,
    ...(external ? { filePath: '/original/source.epub' } : {}),
  } as Book;
  const contentPath = external ? book.filePath! : getLocalBookFilename(book);
  const navPath = getBookNavFilename(book);
  const files = new Map<string, string>();
  let stats: FileInfo = {
    isFile: true,
    isDirectory: false,
    size: 100,
    mtime: new Date(1000),
    atime: null,
    birthtime: null,
  };
  const fs = {
    exists: vi.fn(
      async (path: string, base: BaseDir) =>
        (path === contentPath && base === (external ? 'None' : 'Books')) || files.has(path),
    ),
    stats: vi.fn(async () => stats),
    readDir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn(async (path: string) => {
      if (!files.has(path)) throw new Error('missing');
      return files.get(path)!;
    }),
    writeFile: vi.fn(async (path: string, _base: BaseDir, value: string) => {
      files.set(path, value);
    }),
    openFile: vi.fn().mockRejectedValue(new Error('Whole-file open was not expected')),
    fingerprint: vi.fn().mockResolvedValue(fingerprint),
  } as unknown as FileSystem;
  return {
    book,
    fs,
    files,
    navPath,
    setStats: (changes: Partial<FileInfo>) => {
      stats = { ...stats, ...changes };
    },
  };
}

describe('navigation cache source binding', () => {
  it('reuses a bound managed cache without opening or hashing the book', async () => {
    const { book, fs } = fixture();
    const source = await getBookNavSource(fs, book);
    expect(source).toBeTypeOf('string');
    await saveBookNav(fs, book, { ...nav, source: source! });
    await expect(loadBookNav(fs, book)).resolves.toEqual({ ...nav, source });
    expect(fs.fingerprint).not.toHaveBeenCalled();
    expect(fs.openFile).not.toHaveBeenCalled();
  });

  it('invalidates a legacy cache without a source binding once', async () => {
    const { book, fs, files, navPath } = fixture();
    files.set(navPath, JSON.stringify(nav));
    await expect(loadBookNav(fs, book)).resolves.toBeNull();
  });

  it.each([
    { toc: null },
    { toc: [null] },
    { toc: [{ label: 'Chapter', href: {} }] },
    { toc: [{ label: 'Chapter', href: 'chapter.xhtml', subitems: {} }] },
    { toc: [{ label: 'Chapter', href: 'chapter.xhtml', cfi: 1 }] },
    {
      toc: [
        {
          label: 'Chapter',
          href: 'chapter.xhtml',
          location: { current: 'bad', next: 2, total: 3 },
        },
      ],
    },
    { sections: null },
    { sections: [] },
    { sections: { chapter: null } },
    { sections: { chapter: { id: 'chapter', fragments: {} } } },
    { sections: { chapter: { id: 'chapter', fragments: [null] } } },
    {
      sections: {
        chapter: {
          id: 'chapter',
          fragments: [{ id: 'anchor', href: 'chapter#anchor', cfi: 'epubcfi(/6/2)', size: -1 }],
        },
      },
    },
  ])('treats malformed navigation structure as a disposable cache miss: %j', async (changes) => {
    const { book, fs, files, navPath } = fixture();
    const source = await getBookNavSource(fs, book);
    files.set(navPath, JSON.stringify({ ...nav, source, ...changes }));
    await expect(loadBookNav(fs, book)).resolves.toBeNull();
  });

  it('accepts nested TOC entries and section fragments without optional derived fields', async () => {
    const { book, fs } = fixture();
    const source = await getBookNavSource(fs, book);
    const bound = {
      ...nav,
      source,
      toc: [
        { label: 'Part', href: null },
        {
          label: 'Chapter',
          href: 'chapter.xhtml',
          subitems: [{ label: 'Section', href: 'chapter.xhtml#section' }],
        },
      ],
      sections: {
        'chapter.xhtml': {
          id: 'chapter.xhtml',
          fragments: [
            {
              id: 'chapter.xhtml#section',
              href: 'chapter.xhtml#section',
              cfi: 'epubcfi(/6/2!/4/2)',
              size: 20,
              fragments: [],
            },
          ],
        },
      },
    } as unknown as BookNav;
    await saveBookNav(fs, book, bound);
    await expect(loadBookNav(fs, book)).resolves.toEqual(bound);
  });

  it('rejects excessive cached nesting before recursive TOC consumers', async () => {
    const { book, fs, files, navPath } = fixture();
    const source = await getBookNavSource(fs, book);
    let toc: unknown[] = [];
    for (let depth = 0; depth < 150; depth++) {
      toc = [{ label: 'Deep chapter', href: 'chapter.xhtml', subitems: toc }];
    }
    files.set(navPath, JSON.stringify({ ...nav, source, toc }));
    await expect(loadBookNav(fs, book)).resolves.toBeNull();
  });

  it.each([
    'size',
    'mtime',
    'identity',
    'generation',
  ] as const)('invalidates changed %s', async (change) => {
    const { book, fs, setStats } = fixture();
    const source = await getBookNavSource(fs, book);
    await saveBookNav(fs, book, { ...nav, source: source! });
    if (change === 'size') setStats({ size: 101 });
    if (change === 'mtime') setStats({ mtime: new Date(2000) });
    if (change === 'identity') book.contentFingerprint = `sha256:${'b'.repeat(64)}`;
    if (change === 'generation') book.removal = { revision: 2 } as Book['removal'];
    await expect(loadBookNav(fs, book)).resolves.toBeNull();
  });

  it('does not bless navigation computed before the source changed', async () => {
    const { book, fs, setStats } = fixture();
    const source = await getBookNavSource(fs, book);
    setStats({ mtime: new Date(2000) });
    await saveBookNav(fs, book, { ...nav, source: source! });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('does not save an unbound navigation artifact', async () => {
    const { book, fs } = fixture();
    await saveBookNav(fs, book, nav);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('binds managed Web blobs to full imported identity even without filesystem timestamps', async () => {
    const { book, fs, setStats } = fixture();
    setStats({ mtime: null });
    const source = await getBookNavSource(fs, book);
    expect(source).toBeTypeOf('string');
    await saveBookNav(fs, book, { ...nav, source: source! });
    await expect(loadBookNav(fs, book)).resolves.toEqual({ ...nav, source });
    expect(fs.fingerprint).not.toHaveBeenCalled();
  });

  it('verifies external bytes before first binding and reuses unchanged verified metadata', async () => {
    const { book, fs } = fixture(true);
    const source = await getBookNavSource(fs, book);
    expect(source).toBeTypeOf('string');
    expect(fs.fingerprint).toHaveBeenCalledWith(book.filePath, 'None', undefined);
    await saveBookNav(fs, book, { ...nav, source: source! });
    vi.mocked(fs.fingerprint!).mockClear();
    await expect(loadBookNav(fs, book)).resolves.toEqual({ ...nav, source });
    expect(fs.fingerprint).not.toHaveBeenCalled();
  });

  it('fully re-verifies an external file after observed change and rejects a replacement edition', async () => {
    const { book, fs, setStats } = fixture(true);
    const source = await getBookNavSource(fs, book);
    await saveBookNav(fs, book, { ...nav, source: source! });
    setStats({ mtime: new Date(2000) });
    vi.mocked(fs.fingerprint!).mockResolvedValue(`sha256:${'b'.repeat(64)}`);
    vi.mocked(fs.fingerprint!).mockClear();
    await expect(loadBookNav(fs, book)).resolves.toBeNull();
    expect(fs.fingerprint).toHaveBeenCalledTimes(1);
  });

  it('reuses a persisted verified external binding after the service is recreated', async () => {
    const { book, fs } = fixture(true);
    const source = await getBookNavSource(fs, book);
    await saveBookNav(fs, book, { ...nav, source: source! });
    vi.mocked(fs.fingerprint!).mockClear();
    const reopened = { ...fs };
    await expect(loadBookNav(reopened, book)).resolves.toEqual({ ...nav, source });
    expect(fs.fingerprint).not.toHaveBeenCalled();
  });

  it('can rebuild a damaged external cache after fully verifying the source', async () => {
    const { book, fs, files, navPath } = fixture(true);
    files.set(navPath, '{damaged');
    const source = await getBookNavSource(fs, book);
    expect(source).toBeTypeOf('string');
    expect(fs.fingerprint).toHaveBeenCalledTimes(1);
    await saveBookNav(fs, book, { ...nav, source: source! });
    await expect(loadBookNav(fs, book)).resolves.toEqual({ ...nav, source });
  });

  it('rejects an external source that changes while full verification is running', async () => {
    const { book, fs, setStats } = fixture(true);
    vi.mocked(fs.fingerprint!).mockImplementation(async () => {
      setStats({ mtime: new Date(2000) });
      return fingerprint;
    });
    await expect(getBookNavSource(fs, book)).resolves.toBeNull();
  });

  it('skips external reuse without reliable timestamps or a full import identity', async () => {
    const { book, fs, setStats } = fixture(true);
    setStats({ mtime: null });
    await expect(getBookNavSource(fs, book)).resolves.toBeNull();
    setStats({ mtime: new Date(1000) });
    delete book.contentFingerprint;
    await expect(getBookNavSource(fs, book)).resolves.toBeNull();
    expect(fs.fingerprint).not.toHaveBeenCalled();
  });

  it('misses safely when live source metadata cannot be read', async () => {
    const { book, fs } = fixture();
    vi.mocked(fs.stats).mockRejectedValue(new Error('source unavailable'));
    await expect(getBookNavSource(fs, book)).resolves.toBeNull();
  });
});
