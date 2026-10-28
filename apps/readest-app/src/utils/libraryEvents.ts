export const LIBRARY_UPDATED_EVENT = 'glossa-library-updated';

/** Notify peers only after persistence. No book data rides the channel. */
export function notifyLibraryUpdated(): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(LIBRARY_UPDATED_EVENT);
  channel.postMessage(null);
  channel.close();
}
