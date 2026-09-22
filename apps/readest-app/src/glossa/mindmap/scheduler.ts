import { ModelServiceError, normalizeBaseUrl, type ProviderConfig } from '@/glossa/ai/provider';
import { throwIfAborted } from '@/glossa/passages/types';

interface ServiceQueue {
  active: number;
  blockedUntil: number;
  serialUntil: number;
  waiting: Set<() => void>;
}
// Share the endpoint allowance across map jobs/models in this application window.
const services = new Map<string, ServiceQueue>();

/** Two ordinary API requests at most; rate limiting temporarily lowers the allowance to one. */
export async function scheduleMapRequest<T>(
  config: ProviderConfig,
  signal: AbortSignal,
  work: (queuedMs: number) => Promise<T>,
): Promise<T> {
  throwIfAborted(signal);
  const key = normalizeBaseUrl(config.baseUrl);
  let queue = services.get(key);
  if (!queue) {
    for (const [oldKey, old] of services)
      if (!old.active && !old.waiting.size && old.serialUntil <= Date.now())
        services.delete(oldKey);
    queue = { active: 0, blockedUntil: 0, serialUntil: 0, waiting: new Set() };
    services.set(key, queue);
  }
  const started = Date.now();
  while (
    queue.active >= (queue.serialUntil > Date.now() ? 1 : 2) ||
    queue.blockedUntil > Date.now()
  ) {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        clean();
        resolve();
      };
      const abort = () => {
        clean();
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      const timer =
        queue!.blockedUntil > Date.now()
          ? setTimeout(finish, Math.min(2147483647, queue!.blockedUntil - Date.now()))
          : undefined;
      const clean = () => {
        clearTimeout(timer);
        queue!.waiting.delete(finish);
        signal.removeEventListener('abort', abort);
      };
      queue!.waiting.add(finish);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    throwIfAborted(signal);
  }
  queue.active++;
  try {
    return await new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve()
        .then(() => {
          throwIfAborted(signal);
          return work(Date.now() - started);
        })
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
  } catch (error) {
    if (error instanceof ModelServiceError && error.code === 'rate_limit') {
      queue.blockedUntil = Math.max(queue.blockedUntil, Date.now() + (error.retryAfterMs ?? 1000));
      queue.serialUntil = Math.max(queue.serialUntil, queue.blockedUntil + 60000);
    }
    throw error;
  } finally {
    queue.active--;
    const waiting = [...queue.waiting];
    for (const wake of waiting) wake();
    if (!queue.active && !waiting.length && queue.serialUntil <= Date.now()) services.delete(key);
  }
}
