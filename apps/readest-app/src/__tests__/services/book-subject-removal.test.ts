import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { LibraryGroupByType, type SystemSettings } from '@/types/settings';
import { loadSettings } from '@/services/settingsService';
import { stripDeviceLocalFields } from '@/services/sync/file/wire';
import { useLibraryStore } from '@/store/libraryStore';
import { ensureLibraryGroupByType } from '@/app/library/utils/libraryUtils';

const persistence = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/services/persistence', () => ({
  safeLoadJSON: persistence.load,
  safeSaveJSON: persistence.save,
}));
import { loadLibraryBooks, saveLibraryBooks } from '@/services/libraryService';

const fs = {
  exists: vi.fn().mockResolvedValue(true),
  createDir: vi.fn(),
  getPrefix: vi.fn().mockResolvedValue('/Books'),
} as unknown as FileSystem;
const cover = vi.fn().mockResolvedValue('cover');
const makeBook = (hash = 'book'): Book => ({
  hash,
  format: 'EPUB',
  title: 'My title',
  author: 'Author',
  metadata: {
    title: 'Source title',
    author: 'Author',
    language: 'en',
    series: 'Series',
    ...{ subject: ['History'], subjects: ['Legacy'] },
  },
  tags: ['Favorite'],
  groupName: 'Research',
  progress: [3, 10],
  createdAt: 1,
  updatedAt: 2,
  metadataUpdatedAt: 2,
});

beforeEach(() => {
  vi.clearAllMocks();
  persistence.save.mockResolvedValue(undefined);
});

describe('removing book subjects', () => {
  it('removes legacy fields on load and persists the cleanup without changing personal data', async () => {
    const original = makeBook();
    persistence.load.mockImplementation(async () => [structuredClone(original)]);
    const [loaded] = await loadLibraryBooks(fs, cover);
    const expected = {
      ...original,
      metadata: { title: 'Source title', author: 'Author', language: 'en', series: 'Series' },
    };
    expect(loaded).toEqual({ ...expected, coverImageUrl: 'cover' });
    expect(persistence.save).toHaveBeenCalledWith(fs, expect.any(String), 'Books', [expected]);
  });

  it.each([
    false,
    true,
  ])('strips incoming and on-disk subjects when saving (replace=%s)', async (replace) => {
    const book = makeBook();
    persistence.load.mockResolvedValue([makeBook('disk-only')]);
    await saveLibraryBooks(fs, [book], { replace });
    const saved = persistence.save.mock.calls[0]![3] as Book[];
    expect(saved.map(({ hash }) => hash)).toEqual(replace ? ['book'] : ['disk-only', 'book']);
    for (const entry of saved) {
      expect(entry.metadata).not.toHaveProperty('subject');
      expect(entry.metadata).not.toHaveProperty('subjects');
      expect(entry.tags).toEqual(['Favorite']);
      expect(entry.metadata?.series).toBe('Series');
    }
    expect(book.metadata).toHaveProperty('subject');
  });

  it('falls back safely for removed category URLs and saved preferences', () => {
    expect(ensureLibraryGroupByType('subject', LibraryGroupByType.Tag)).toBe(
      LibraryGroupByType.None,
    );
    expect(ensureLibraryGroupByType(null, 'subject' as LibraryGroupByType)).toBe(
      LibraryGroupByType.None,
    );
    expect(Object.values(LibraryGroupByType)).toEqual(['none', 'group', 'series', 'author', 'tag']);
  });
});

it('cleans the latest disk metadata rather than overwriting a concurrent edit with the load snapshot', async () => {
  const loaded = makeBook();
  const latest = { ...makeBook(), title: 'New edit', tags: ['New tag'], progress: [8, 10] };
  persistence.load.mockResolvedValueOnce([loaded]).mockResolvedValueOnce([latest]);
  await loadLibraryBooks(fs, cover);
  const saved = persistence.save.mock.calls[0]![3] as Book[];
  expect(saved[0]).toMatchObject({ title: 'New edit', tags: ['New tag'], progress: [8, 10] });
  expect(saved[0]?.metadata).not.toHaveProperty('subject');
});

it('is idempotent and does not save libraries that have no retired fields', async () => {
  const book = makeBook();
  book.metadata = { title: 'Source title', author: 'Author', language: 'en' };
  persistence.load.mockResolvedValue([book]);
  await loadLibraryBooks(fs, cover);
  expect(persistence.save).not.toHaveBeenCalled();
});

it('migrates a stored subject preference to all books and persists it', async () => {
  persistence.load.mockResolvedValue({
    libraryGroupBy: 'subject',
    replicaDeviceId: 'device',
    globalReadSettings: {},
  });
  const settings = await loadSettings({
    fs,
    isMobile: false,
    isEink: false,
    isAppDataSandbox: false,
  });
  expect(settings.libraryGroupBy).toBe(LibraryGroupByType.None);
  expect(
    persistence.save.mock.calls.some(
      (call) => (call[3] as SystemSettings).libraryGroupBy === LibraryGroupByType.None,
    ),
  ).toBe(true);
});

it('drops subjects from sync payloads and store intake while keeping tags and series', () => {
  const book = makeBook();
  const remote = stripDeviceLocalFields(book);
  expect(remote.metadata).not.toHaveProperty('subject');
  expect(remote.metadata).not.toHaveProperty('subjects');
  expect(book.metadata).toHaveProperty('subject');
  useLibraryStore.getState().setLibrary([book]);
  const stored = useLibraryStore.getState().getBookByHash(book.hash)!;
  expect(stored.metadata).not.toHaveProperty('subject');
  expect(stored.metadata?.series).toBe('Series');
  expect(stored.tags).toEqual(['Favorite']);
});

it('keeps the library readable if persisting the cleanup fails', async () => {
  persistence.load.mockImplementation(async () => [makeBook()]);
  persistence.save.mockRejectedValueOnce(new Error('Read-only storage'));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const [book] = await loadLibraryBooks(fs, cover);
    expect(book?.hash).toBe('book');
    expect(book?.metadata).not.toHaveProperty('subject');
  } finally {
    warning.mockRestore();
  }
});

it('keeps settings usable if persisting the category migration fails', async () => {
  persistence.load.mockResolvedValue({
    libraryGroupBy: 'subject',
    replicaDeviceId: 'device',
    globalReadSettings: {},
  });
  persistence.save.mockRejectedValueOnce(new Error('Read-only storage'));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const settings = await loadSettings({
      fs,
      isMobile: false,
      isEink: false,
      isAppDataSandbox: false,
    });
    expect(settings.libraryGroupBy).toBe(LibraryGroupByType.None);
  } finally {
    warning.mockRestore();
  }
});
