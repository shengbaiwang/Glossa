import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { EnvConfigType } from '@/services/environment';
import { recognizeBookMetadata } from '@/glossa/metadata/recognize';
import {
  METADATA_ALGORITHM,
  loadMetadataRecognition,
  saveMetadataRecognition,
} from '@/glossa/metadata/storage';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  destroy: vi.fn(),
  fingerprint: vi.fn(),
  source: vi.fn(),
  text: vi.fn(),
  write: vi.fn(),
  read: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@/libs/document', () => ({
  DocumentLoader: class {
    open = mocks.open;
  },
}));
vi.mock('@/services/bookContent', () => ({ resolveBookContentSource: mocks.source }));
vi.mock('@/services/bookIdentity', () => ({
  fingerprintPath: mocks.fingerprint,
  libraryIdentityIO: (app: unknown) => app,
}));
vi.mock('@/services/pdfEnhancement', () => ({ supportsLocalPDF: () => false }));
const fingerprint = `sha256:${'a'.repeat(64)}`;
const book = {
  hash: 'test-book',
  format: 'PDF',
  contentFingerprint: fingerprint,
  title: '个人书名',
} as Book;
const service = {
  openFile: vi.fn(async () => ({ size: 10, close: mocks.close })),
  resolveNativeBookFilePath: vi.fn(async () => null),
  createDir: vi.fn(),
  writeFile: mocks.write,
  readFile: mocks.read,
  exists: vi.fn(async () => true),
} as unknown as AppService;
const env: EnvConfigType = { getAppService: async () => service };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.source.mockResolvedValue({ kind: 'managed', path: 'test-book/test.pdf', base: 'Books' });
  mocks.fingerprint.mockResolvedValue(fingerprint);
  mocks.open.mockResolvedValue({
    format: 'PDF',
    book: {
      metadata: { title: '原始正式书名', author: '文件作者', language: 'zh' },
      sections: Array.from({ length: 60 }, () => ({})),
      getPDFText: mocks.text,
      destroy: mocks.destroy,
    },
  });
  mocks.text.mockResolvedValue('');
  mocks.read.mockRejectedValue(new Error('not found'));
});

describe('local metadata recognition lifecycle', () => {
  it('bounds page discovery, records evidence and preserves personal fields', async () => {
    mocks.text.mockImplementation(async (index: number) =>
      index === 3
        ? '图书在版编目（CIP）数据\n书名：测试书\n出版社：测试出版社\nISBN 978-0-306-40615-7\n2020年1月第1版'
        : '',
    );
    const result = await recognizeBookMetadata(book, env, new AbortController().signal);
    expect(mocks.text).toHaveBeenCalledTimes(24);
    expect(mocks.text.mock.calls.map(([index]) => index)).toEqual([
      ...Array.from({ length: 16 }, (_, i) => i),
      ...Array.from({ length: 8 }, (_, i) => 52 + i),
    ]);
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'publisher',
          value: '测试出版社',
          source: expect.objectContaining({ pageIndex: 3 }),
        }),
      ]),
    );
    expect(book.title).toBe('个人书名');
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('rejects a replaced source before opening the parser or saving candidates', async () => {
    mocks.fingerprint.mockResolvedValue(`sha256:${'b'.repeat(64)}`);
    await expect(recognizeBookMetadata(book, env, new AbortController().signal)).rejects.toThrow(
      'metadata_source_changed',
    );
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('discards recognition when the source changes while pages are being read', async () => {
    mocks.fingerprint
      .mockResolvedValueOnce(fingerprint)
      .mockResolvedValueOnce(`sha256:${'b'.repeat(64)}`);
    await expect(recognizeBookMetadata(book, env, new AbortController().signal)).rejects.toThrow(
      'metadata_source_changed',
    );
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it('does not treat an isolated ISBN in a bibliography as copyright evidence', async () => {
    mocks.text.mockResolvedValue('References and further reading\nISBN 978-0-306-40615-7');
    const result = await recognizeBookMetadata(book, env, new AbortController().signal);
    expect(result.candidates.some((candidate) => candidate.field === 'isbn')).toBe(false);
  });
  it('does not access remote-only books', async () => {
    mocks.source.mockResolvedValue({
      kind: 'url',
      path: 'https://example.com/book.pdf',
      base: 'None',
    });
    await expect(recognizeBookMetadata(book, env, new AbortController().signal)).rejects.toThrow(
      'metadata_local_file_required',
    );
    expect(mocks.fingerprint).not.toHaveBeenCalled();
    expect(service.openFile).not.toHaveBeenCalled();
  });
  it('cancels late parsing and releases its resources without publishing', async () => {
    const abort = new AbortController();
    mocks.open.mockImplementationOnce(async () => {
      abort.abort();
      return { format: 'PDF', book: { metadata: {}, sections: [], destroy: mocks.destroy } };
    });
    await expect(recognizeBookMetadata(book, env, abort.signal)).rejects.toThrow();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('cancels a late page read without publishing incomplete results', async () => {
    const abort = new AbortController();
    mocks.text.mockImplementationOnce(async () => {
      abort.abort();
      return '出版社：不应保存';
    });
    await expect(recognizeBookMetadata(book, env, abort.signal)).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});

describe('candidate sidecar cache', () => {
  const result = { version: 1 as const, fingerprint, candidates: [], complete: true };
  const envelope = (value: unknown) =>
    JSON.stringify({ algorithm: METADATA_ALGORITHM, result: value });
  it('roundtrips valid candidates on a legacy book without rehashing the original', async () => {
    mocks.read.mockResolvedValue(envelope(result));
    expect(await loadMetadataRecognition({ ...book, contentFingerprint: undefined }, env)).toEqual(
      result,
    );
    expect(mocks.fingerprint).not.toHaveBeenCalled();
  });
  it('rejects a cache from a different full fingerprint', async () => {
    mocks.read.mockResolvedValue(envelope({ ...result, fingerprint: `sha256:${'b'.repeat(64)}` }));
    expect(await loadMetadataRecognition(book, env)).toBeNull();
  });
  it('rejects corrupt or incompatible cache without modifying the book', async () => {
    mocks.read.mockResolvedValue('{');
    expect(await loadMetadataRecognition(book, env)).toBeNull();
    mocks.read.mockResolvedValue(envelope({ ...result, version: 2 }));
    expect(await loadMetadataRecognition(book, env)).toBeNull();
  });
  it('restores the prior candidate cache when cancellation arrives during the write', async () => {
    const abort = new AbortController();
    const prior = envelope({ ...result, complete: false, reason: 'metadata_scan_limit' });
    mocks.read.mockResolvedValue(prior);
    mocks.write.mockImplementationOnce(async () => {
      abort.abort();
    });
    await expect(saveMetadataRecognition(book, env, result, abort.signal)).rejects.toThrow();
    expect(mocks.write).toHaveBeenLastCalledWith(
      'test-book/metadata-recognition.json',
      'Books',
      prior,
    );
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });
});
