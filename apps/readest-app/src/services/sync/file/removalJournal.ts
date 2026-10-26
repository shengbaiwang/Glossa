import type { Book } from '@/types/book';
import { bookRemovalSchema, compareBookRemoval } from '@/services/bookRemovalState';
import { FileSyncError, type FileSyncProvider } from './provider';
import { buildBasePath } from './layout';
import { stripDeviceLocalFields } from './wire';

const directory = (provider: FileSyncProvider) => `${buildBasePath(provider.rootPath)}/removals`;

/** Immutable intents survive an older client's whole-index replacement. */
export async function readRemovalJournal(provider: FileSyncProvider): Promise<Book[]> {
  let entries;
  try {
    entries = await provider.list(directory(provider));
  } catch (error) {
    if (error instanceof FileSyncError && error.code === 'NOT_FOUND') return [];
    throw error;
  }
  const files = entries.filter(
    (entry) =>
      !entry.isDirectory && /^[a-zA-Z0-9_-]+-[0-9]+-[a-zA-Z0-9_-]+\.json$/.test(entry.name),
  );
  if (files.length > 10000)
    throw new FileSyncError(
      'The removal journal needs maintenance. No files were deleted.',
      'CONFLICT',
    );
  const latest = new Map<string, Book>();
  for (const entry of files) {
    // Construct paths from verified leaf names; never trust remote absolute paths.
    const raw = await provider.readText(`${directory(provider)}/${entry.name}`);
    if (!raw || raw.length > 1000000)
      throw new FileSyncError('Could not verify a removal record', 'CONFLICT');
    let value: { version?: unknown; book?: Book };
    try {
      value = JSON.parse(raw);
    } catch {
      throw new FileSyncError('Invalid removal record', 'CONFLICT');
    }
    const book = value?.book;
    if (
      value?.version !== 1 ||
      !book ||
      typeof book.hash !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(book.hash) ||
      typeof book.title !== 'string' ||
      !Number.isFinite(book.updatedAt) ||
      !bookRemovalSchema.safeParse(book.removal).success ||
      book.removal?.mode === 'local'
    )
      throw new FileSyncError('Invalid removal record', 'CONFLICT');
    const previous = latest.get(book.hash);
    if (!previous || compareBookRemoval(book, previous) > 0)
      latest.set(book.hash, stripDeviceLocalFields(book));
  }
  return [...latest.values()];
}

export async function writeRemovalJournal(provider: FileSyncProvider, book: Book): Promise<void> {
  const intent = bookRemovalSchema.parse(book.removal);
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(book.hash) || intent.mode === 'local')
    throw new Error('Invalid removal target');
  const dir = directory(provider);
  await provider.ensureDir([buildBasePath(provider.rootPath), dir]);
  const record = stripDeviceLocalFields(book);
  // Journal identities stay available for conflict/retry, without a purged reading history.
  if (intent.mode === 'purge') {
    delete record.progress;
    delete record.tags;
    delete record.metadata;
    delete record.groupId;
    delete record.groupName;
  }
  await provider.writeText(
    `${dir}/${book.hash}-${intent.revision}-${intent.id}.json`,
    JSON.stringify({ version: 1, book: record }),
  );
}
