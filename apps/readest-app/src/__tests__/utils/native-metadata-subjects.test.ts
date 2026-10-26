import { describe, expect, it, vi } from 'vitest';
const source = vi.hoisted(() => ({
  title: 'Book',
  author: 'Author',
  language: 'en',
  series: 'Series',
  subject: ['History'],
  subjects: ['Legacy'],
}));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => ({
    partialMd5: 'original-hash',
    opfPath: 'book.opf',
    opfBytes: [60, 62],
  })),
}));
vi.mock('foliate-js/epub.js', () => ({ parseEpubMetadataFromXML: () => ({ metadata: source }) }));
vi.mock('foliate-js/mobi.js', () => ({
  readMobiMetadata: async () => ({ metadata: source, getCover: async () => null }),
}));
vi.mock('foliate-js/vendor/fflate.js', () => ({ unzlibSync: (bytes: Uint8Array) => bytes }));
import { tryNativeParseEpub } from '@/utils/tauriEpubBridge';
import { tryNativeParseMobi } from '@/utils/tauriMobiBridge';

describe('native import metadata', () => {
  it.each([
    'EPUB',
    'MOBI',
  ])('drops subjects on the %s fast path while retaining file identity and series', async (format) => {
    const parsed =
      format === 'EPUB'
        ? await tryNativeParseEpub('/test/book.epub')
        : await tryNativeParseMobi('/test/book.mobi', new File(['test'], 'book.mobi'));
    expect(parsed).not.toBeNull();
    expect(parsed?.partialMd5).toBe('original-hash');
    expect(parsed?.bookDoc.metadata).toEqual({
      title: 'Book',
      author: 'Author',
      language: 'en',
      series: 'Series',
    });
    expect(source.subject).toEqual(['History']);
  });
});
