import type { Book } from '@/types/book';
import { protectBookRemoval } from '@/services/bookRemovalState';

/** Preserve independently newer personal edits when a reader saves an old row. */
export function mergeLibraryBook(current: Book, incoming: Book): Book {
  const result: Book = { ...current, ...incoming };
  if (current.updatedAt > incoming.updatedAt) {
    result.updatedAt = current.updatedAt;
    result.progress = current.progress;
  } else {
    result.progress ??= current.progress;
  }
  // Reading progress uses updatedAt, but cannot authorize a move from a
  // window whose group snapshot predates the latest explicit library move.
  const currentGroup = current.groupUpdatedAt ?? 0;
  const incomingGroup = incoming.groupUpdatedAt ?? 0;
  const group =
    currentGroup > incomingGroup ||
    (currentGroup === incomingGroup && current.updatedAt >= incoming.updatedAt)
      ? current
      : incoming;
  result.groupId = group.groupId;
  result.groupName = group.groupName;
  result.group = group.group;
  result.groupUpdatedAt = group.groupUpdatedAt;
  const currentMeta = current.metadataUpdatedAt ?? 0;
  const incomingMeta = incoming.metadataUpdatedAt ?? 0;
  const metadata =
    currentMeta > incomingMeta ||
    (currentMeta === incomingMeta && current.updatedAt >= incoming.updatedAt)
      ? current
      : incoming;
  result.title = metadata.title;
  result.author = metadata.author;
  result.tags = metadata.tags;
  result.metadata = metadata.metadata ?? result.metadata;
  result.primaryLanguage = metadata.primaryLanguage;
  result.metadataUpdatedAt = metadata.metadataUpdatedAt;
  if ((current.readingStatusUpdatedAt ?? 0) > (incoming.readingStatusUpdatedAt ?? 0)) {
    result.readingStatus = current.readingStatus;
    result.readingStatusUpdatedAt = current.readingStatusUpdatedAt;
  }
  if ((current.coverUpdatedAt ?? 0) > (incoming.coverUpdatedAt ?? 0)) {
    result.coverHash = current.coverHash;
    result.coverUpdatedAt = current.coverUpdatedAt;
  }
  return protectBookRemoval(result, current);
}
