export interface ImportResourceLease {
  release: () => void;
}

/** Source-byte accounting limits retained imports, not parser heap allocations. */
export class ImportResourceGate {
  private active = 0;
  private bytes = 0;
  private waiters: Array<{
    weight: number;
    signal?: AbortSignal;
    resolve: (lease: ImportResourceLease) => void;
    reject: (error: unknown) => void;
    abort: () => void;
  }> = [];

  constructor(
    private readonly concurrency = 4,
    private readonly byteBudget = 256 * 1024 * 1024,
  ) {}

  acquire(size?: number, signal?: AbortSignal): Promise<ImportResourceLease> {
    signal?.throwIfAborted();
    // Unknown and oversized sources run alone; every source can eventually enter.
    const weight =
      size !== undefined && Number.isFinite(size) && size >= 0
        ? Math.min(this.byteBudget, Math.max(1, Math.ceil(size)))
        : this.byteBudget;
    return new Promise((resolve, reject) => {
      const waiter = {
        weight,
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index < 0) return;
          this.waiters.splice(index, 1);
          reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
          this.drain();
        },
      };
      this.waiters.push(waiter);
      signal?.addEventListener('abort', waiter.abort, { once: true });
      this.drain();
    });
  }

  private drain() {
    // FIFO keeps a stream of small files from starving a large waiting book.
    while (this.waiters.length && this.active < this.concurrency) {
      const waiter = this.waiters[0]!;
      if (this.bytes + waiter.weight > this.byteBudget) break;
      this.waiters.shift();
      waiter.signal?.removeEventListener('abort', waiter.abort);
      this.active++;
      this.bytes += waiter.weight;
      let released = false;
      waiter.resolve({
        release: () => {
          if (released) return;
          released = true;
          this.active--;
          this.bytes -= waiter.weight;
          this.drain();
        },
      });
    }
  }
}

/** Shared across file, folder, watched-folder and overlapping import sessions. */
export const importResourceGate = new ImportResourceGate();

/**
 * Bounded prepare/commit pipeline. Ready items coalesce for one event-loop turn;
 * a slow prepare never holds up ready peers. A slot includes its prepared
 * resources until the commit consumer has finished with them.
 */
export async function runImportTasks<T>(
  count: number,
  prepare: (index: number) => Promise<T>,
  commit: (ready: Array<{ index: number; value: T }>) => Promise<void>,
  concurrency = 4,
): Promise<void> {
  let cursor = 0;
  let consuming = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready: Array<{
    index: number;
    value: T;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];
  const drain = async () => {
    if (consuming) return;
    consuming = true;
    try {
      while (ready.length) {
        const batch = ready.splice(0, concurrency);
        try {
          await commit(batch);
          for (const item of batch) item.resolve();
        } catch (error) {
          for (const item of batch) item.reject(error);
        }
      }
    } finally {
      consuming = false;
    }
  };
  const worker = async () => {
    while (cursor < count) {
      const index = cursor++;
      const value = await prepare(index);
      await new Promise<void>((resolve, reject) => {
        ready.push({ index, value, resolve, reject });
        if (!consuming && timer === undefined) {
          timer = setTimeout(() => {
            timer = undefined;
            void drain();
          }, 8);
        }
      });
    }
  };
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(Math.max(1, concurrency), count) }, worker),
  );
  const failed = workers.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
