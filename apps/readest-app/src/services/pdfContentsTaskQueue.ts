interface PendingTask {
  start: () => Promise<void>;
}

const waiting: PendingTask[] = [];
let active = false;

function pump(): void {
  if (active) return;
  const next = waiting.shift();
  if (!next) return;
  active = true;
  void next.start().finally(() => {
    active = false;
    pump();
  });
}

/** Queue before opening a PDF so only the active contents task owns a parser. */
export function enqueuePDFContentsTask<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    let started = false;
    const stop = () => {
      if (started) return; // The active task releases its resources before the slot is reused.
      const index = waiting.indexOf(pending);
      if (index >= 0) waiting.splice(index, 1);
      signal.removeEventListener('abort', stop);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const pending: PendingTask = {
      start: async () => {
        started = true;
        signal.removeEventListener('abort', stop);
        try {
          signal.throwIfAborted();
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      },
    };
    signal.addEventListener('abort', stop, { once: true });
    waiting.push(pending);
    pump();
  });
}
