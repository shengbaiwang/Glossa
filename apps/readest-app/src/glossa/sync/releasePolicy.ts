import type { Book } from '@/types/book';

type Owner = Pick<NonNullable<Book['glossaCloud']>, 'origin' | 'subject'>;
export const releasePeriods = [0, 7, 30, 90] as const;
export const policyChanged = 'glossa-download-policy';

function key(owner: Owner, bookId?: string) {
  return 'glossa.download-policy.' + JSON.stringify([owner.origin, owner.subject, bookId ?? null]);
}

export function releaseDays(owner: Owner) {
  const value = Number(localStorage.getItem(key(owner)));
  return releasePeriods.find((days) => days === value) ?? 0;
}

export function setReleaseDays(owner: Owner, days: number) {
  if (!releasePeriods.some((value) => value === days)) throw new Error('invalid_release_period');
  localStorage.setItem(key(owner), String(days));
  window.dispatchEvent(new Event(policyChanged));
}

export function isPinned(pointer: NonNullable<Book['glossaCloud']>) {
  return localStorage.getItem(key(pointer, pointer.book_id)) !== null;
}

export function setPinned(pointer: NonNullable<Book['glossaCloud']>, pinned: boolean) {
  const id = key(pointer, pointer.book_id);
  if (pinned) localStorage.setItem(id, '1');
  else localStorage.removeItem(id);
  window.dispatchEvent(new Event(policyChanged));
}

export function isDue(finishedAt: number | null | undefined, days: number, now = Date.now()) {
  return days > 0 && !!finishedAt && finishedAt > 0 && finishedAt <= now - days * 86400000;
}

export function localReleaseDue(book: Book, days: number) {
  const finishedAt = Math.max(
    book.readingStatusUpdatedAt ?? 0,
    book.glossaDiscovery?.finishedAt ?? 0,
  );
  return (
    book.readingStatus === 'finished' &&
    isDue(finishedAt, days) &&
    (!book.downloadedAt || isDue(book.downloadedAt, days))
  );
}

export function recoveryScope(p: NonNullable<Book['glossaCloud']>) {
  return JSON.stringify([p.origin, p.subject, p.book_id, p.manifest_id, p.file_blake3]);
}
