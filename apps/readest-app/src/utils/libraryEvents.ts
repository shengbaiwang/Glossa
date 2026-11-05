export const LIBRARY_UPDATED_EVENT = 'glossa-library-updated';
export const LIBRARY_REFRESHED_EVENT = 'glossa-library-refreshed';

/** Notify peers only after persistence. No book data rides the channel. */
export function notifyLibraryUpdated(hashes?: string[]): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(LIBRARY_UPDATED_EVENT);
  channel.postMessage(hashes ? { hashes: [...new Set(hashes)] } : null);
  channel.close();
}
