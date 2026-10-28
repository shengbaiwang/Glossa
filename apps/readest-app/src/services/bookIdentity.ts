import { sha256 } from '@noble/hashes/sha256';
import type { Book } from '@/types/book';
import type { AppService, BaseDir } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
import { resolveBookContentSource, type BookContentFileSystem } from './bookContent';
import { inheritLibraryDatabase } from './libraryRepository';

const CHUNK_SIZE = 1024 * 1024;
const digestHex = (hash: ReturnType<typeof sha256.create>) =>
  `sha256:${Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

/** Read every byte with bounded memory and without independent ranged requests. */
export async function fingerprintFile(file: File, signal?: AbortSignal): Promise<string> {
  const hash = sha256.create();
  if (typeof file.stream === 'function') {
    signal?.throwIfAborted();
    const reader = file.stream().getReader();
    const abort = () => void reader.cancel().catch(() => {});
    signal?.addEventListener('abort', abort, { once: true });
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        if (value) {
          hash.update(value);
          total += value.byteLength;
        }
      }
    } finally {
      signal?.removeEventListener('abort', abort);
      reader.releaseLock();
    }
    if (total !== file.size) throw new Error('Could not read the complete book file');
    return digestHex(hash);
  }
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer());
    if (bytes.length !== Math.min(CHUNK_SIZE, file.size - offset))
      throw new Error('Could not read the complete book file');
    hash.update(bytes);
    if (offset + CHUNK_SIZE < file.size) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  signal?.throwIfAborted();
  return digestHex(hash);
}

export async function fingerprintPath(
  fs: BookContentFileSystem,
  path: string,
  base: BaseDir,
  signal?: AbortSignal,
): Promise<string> {
  const native = await fs.fingerprint?.(path, base, signal);
  if (native) return native;
  const file = await fs.openFile(path, base);
  try {
    return await fingerprintFile(file, signal);
  } finally {
    await (file as Partial<ClosableFile>).close?.();
  }
}

export function contentIdentity(book: Pick<Book, 'contentFingerprint'>): string | undefined {
  return typeof book.contentFingerprint === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(book.contentFingerprint)
    ? book.contentFingerprint
    : undefined;
}

/** Legacy hashes and metadata only nominate a candidate; local bytes prove identity. */
export async function fingerprintBook(
  fs: BookContentFileSystem,
  book: Book,
  signal?: AbortSignal,
  allowExternal = true,
): Promise<string | undefined> {
  const source = await resolveBookContentSource(fs, book);
  if (source.kind !== 'managed' && source.kind !== 'external') return undefined;
  // A legacy external path can already contain a replacement edition. Without
  // an earlier full fingerprint those bytes cannot prove the old record's identity.
  if (!allowExternal && source.kind === 'external') return undefined;
  return fingerprintPath(fs, source.path, source.base, signal);
}

/** Shared app adapter used by sync and the explicit duplicate review. */
export function libraryIdentityIO(app: AppService) {
  const io = {
    getPrefix: (base: Parameters<AppService['resolveFilePath']>[1]) =>
      app.resolveFilePath('', base),
    exists: app.exists.bind(app),
    openFile: app.openFile.bind(app),
    readDir: app.readDirectory.bind(app),
    readFile: app.readFile.bind(app),
    writeFile: app.writeFile.bind(app),
    fingerprint: app.fingerprint?.bind(app),
  };
  inheritLibraryDatabase(app, io);
  return io;
}
