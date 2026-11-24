// One lock per local book across same-origin reader windows. A closed or crashed
// window relinquishes its locks. Opens may wait for the short final unlink.
const name = (hash: string) => 'glossa-managed-file:' + hash;

export async function holdBookForReader(hash: string, signal: AbortSignal) {
  if (typeof navigator === 'undefined' || !navigator.locks) return;
  signal.throwIfAborted();
  await new Promise<void>((acquired, reject) => {
    void navigator.locks
      .request(name(hash), { mode: 'shared', signal }, async () => {
        acquired();
        if (!signal.aborted)
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          );
      })
      .catch(reject);
  });
}

export async function withUnusedBook<T>(hash: string, action: () => Promise<T>) {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('book_use_unknown');
  return navigator.locks.request(name(hash), { mode: 'exclusive', ifAvailable: true }, (lock) => {
    if (!lock) throw new Error('book_in_use');
    return action();
  });
}

export async function withBookInUse<T>(hash: string, action: () => Promise<T>) {
  if (typeof navigator === 'undefined' || !navigator.locks) return action();
  return navigator.locks.request(name(hash), { mode: 'shared' }, action);
}
