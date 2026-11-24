import type { Book } from '@/types/book';
import { protectBookRemoval } from '@/services/bookRemovalState';

/** Preserve independently newer personal edits when a reader saves an old row. */
export function mergeLibraryBook(current: Book, incoming: Book): Book {
  const result: Book = { ...current, ...incoming };
  if (current.glossaCloud && !incoming.glossaCloud) {
    result.glossaCloud = current.glossaCloud;
    result.uploadedAt = current.uploadedAt;
  }
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
  const spaces =
    (current.readingSpacesUpdatedAt ?? 0) >= (incoming.readingSpacesUpdatedAt ?? 0)
      ? current
      : incoming;
  result.readingSpaces = spaces.readingSpaces;
  result.readingSpacesUpdatedAt = spaces.readingSpacesUpdatedAt;
  result.zoteroSource = current.zoteroSource ?? incoming.zoteroSource;
  // Ordinary saves can carry an older projection after a pull. Preserve its
  // newest binding and server defaults, including when the newer row is incoming.
  const a = current.glossaDiscovery,
    b = incoming.glossaDiscovery;
  if (a || b) {
    const newer = (a?.seq ?? -1) >= (b?.seq ?? -1) ? current : incoming;
    const older = newer === current ? incoming : current;
    result.glossaCloud = newer.glossaCloud;
    result.glossaDiscovery = newer.glossaDiscovery;
    if (a?.seq !== b?.seq) {
      for (const field of ['title', 'author'] as const) {
        if (older[field] === older.glossaDiscovery?.[field]) result[field] = newer[field];
      }
      if (older.primaryLanguage === older.glossaDiscovery?.language)
        result.primaryLanguage = newer.primaryLanguage;
      if (older.readingStatus === older.glossaDiscovery?.status)
        result.readingStatus = newer.readingStatus;
    }
  }
  return protectBookRemoval(result, current);
}
