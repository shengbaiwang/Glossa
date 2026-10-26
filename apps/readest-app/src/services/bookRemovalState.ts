import { z } from 'zod';
import type { Book } from '@/types/book';

export const bookRemovalSchema = z.object({
  version: z.literal(1),
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  requestedAt: z.number().finite().positive(),
  mode: z.enum(['trash', 'purge', 'restore', 'local']),
  local: z.enum(['pending', 'complete', 'failed']),
  cloud: z.enum(['none', 'pending', 'complete', 'failed']),
  conflict: z.boolean().optional(),
  failure: z.enum(['unavailable-copy', 'changed-file', 'storage']).optional(),
  cloudTargets: z
    .record(z.string().min(1).max(50), z.enum(['pending', 'complete', 'failed']))
    .optional(),
});
export type BookRemoval = z.infer<typeof bookRemovalSchema>;
export type RemovalMode = Exclude<BookRemoval['mode'], 'restore'>;
export class BookRemovalError extends Error {
  constructor(
    readonly code: NonNullable<BookRemoval['failure']>,
    message: string,
  ) {
    super(message);
  }
}
export function archiveRemoval(book: Book, field: 'removal' | 'localRemoval') {
  const previous = book[field];
  return previous
    ? [
        ...(book.removalHistory ?? []).filter((receipt) => receipt.id !== previous.id),
        { id: previous.id, local: previous.local },
      ]
    : book.removalHistory;
}

export function removalClock(book: Book): number {
  return bookRemovalSchema.safeParse(book.removal).success ? book.removal!.revision : 0;
}
export function compareBookRemoval(a: Book, b: Book): number {
  const difference = removalClock(a) - removalClock(b);
  return difference || (a.removal?.id ?? '').localeCompare(b.removal?.id ?? '');
}
export function isRecoverableRemoval(book: Book): boolean {
  return (
    !!book.deletedAt &&
    (book.removal?.mode === 'trash' ||
      (book.removal?.mode === 'purge' &&
        !!book.removal.conflict &&
        book.removal.local !== 'complete'))
  );
}
export function mustKeepBookFiles(book: Book): boolean {
  return book.removal?.mode === 'trash';
}

/** A lifecycle change needs its own clock; page turns cannot undo a deletion. */
export function protectBookRemoval(incoming: Book, current: Book): Book {
  const incomingClock = removalClock(incoming),
    currentClock = removalClock(current);
  const keepCurrent =
    (currentClock > 0 && compareBookRemoval(current, incoming) >= 0) ||
    (!incomingClock &&
      !!current.deletedAt &&
      !incoming.deletedAt &&
      (current.deletedAt ?? 0) >= (incoming.updatedAt ?? 0));
  let result = { ...incoming };
  if (keepCurrent) {
    // Lifecycle protection also keeps later personal data when a stale snapshot is saved.
    result = {
      ...(currentClock && current.updatedAt > incoming.updatedAt ? current : incoming),
      deletedAt: current.deletedAt,
      removal: current.removal,
    };
    if (
      current.removal &&
      current.deletedAt &&
      incoming.updatedAt > current.removal.requestedAt &&
      incoming.updatedAt > current.updatedAt
    ) {
      result.removal = {
        ...current.removal,
        conflict: true,
        local: current.removal.mode === 'purge' ? 'pending' : current.removal.local,
        revision: Math.max(Date.now(), currentClock + 1),
      };
    }
  }
  const local = current.localRemoval;
  if (local && local.revision >= (incoming.localRemoval?.revision ?? 0)) {
    result.localRemoval = local;
    // A later, explicit download can make this device available again.
    if (local.local === 'complete' && (incoming.downloadedAt ?? 0) <= local.requestedAt)
      result.downloadedAt = current.downloadedAt;
  }
  if (keepCurrent && current.removal?.mode === 'purge' && current.removal.local === 'complete') {
    result.downloadedAt = null;
    result.coverDownloadedAt = null;
  }
  if (current.removalHistory || incoming.removalHistory)
    result.removalHistory = [
      ...new Map(
        [...(incoming.removalHistory ?? []), ...(current.removalHistory ?? [])].map((receipt) => [
          receipt.id,
          receipt,
        ]),
      ).values(),
    ];
  return result;
}

/** Lifecycle clocks travel independently from progress and device completion. */
export function peerRemovalPatch(local: Book, remote: Book): Partial<Book> {
  const parsed = bookRemovalSchema.safeParse(remote.removal);
  if (!parsed.success || parsed.data.mode === 'local') return {};
  const intent = parsed.data;
  if (compareBookRemoval(local, remote) >= 0) return {};
  const conflict =
    intent.mode !== 'restore' && (!!intent.conflict || local.updatedAt > intent.requestedAt);
  return {
    deletedAt: intent.mode === 'restore' ? null : remote.deletedAt,
    removal: {
      ...intent,
      revision:
        conflict && !intent.conflict ? Math.max(Date.now(), intent.revision + 1) : intent.revision,
      local: intent.mode === 'restore' ? 'complete' : 'pending',
      cloud: 'none',
      cloudTargets: undefined,
      ...(conflict ? { conflict: true } : {}),
    },
  };
}
