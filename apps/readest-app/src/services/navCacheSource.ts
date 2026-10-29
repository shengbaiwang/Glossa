import type { Book } from '@/types/book';
import type { FileSystem } from '@/types/system';
import { getBookNavFilename } from '@/utils/book';
import { resolveBookContentSource } from './bookContent';
import { fingerprintPath } from './bookIdentity';

// Only externally mutable sources need full verification before their first
// binding (or an observed change). Keep the in-window verified set bounded.
const verifiedExternal = new WeakMap<FileSystem, Set<string>>();
const remember = (fs: FileSystem, source: string) => {
  let tokens = verifiedExternal.get(fs);
  if (!tokens) verifiedExternal.set(fs, (tokens = new Set()));
  tokens.add(source);
  if (tokens.size > 32) tokens.delete(tokens.values().next().value!);
};

/** A cache dependency token, never a replacement for full content identity. */
export async function getBookNavSource(fs: FileSystem, book: Book): Promise<string | null> {
  try {
    const identity = book.storedContentFingerprint || book.contentFingerprint;
    if (!identity || !/^sha256:[a-f0-9]{64}$/.test(identity)) return null;
    const source = await resolveBookContentSource(fs, book);
    if (source.kind !== 'managed' && source.kind !== 'external') return null;
    const stats = await fs.stats(source.path, source.base);
    if (!stats.isFile || stats.isDirectory || !Number.isSafeInteger(stats.size) || stats.size < 0)
      return null;
    const mtime = stats.mtime?.getTime() ?? null;
    if (mtime !== null && !Number.isFinite(mtime)) return null;
    // Web's private, content-addressed managed blobs do not expose an mtime.
    // Externally mutable files cannot use that weaker change detector.
    if (source.kind === 'external' && (mtime === null || mtime <= 0)) return null;
    const token = JSON.stringify({
      version: 1,
      bookId: book.hash,
      identity,
      revision: book.removal?.revision ?? 0,
      kind: source.kind,
      path: source.path,
      size: stats.size,
      mtime,
    });
    if (source.kind === 'managed') return token;
    if (verifiedExternal.get(fs)?.has(token)) return token;

    // A persisted binding was written only after complete verification. Matching
    // metadata is a change detector for that verified source, not identity proof
    // for a newly encountered or changed external file.
    const navPath = getBookNavFilename(book);
    if (await fs.exists(navPath, 'Books')) {
      try {
        const cached = JSON.parse((await fs.readFile(navPath, 'Books', 'text')) as string) as {
          source?: unknown;
        };
        if (cached?.source === token) {
          remember(fs, token);
          return token;
        }
      } catch {
        // A damaged cache may be rebuilt after verifying the actual source.
      }
    }
    if ((await fingerprintPath(fs, source.path, source.base)) !== identity) return null;
    const after = await fs.stats(source.path, source.base);
    if (!after.isFile || after.size !== stats.size || after.mtime?.getTime() !== mtime) return null;
    remember(fs, token);
    return token;
  } catch {
    // Unavailable sources/metadata disable a disposable cache, not reading.
    return null;
  }
}
